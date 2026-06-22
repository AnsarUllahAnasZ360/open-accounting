/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupPipeline(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "owner@example.com",
      name: "Owner",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace",
      slug: "ansar-workspace",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Acme Studio LLC",
      slug: "acme-studio-llc",
      businessType: "services",
      currency: "USD",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const operatingAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Operating Checking",
      type: "asset",
      subtype: "bank",
      number: "1010",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const savingsAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Savings",
      type: "asset",
      subtype: "bank",
      number: "1020",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const arAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Accounts Receivable",
      type: "asset",
      subtype: "receivable",
      number: "1100",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const softwareAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Software & SaaS",
      type: "expense",
      subtype: "software",
      number: "5200",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const servicesAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      name: "Services",
      type: "income",
      subtype: "services",
      number: "4100",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    const bankAccountId = await ctx.db.insert("bankAccounts", {
      entityId,
      ledgerAccountId: operatingAccountId,
      name: "Mercury Checking",
      mask: "1001",
      kind: "checking",
      balanceMinor: 0,
      includeInSync: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("rules", {
      entityId,
      order: 1,
      name: "Software subscriptions",
      descriptionContains: "subscription",
      direction: "outflow",
      categoryAccountId: softwareAccountId,
      autoPost: true,
      hitCount: 0,
      active: true,
      createdBy: "seed",
      createdAt: now,
      updatedAt: now,
    });

    return {
      userId,
      entityId,
      bankAccountId,
      operatingAccountId,
      savingsAccountId,
      arAccountId,
      softwareAccountId,
      servicesAccountId,
    };
  });
}

function authed(t: ReturnType<typeof convexTest>, userId: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("transaction pipeline", () => {
  it("auto-posts matching rules through postEntry", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-04",
      amountMinor: -4999,
      currency: "USD",
      merchant: "Notion",
      rawDescription: "Notion subscription",
      status: "posted",
      source: "bank",
      externalId: "txn-rule-1",
    });

    expect(result.status).toBe("posted");
    expect(result.stage).toBe("rule");
    expect(result.entryId).toBeTruthy();

    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.trialBalanceDifferenceMinor).toBe(0);
    expect(verification.transactionCount).toBe(1);
    expect(verification.postedTransactionCount).toBe(1);
  });

  it("deduplicates imported transactions by external id", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    const args = {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-04",
      amountMinor: -2500,
      currency: "USD",
      merchant: "Linear",
      rawDescription: "Linear subscription",
      status: "posted" as const,
      source: "bank" as const,
      externalId: "txn-dupe-1",
    };
    const first = await session.mutation(api.pipeline.routeTransaction, args);
    const second = await session.mutation(api.pipeline.routeTransaction, args);

    expect(first.status).toBe("posted");
    expect(second.status).toBe("duplicate");
    expect(second.transactionId).toBe(first.transactionId);

    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.transactionCount).toBe(1);
    expect(verification.postedTransactionCount).toBe(1);
  });

  it("routes forced uncertainty to the Inbox without posting", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-05",
      amountMinor: -8800,
      currency: "USD",
      merchant: "Client Lunch",
      rawDescription: "Needs receipt review",
      status: "posted",
      source: "bank",
      externalId: "txn-review-1",
      categoryAccountId: ids.softwareAccountId,
      forceReview: true,
    });

    expect(result.status).toBe("needs_review");
    expect(result.entryId).toBeNull();

    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.openInboxCount).toBe(1);
    expect(verification.postedTransactionCount).toBe(0);
    expect(verification.trialBalanceDifferenceMinor).toBe(0);
  });

  it("posts transfers between ledger accounts without touching income or expense", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-06",
      amountMinor: -50000,
      currency: "USD",
      merchant: "Operating Transfer",
      rawDescription: "Transfer to savings",
      status: "posted",
      source: "bank",
      externalId: "txn-transfer-1",
      transferAccountId: ids.savingsAccountId,
    });

    expect(result.status).toBe("posted");
    expect(result.stage).toBe("transfer");

    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.trialBalanceDifferenceMinor).toBe(0);
    expect(verification.may2026.incomeMinor).toBe(0);
    expect(verification.may2026.expenseMinor).toBe(0);
  });
});

