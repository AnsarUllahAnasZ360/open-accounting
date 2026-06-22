/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { clusterSignals } from "./onboardingProposals";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function authed(t: TestConvex<typeof schema>, userId: Id<"users">, email: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: `test|${email}`,
    issuer: "test",
    email,
  });
}

async function ownerWithBusiness(t: TestConvex<typeof schema>, email: string) {
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", { email, name: "Owner" }),
  );
  const session = authed(t, userId, email);
  const created = await session.mutation(api.onboarding.bootstrapWorkspace, {
    businesses: [{ name: "History Co", businessType: "services" }],
  });
  return { session, userId, entityId: created.entityIds[0] };
}

/**
 * Seed `count` history transactions across a small set of recurring merchants so
 * the deterministic clustering has real signal. Half are deposits (income), half
 * are charges (expense). Dates are now-relative so the default window includes
 * them.
 */
async function seedHistory(
  t: TestConvex<typeof schema>,
  entityId: Id<"entities">,
  count: number,
  baseDateMs: number,
) {
  const incomeMerchants = ["Acme Client", "Globex Retainer"];
  const expenseMerchants = ["AWS", "Notion", "Gusto Payroll"];
  await t.run(async (ctx) => {
    for (let i = 0; i < count; i += 1) {
      const isIncome = i % 2 === 0;
      const merchant = isIncome
        ? incomeMerchants[i % incomeMerchants.length]
        : expenseMerchants[i % expenseMerchants.length];
      const date = new Date(baseDateMs - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      await ctx.db.insert("transactions", {
        entityId,
        date,
        amountMinor: isIncome ? 250000 + i * 100 : -(12000 + i * 50),
        currency: "USD",
        merchant,
        rawDescription: merchant,
        status: "posted",
        review: "needs_review",
        source: "bank",
        externalId: `seed-${i}`,
        evalSet: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  });
}

describe("clusterSignals (pure)", () => {
  it("groups by normalized merchant + direction and drops one-offs", () => {
    const { incomeClusters, expenseClusters } = clusterSignals([
      { merchant: "ACME Client", amountMinor: 100000, date: "2026-01-01" },
      { merchant: "acme  client", amountMinor: 120000, date: "2026-02-01" },
      { merchant: "AWS", amountMinor: -5000, date: "2026-01-05" },
      { merchant: "aws", amountMinor: -5200, date: "2026-02-05" },
      { merchant: "One Off Vendor", amountMinor: -9999, date: "2026-02-09" },
    ]);
    expect(incomeClusters).toHaveLength(1);
    expect(incomeClusters[0].count).toBe(2);
    expect(expenseClusters.map((c) => c.display)).toContain("Aws");
    // The single "One Off Vendor" charge is below MIN_CLUSTER_SIZE.
    expect(expenseClusters.some((c) => c.display === "One Off Vendor")).toBe(false);
  });
});

describe("generateOnboardingProposals (E4-T7)", () => {
  it("produces a batch of income-stream + category + rule proposals over seeded history", async () => {
    const t = convexTest(schema, modules);
    const { session, entityId } = await ownerWithBusiness(t, "gen@example.com");
    await seedHistory(t, entityId, 50, Date.now());

    const result = await session.action(api.onboardingProposals.generateOnboardingProposals, { entityId });
    // No AI key in the test env -> deterministic clustering.
    expect(result.origin).toBe("deterministic");
    expect(result.proposalCount).toBeGreaterThan(0);

    const proposals = await session.query(api.onboardingProposals.listOnboardingProposals, {
      entityId,
    });
    const kinds = new Set(proposals.map((p) => p.kind));
    expect(kinds.has("incomeStream")).toBe(true);
    expect(kinds.has("category")).toBe(true);
    expect(kinds.has("rule")).toBe(true);

    // Payloads are sane: income streams carry a label + merchant; rules carry a
    // merchant string.
    const stream = proposals.find((p) => p.kind === "incomeStream")!;
    expect(typeof (stream.payload as { label: string }).label).toBe("string");
    expect((stream.payload as { label: string }).label.length).toBeGreaterThan(1);
    const rule = proposals.find((p) => p.kind === "rule")!;
    expect(typeof (rule.payload as { merchantContains: string }).merchantContains).toBe("string");

    // historyReviewed is marked.
    const progress = await session.query(api.onboarding.getProgress, {});
    expect(progress.flags.historyReviewed).toBe(true);

    // The fixed core clarifying questions persist.
    const questions = await session.query(api.onboardingProposals.listOnboardingQuestions, {
      entityId,
    });
    expect(questions.length).toBeGreaterThanOrEqual(5);
    expect(questions.some((q) => q.kind === "core")).toBe(true);
  });

  it("honors a chosen start date and the now-relative fallback (no frozen date)", async () => {
    const t = convexTest(schema, modules);
    const { session, entityId } = await ownerWithBusiness(t, "window@example.com");

    // Seed two recurring "InWindow" deposits inside the chosen window and two
    // "TooOld" deposits well before it.
    await t.run(async (ctx) => {
      const mk = (merchant: string, date: string, i: number) =>
        ctx.db.insert("transactions", {
          entityId,
          date,
          amountMinor: 300000,
          currency: "USD",
          merchant,
          rawDescription: merchant,
          status: "posted" as const,
          review: "needs_review" as const,
          source: "bank" as const,
          externalId: `${merchant}-${i}`,
          evalSet: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      await mk("InWindow Client", "2026-04-01", 0);
      await mk("InWindow Client", "2026-05-01", 1);
      await mk("TooOld Client", "2025-01-01", 0);
      await mk("TooOld Client", "2025-02-01", 1);
    });

    const result = await session.action(api.onboardingProposals.generateOnboardingProposals, {
      entityId,
      startDate: "2026-03-15",
    });
    // The chosen start is snapped to the first of its month.
    expect(result.windowStart).toBe("2026-03-01");

    const proposals = await session.query(api.onboardingProposals.listOnboardingProposals, {
      entityId,
    });
    const streamLabels = proposals
      .filter((p) => p.kind === "incomeStream")
      .map((p) => (p.payload as { merchantContains: string }).merchantContains);
    expect(streamLabels.some((label) => label.includes("Inwindow") || label.includes("InWindow"))).toBe(true);
    // The pre-window "TooOld" deposits are excluded by the chosen start.
    expect(streamLabels.some((label) => label.toLowerCase().includes("tooold"))).toBe(false);

    // With NO start date, the fallback bound is computed from Date.now() (not a
    // frozen literal) — a deposit dated "today" must be in the window.
    const t2 = convexTest(schema, modules);
    const second = await ownerWithBusiness(t2, "now@example.com");
    const todayIso = new Date(Date.now()).toISOString().slice(0, 10);
    await t2.run(async (ctx) => {
      for (let i = 0; i < 3; i += 1) {
        await ctx.db.insert("transactions", {
          entityId: second.entityId,
          date: todayIso,
          amountMinor: 400000,
          currency: "USD",
          merchant: "Fresh Income",
          rawDescription: "Fresh Income",
          status: "posted" as const,
          review: "needs_review" as const,
          source: "bank" as const,
          externalId: `fresh-${i}`,
          evalSet: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });
    const nowResult = await second.session.action(
      api.onboardingProposals.generateOnboardingProposals,
      { entityId: second.entityId },
    );
    expect(nowResult.proposalCount).toBeGreaterThan(0);
    expect(nowResult.windowStart <= todayIso).toBe(true);
  });
});

describe("onboarding proposal review/approve (E4-T8)", () => {
  it("approving a rule creates a rules row; approving an income stream persists the taxonomy", async () => {
    const t = convexTest(schema, modules);
    const { session, entityId } = await ownerWithBusiness(t, "approve@example.com");
    await seedHistory(t, entityId, 40, Date.now());
    await session.action(api.onboardingProposals.generateOnboardingProposals, { entityId });

    const proposals = await session.query(api.onboardingProposals.listOnboardingProposals, {
      entityId,
    });
    const ruleProposal = proposals.find((p) => p.kind === "rule")!;
    const streamProposal = proposals.find((p) => p.kind === "incomeStream")!;

    const approvedRule = await session.mutation(
      api.onboardingProposals.approveOnboardingProposal,
      { proposalId: ruleProposal.id },
    );
    expect(approvedRule.status).toBe("confirmed");

    await session.mutation(api.onboardingProposals.approveOnboardingProposal, {
      proposalId: streamProposal.id,
    });

    // A rules row now exists for the approved merchant.
    const rulesCount = await t.run(async (ctx) => {
      const rules = await ctx.db
        .query("rules")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      return rules.length;
    });
    expect(rulesCount).toBeGreaterThan(0);

    // The entity's shared incomeStreams taxonomy now carries the approved label.
    const entity = await t.run(async (ctx) => ctx.db.get(entityId));
    expect(Array.isArray(entity?.incomeStreams)).toBe(true);
    expect((entity?.incomeStreams ?? []).length).toBeGreaterThan(0);

    // The approved proposals flip to confirmed.
    const after = await session.query(api.onboardingProposals.listOnboardingProposals, {
      entityId,
    });
    expect(after.find((p) => p.id === ruleProposal.id)?.status).toBe("confirmed");
    expect(after.find((p) => p.id === streamProposal.id)?.status).toBe("confirmed");
  });

  it("rejecting a proposal dismisses it without creating records", async () => {
    const t = convexTest(schema, modules);
    const { session, entityId } = await ownerWithBusiness(t, "reject@example.com");
    await seedHistory(t, entityId, 30, Date.now());
    await session.action(api.onboardingProposals.generateOnboardingProposals, { entityId });

    const proposals = await session.query(api.onboardingProposals.listOnboardingProposals, {
      entityId,
    });
    const target = proposals[0];
    const rejected = await session.mutation(api.onboardingProposals.rejectOnboardingProposal, {
      proposalId: target.id,
    });
    expect(rejected.status).toBe("dismissed");
  });

  it("answering questions persists, and completing review marks proposalsReviewed + phase done", async () => {
    const t = convexTest(schema, modules);
    const { session, entityId } = await ownerWithBusiness(t, "complete@example.com");
    await seedHistory(t, entityId, 20, Date.now());
    await session.action(api.onboardingProposals.generateOnboardingProposals, { entityId });

    const questions = await session.query(api.onboardingProposals.listOnboardingQuestions, {
      entityId,
    });
    await session.mutation(api.onboardingProposals.answerOnboardingQuestion, {
      questionId: questions[0].id,
      answer: "Consulting retainers",
    });
    const afterAnswer = await session.query(api.onboardingProposals.listOnboardingQuestions, {
      entityId,
    });
    expect(afterAnswer.find((q) => q.id === questions[0].id)?.answer).toBe("Consulting retainers");

    await session.mutation(api.onboardingProposals.completeProposalReview, {});
    const progress = await session.query(api.onboarding.getProgress, {});
    expect(progress.flags.proposalsReviewed).toBe(true);
    expect(progress.phase).toBe("done");
  });
});