describe("E2-T7 — truthful stage attribution + id validation at the proposal boundary", () => {
  it("auto-posts a correction-memory decision with stage 'memory' (not 'rule')", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    // 1) An uncertain charge lands in the Inbox (forceReview), then the human
    //    confirms a category — this records a correction memory for the merchant.
    const first = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-07",
      amountMinor: -3300,
      currency: "USD",
      merchant: "Obscure Vendor",
      rawDescription: "OBSCURE VENDOR 0507",
      status: "posted",
      source: "bank",
      externalId: "memory-seed-1",
      forceReview: true,
    });
    expect(first.status).toBe("needs_review");
    await session.mutation(api.pipeline.confirmTransaction, {
      transactionId: first.transactionId,
      categoryAccountId: ids.softwareAccountId,
    });

    // 2) The SAME merchant arrives again and resolves via correction memory.
    const second = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-08",
      amountMinor: -3300,
      currency: "USD",
      merchant: "Obscure Vendor",
      rawDescription: "OBSCURE VENDOR 0508",
      status: "posted",
      source: "bank",
      externalId: "memory-hit-1",
    });

    expect(second.status).toBe("posted");
    // The bug being fixed: this used to return the hardcoded "rule".
    expect(second.stage).toBe("memory");
    expect(second.entryId).toBeTruthy();

    await t.run(async (ctx) => {
      const txn = await ctx.db.get(second.transactionId);
      expect(txn?.decidedBy).toBe("memory");
      expect(txn?.entryId).toBeTruthy();
    });
  });

  it("abstains an AI proposal whose category id does not exist on the entity (no throw, no post)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    // A category id that is syntactically valid but not a real ledgerAccount on
    // this entity (we fabricate one by inserting+deleting a row).
    const bogusCategoryId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("ledgerAccounts", {
        entityId: ids.entityId,
        name: "Ghost",
        type: "expense",
        subtype: "software",
        number: "5999",
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    const result = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-09",
      amountMinor: -4200,
      currency: "USD",
      merchant: "Hallucinated Co",
      rawDescription: "HALLUCINATED 0509",
      status: "posted",
      source: "bank",
      externalId: "bogus-id-1",
      aiProposal: {
        categoryAccountId: bogusCategoryId,
        confidence: 0.99,
        reasoning: "Model hallucinated a category id.",
        needsHuman: false,
      },
    });

    expect(result.status).toBe("needs_review");
    expect(result.entryId).toBeNull();

    await t.run(async (ctx) => {
      const txn = await ctx.db.get(result.transactionId);
      expect(txn?.decidedBy).toBe("needs_review");
      expect(txn?.entryId).toBeFalsy();
    });
    const verification = await session.query(api.reports.seedVerification, { entityId: ids.entityId });
    expect(verification.postedTransactionCount).toBe(0);
    expect(verification.trialBalanceDifferenceMinor).toBe(0);
  });

  it("still throws a clear error when a HUMAN recategorizes with a bad id", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    const routed = await session.mutation(api.pipeline.routeTransaction, {
      entityId: ids.entityId,
      bankAccountId: ids.bankAccountId,
      date: "2026-05-10",
      amountMinor: -1500,
      currency: "USD",
      merchant: "Needs Human",
      rawDescription: "NEEDS HUMAN 0510",
      status: "posted",
      source: "bank",
      externalId: "human-bad-id-1",
      forceReview: true,
    });

    const bogusCategoryId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("ledgerAccounts", {
        entityId: ids.entityId,
        name: "Ghost 2",
        type: "expense",
        subtype: "software",
        number: "5998",
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      session.mutation(api.pipeline.recategorizeTransaction, {
        transactionId: routed.transactionId,
        categoryAccountId: bogusCategoryId,
      }),
    ).rejects.toThrow();
  });
});

describe("E2-T10 — gate compares the calibrated probability after persistence", () => {
  async function workspaceOf(
    t: ReturnType<typeof convexTest>,
    entityId: Id<"entities">,
  ): Promise<Id<"workspaces">> {
    return await t.run(async (ctx) => {
      const entity = await ctx.db.get(entityId);
      if (!entity) throw new Error("entity not found");
      return entity.workspaceId;
    });
  }

  const aiProposalArgs = (ids: Awaited<ReturnType<typeof setupPipeline>>, externalId: string) => ({
    entityId: ids.entityId,
    bankAccountId: ids.bankAccountId,
    date: "2026-05-20",
    // small charge (under the auto-post ramp floor) so the required confidence is
    // exactly the balanced threshold (0.90), making 0.92 a clean borderline.
    amountMinor: -4200,
    currency: "USD",
    merchant: "Borderline Co",
    rawDescription: "BORDERLINE 0520",
    status: "posted" as const,
    source: "bank" as const,
    externalId,
    aiProposal: {
      categoryAccountId: ids.softwareAccountId,
      confidence: 0.92, // just above the 0.90 balanced gate at raw confidence
      reasoning: "Model is fairly sure.",
      needsHuman: false,
    },
  });

  it("posts a borderline raw-0.92 item with NO calibration row (identity gate)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);

    const result = await session.mutation(api.pipeline.routeTransaction, aiProposalArgs(ids, "calib-identity-1"));
    // Identity calibration: 0.92 >= 0.90 → auto-posts as an AI decision.
    expect(result.status).toBe("posted");
    expect(result.stage).toBe("ai");
    expect(result.entryId).toBeTruthy();
  });

  it("abstains the SAME item once a per-entity calibration with a<1 is persisted", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);
    const workspaceId = await workspaceOf(t, ids.entityId);

    // Persist a per-entity calibration that compresses confidence (a<1): the
    // calibrated probability for raw 0.92 falls below 0.90, so the gate — which
    // uses min(calibrated, raw) — now rejects the borderline auto-post.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("aiCalibrations", {
        workspaceId,
        entityId: ids.entityId,
        method: "temperature",
        a: 0.5,
        b: 0,
        sampleCount: 12,
        positiveCount: 7,
        eceBefore: 0.2,
        eceAfter: 0.05,
        fittedFrom: "per_entity_holdout",
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await session.mutation(api.pipeline.routeTransaction, aiProposalArgs(ids, "calib-abstain-1"));
    expect(result.status).toBe("needs_review");
    expect(result.entryId).toBeNull();
    await t.run(async (ctx) => {
      const txn = await ctx.db.get(result.transactionId);
      // The proposal is recorded (decidedBy ai) but nothing posted.
      expect(txn?.decidedBy).toBe("ai");
      expect(txn?.entryId).toBeFalsy();
    });
  });

  it("falls back to the workspace-level calibration when no per-entity row exists", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);
    const workspaceId = await workspaceOf(t, ids.entityId);

    // Only a WORKSPACE fallback row (entityId omitted) with a<1 exists. The
    // entity inherits it, so the borderline item abstains.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("aiCalibrations", {
        workspaceId,
        method: "temperature",
        a: 0.5,
        b: 0,
        sampleCount: 20,
        positiveCount: 11,
        eceBefore: 0.18,
        eceAfter: 0.04,
        fittedFrom: "workspace_fallback_holdout_pool",
        createdAt: now,
        updatedAt: now,
      });
    });

    const result = await session.mutation(api.pipeline.routeTransaction, aiProposalArgs(ids, "calib-fallback-1"));
    expect(result.status).toBe("needs_review");
    expect(result.entryId).toBeNull();
  });

  it("fitWorkspaceCalibration persists a PER-ENTITY row from real holdout pairs", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupPipeline(t);
    const session = authed(t, ids.userId);
    const workspaceId = await workspaceOf(t, ids.entityId);

    // A mixed-outcome holdout where the model is systematically overconfident →
    // the fit yields a non-identity (a<1) calibration keyed to the entity.
    const samples = [
      { rawConfidence: 0.95, correct: false },
      { rawConfidence: 0.9, correct: false },
      { rawConfidence: 0.85, correct: true },
      { rawConfidence: 0.8, correct: false },
      { rawConfidence: 0.75, correct: true },
      { rawConfidence: 0.6, correct: true },
      { rawConfidence: 0.55, correct: false },
      { rawConfidence: 0.4, correct: true },
    ];
    const fit = await session.mutation(api.ai.fitWorkspaceCalibration, {
      workspaceId,
      entityId: ids.entityId,
      samples,
    });
    expect(fit.params.method).not.toBe("identity");

    const row = await t.run(async (ctx) => {
      return await ctx.db
        .query("aiCalibrations")
        .withIndex("by_entity", (q) => q.eq("entityId", ids.entityId))
        .unique();
    });
    expect(row).toBeTruthy();
    expect(row?.entityId).toBe(ids.entityId);
    expect(row?.fittedFrom).toBe("holdout_confidence_pairs");
    // Coverage vs precision are reported separately by summarizeHoldoutCalibration
    // (autoPostPrecisionSummary): both are derived numbers and abstentions count
    // toward neither — exercised by calibration unit tests; here we assert the
    // persisted params and the per-entity keying that wakes the loop.
    expect(typeof row?.eceBefore).toBe("number");
    expect(typeof row?.eceAfter).toBe("number");
  });
});
