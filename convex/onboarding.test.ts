/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function insertUser(t: TestConvex<typeof schema>, email: string) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", { email, name: "First Owner" });
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">, email: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: `test|${email}`,
    issuer: "test",
    email,
  });
}

describe("first-run onboarding", () => {
  it("lets an authenticated user without a workspace bootstrap one business and checklist", async () => {
    const t = convexTest(schema, modules);
    const userId = await insertUser(t, "new-owner@example.com");
    const session = authed(t, userId, "new-owner@example.com");

    const before = await session.query(api.session.viewer, {});
    expect(before.status).toBe("needs_onboarding");
    expect(before.workspace).toBeNull();

    const created = await session.mutation(api.onboarding.bootstrapWorkspace, {
      businessName: "New Owner Studio",
      businessType: "software",
      currency: "USD",
      skippedAi: true,
      skippedBank: true,
      skippedStripe: true,
    });
    expect(created.alreadyOnboarded).toBe(false);
    expect(created.accountsCreated).toBeGreaterThan(30);

    const after = await session.query(api.session.viewer, {});
    expect(after.status).toBe("ready");
    expect(after.workspace?.name).toBe("New Owner Studio workspace");
    expect(after.role).toBe("owner");

    const businesses = await session.query(api.entities.list, {});
    expect(businesses.rows).toHaveLength(1);
    expect(businesses.rows[0]).toMatchObject({
      name: "New Owner Studio",
      businessType: "software",
      currency: "USD",
      isDemo: false,
    });

    const checklist = await session.query(api.onboarding.checklist, {});
    expect(checklist.persisted).toBe(true);
    expect(checklist.items.map((item) => item.key)).toEqual([
      "bankConnected",
      "aiConnected",
      "stripeConnected",
      "firstInboxZero",
      "firstReportViewed",
    ]);

    const second = await session.mutation(api.onboarding.bootstrapWorkspace, {
      businessName: "Duplicate Studio",
      businessType: "agency",
      currency: "USD",
      skippedAi: true,
      skippedBank: true,
      skippedStripe: true,
    });
    expect(second.alreadyOnboarded).toBe(true);

    const counts = await t.run(async (ctx) => {
      const workspaces = await ctx.db.query("workspaces").collect();
      const entities = await ctx.db.query("entities").collect();
      const checklists = await ctx.db.query("onboardingChecklists").collect();
      return {
        workspaces: workspaces.length,
        entities: entities.length,
        checklists: checklists.length,
      };
    });
    expect(counts).toEqual({ workspaces: 1, entities: 1, checklists: 1 });
  });

  it("creates the first business inside an existing owner workspace", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "Ansar's workspace",
        slug: "ansar-workspace",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("workspaceMembers", {
        userId,
        workspaceId,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return { userId, workspaceId };
    });
    const session = authed(t, ids.userId, "owner@example.com");

    const result = await session.mutation(api.onboarding.bootstrapWorkspace, {
      businessName: "Z360",
      businessType: "services",
      currency: "USD",
      skippedAi: true,
      skippedBank: true,
      skippedStripe: true,
    });

    expect(result.workspaceId).toBe(ids.workspaceId);
    expect(result.entityId).toBeTruthy();
    expect(result.alreadyOnboarded).toBe(false);
    expect(result.accountsCreated).toBeGreaterThan(30);

    const businesses = await session.query(api.entities.list, {});
    expect(businesses.rows).toHaveLength(1);
    expect(businesses.rows[0]).toMatchObject({
      name: "Z360",
      businessType: "services",
      currency: "USD",
      isDemo: false,
    });

    const duplicate = await session.mutation(api.onboarding.bootstrapWorkspace, {
      businessName: "Should Not Create LLC",
      businessType: "agency",
      currency: "USD",
      skippedAi: true,
      skippedBank: true,
      skippedStripe: true,
    });
    expect(duplicate).toMatchObject({
      workspaceId: ids.workspaceId,
      entityId: null,
      alreadyOnboarded: true,
      accountsCreated: 0,
    });

    const counts = await t.run(async (ctx) => {
      const workspaces = await ctx.db.query("workspaces").collect();
      const entities = await ctx.db.query("entities").collect();
      const checklists = await ctx.db.query("onboardingChecklists").collect();
      return {
        workspaces: workspaces.length,
        entities: entities.length,
        checklists: checklists.length,
      };
    });
    expect(counts).toEqual({ workspaces: 1, entities: 1, checklists: 1 });
  });
});

describe("multi-business onboarding (E4-T2)", () => {
  it("creates two businesses, each with its own chart (incl. 3900) and default bank account", async () => {
    const t = convexTest(schema, modules);
    const userId = await insertUser(t, "multi-owner@example.com");
    const session = authed(t, userId, "multi-owner@example.com");

    const created = await session.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [
        { name: "Zikra LLC", businessType: "services" },
        { name: "Z360 BIZ LLC", businessType: "software" },
      ],
    });
    expect(created.alreadyOnboarded).toBe(false);
    expect(created.entityIds).toHaveLength(2);

    const businesses = await session.query(api.entities.list, {});
    expect(businesses.rows).toHaveLength(2);
    expect(businesses.rows.map((row) => row.name).sort()).toEqual(["Z360 BIZ LLC", "Zikra LLC"]);
    // USD lock holds even though the input omitted currency.
    expect(businesses.rows.every((row) => row.currency === "USD")).toBe(true);

    const ledger = await t.run(async (ctx) => {
      const entities = await ctx.db.query("entities").collect();
      const perEntity = await Promise.all(
        entities.map(async (entity) => {
          const accounts = await ctx.db
            .query("ledgerAccounts")
            .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
            .collect();
          const banks = await ctx.db
            .query("bankAccounts")
            .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
            .collect();
          return {
            accounts: accounts.length,
            has3900: accounts.some((account) => account.number === "3900"),
            banks: banks.length,
          };
        }),
      );
      return perEntity;
    });
    expect(ledger).toHaveLength(2);
    for (const entity of ledger) {
      expect(entity.accounts).toBeGreaterThan(30);
      expect(entity.has3900).toBe(true);
      expect(entity.banks).toBeGreaterThanOrEqual(1);
    }

    // Idempotency: re-running with the same membership does not duplicate.
    const second = await session.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Should Not Create", businessType: "agency" }],
    });
    expect(second.alreadyOnboarded).toBe(true);
    const after = await session.query(api.entities.list, {});
    expect(after.rows).toHaveLength(2);
  });

  it("addBusinessDuringOnboarding appends a business with its own chart", async () => {
    const t = convexTest(schema, modules);
    const userId = await insertUser(t, "append-owner@example.com");
    const session = authed(t, userId, "append-owner@example.com");

    await session.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "First Co", businessType: "services" }],
    });
    const appended = await session.mutation(api.onboarding.addBusinessDuringOnboarding, {
      name: "Second Co",
      businessType: "software",
    });
    expect(appended.entityId).toBeTruthy();
    expect(appended.accountsCreated).toBeGreaterThan(30);

    const businesses = await session.query(api.entities.list, {});
    expect(businesses.rows).toHaveLength(2);
  });
});

describe("onboarding state machine (E4-T1)", () => {
  async function ownerWithWorkspace(t: TestConvex<typeof schema>, email: string) {
    const userId = await insertUser(t, email);
    const session = authed(t, userId, email);
    await session.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "State Machine Co", businessType: "services" }],
    });
    return session;
  }

  it("getProgress returns a persisted record with a derived next step", async () => {
    const t = convexTest(schema, modules);
    const session = await ownerWithWorkspace(t, "progress@example.com");

    const progress = await session.query(api.onboarding.getProgress, {});
    expect(progress.phase).toBe("setup");
    expect(progress.stepOrder[0]).toBe("business");
    // Nothing settled yet -> next step is the first step.
    expect(progress.nextStep).toBe("business");
    expect(progress.completedSteps).toEqual([]);
    expect(progress.skippedSteps).toEqual([]);
  });

  it("markStep is idempotent and never duplicates step ids", async () => {
    const t = convexTest(schema, modules);
    const session = await ownerWithWorkspace(t, "idempotent@example.com");

    await session.mutation(api.onboarding.markStep, { step: "business", state: "complete" });
    await session.mutation(api.onboarding.markStep, { step: "business", state: "complete" });
    const first = await session.mutation(api.onboarding.markStep, { step: "ai", state: "complete" });

    expect(first.completedSteps).toEqual(["business", "ai"]);
    const progress = await session.query(api.onboarding.getProgress, {});
    expect(progress.completedSteps).toEqual(["business", "ai"]);
    expect(progress.flags.aiConnected).toBe(true);
    // Next unsettled step after business + ai is plunk.
    expect(progress.nextStep).toBe("plunk");
  });

  it("skipping persists a resume entry and moves complete<->skipped without dup", async () => {
    const t = convexTest(schema, modules);
    const session = await ownerWithWorkspace(t, "skip@example.com");

    await session.mutation(api.onboarding.markStep, { step: "business", state: "complete" });
    await session.mutation(api.onboarding.markStep, { step: "ai", state: "skipped" });
    await session.mutation(api.onboarding.markStep, { step: "plunk", state: "skipped" });

    let progress = await session.query(api.onboarding.getProgress, {});
    expect(progress.skippedSteps).toEqual(["ai", "plunk"]);
    expect(progress.completedSteps).toEqual(["business"]);
    expect(progress.flags.aiConnected).toBe(false);

    // Re-entering returns the saved currentStep (resume).
    expect(progress.currentStep).toBe("team");

    // Flipping ai from skipped to complete moves it without duplicating.
    await session.mutation(api.onboarding.markStep, { step: "ai", state: "complete" });
    progress = await session.query(api.onboarding.getProgress, {});
    expect(progress.skippedSteps).toEqual(["plunk"]);
    expect(progress.completedSteps).toEqual(["business", "ai"]);
    expect(progress.flags.aiConnected).toBe(true);
  });

  it("setPhase advances the onboarding phase", async () => {
    const t = convexTest(schema, modules);
    const session = await ownerWithWorkspace(t, "phase@example.com");

    await session.mutation(api.onboarding.setPhase, { phase: "ai-bulk-setup" });
    let progress = await session.query(api.onboarding.getProgress, {});
    expect(progress.phase).toBe("ai-bulk-setup");

    await session.mutation(api.onboarding.setPhase, { phase: "done" });
    progress = await session.query(api.onboarding.getProgress, {});
    expect(progress.phase).toBe("done");
  });
});

describe("opening balances step (E4-T5)", () => {
  async function ownerWithBusiness(t: TestConvex<typeof schema>, email: string) {
    const userId = await insertUser(t, email);
    const session = authed(t, userId, email);
    const created = await session.mutation(api.onboarding.bootstrapWorkspace, {
      businesses: [{ name: "Opening Balance Co", businessType: "services" }],
    });
    return { session, userId, entityId: created.entityIds[0] };
  }

  it("posts ONE balanced opening entry (asset debit = 3900 credit) dated first-of-month and ties the trial balance", async () => {
    const t = convexTest(schema, modules);
    const { session, entityId } = await ownerWithBusiness(t, "opening@example.com");

    const result = await session.mutation(api.onboarding.setOpeningBalances, {
      lines: [{ entityId, balanceMinor: 500000, startDate: "2026-03-17" }],
    });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].posted).toBe(true);
    const entryId = result.lines[0].entryId;
    expect(entryId).toBeTruthy();

    const detail = await t.run(async (ctx) => {
      const entry = await ctx.db.get(entryId!);
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const accounts = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      return { entry, lines, accounts };
    });

    // Dated the first day of the chosen start month (floored to M-01).
    expect(detail.entry?.date).toBe("2026-03-01");
    expect(detail.entry?.source).toBe("manual");

    // Exactly two lines, each a clean debit XOR credit, and balanced.
    const entryLines = detail.lines.filter((line) => line.entryId === entryId);
    expect(entryLines).toHaveLength(2);
    const debitTotal = entryLines.reduce((sum, line) => sum + line.debitMinor, 0);
    const creditTotal = entryLines.reduce((sum, line) => sum + line.creditMinor, 0);
    expect(debitTotal).toBe(500000);
    expect(creditTotal).toBe(500000);
    for (const line of entryLines) {
      expect((line.debitMinor > 0) !== (line.creditMinor > 0)).toBe(true);
    }

    // Equity (3900) is credited the full amount; the asset side is debited.
    const equityAccount = detail.accounts.find((account) => account.number === "3900")!;
    const equityLine = entryLines.find((line) => line.accountId === equityAccount._id)!;
    expect(equityLine.creditMinor).toBe(500000);
    expect(equityLine.debitMinor).toBe(0);
    const assetLine = entryLines.find((line) => line.accountId !== equityAccount._id)!;
    expect(assetLine.debitMinor).toBe(500000);

    // Whole-ledger trial balance ties (Σdebits === Σcredits across the entity).
    const totalDebit = detail.lines.reduce((sum, line) => sum + line.debitMinor, 0);
    const totalCredit = detail.lines.reduce((sum, line) => sum + line.creditMinor, 0);
    expect(totalDebit).toBe(totalCredit);

    // The step is marked complete + resumable.
    const progress = await session.query(api.onboarding.getProgress, {});
    expect(progress.flags.openingBalancesSet).toBe(true);
    expect(progress.completedSteps).toContain("openingBalances");
  });

  it("is idempotent on resume — re-running the step does not double-post", async () => {
    const t = convexTest(schema, modules);
    const { session, entityId } = await ownerWithBusiness(t, "opening-idem@example.com");

    await session.mutation(api.onboarding.setOpeningBalances, {
      lines: [{ entityId, balanceMinor: 250000, startDate: "2026-01-09" }],
    });
    const second = await session.mutation(api.onboarding.setOpeningBalances, {
      lines: [{ entityId, balanceMinor: 250000, startDate: "2026-01-09" }],
    });
    // The second run finds the existing entry and posts nothing new.
    expect(second.lines[0].posted).toBe(false);

    const entryCount = await t.run(async (ctx) => {
      const entries = await ctx.db
        .query("journalEntries")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      return entries.filter((entry) => entry.sourceId?.startsWith("opening:onboarding:")).length;
    });
    expect(entryCount).toBe(1);
  });

  it("a negative opening balance (credit card) reverses the legs and still ties", async () => {
    const t = convexTest(schema, modules);
    const { session, entityId } = await ownerWithBusiness(t, "opening-neg@example.com");

    const result = await session.mutation(api.onboarding.setOpeningBalances, {
      lines: [{ entityId, balanceMinor: -120000, startDate: "2026-02-20" }],
    });
    const entryId = result.lines[0].entryId!;

    const { equityLine, assetLine } = await t.run(async (ctx) => {
      const lines = await ctx.db
        .query("journalLines")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const accounts = await ctx.db
        .query("ledgerAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entityId))
        .collect();
      const equity = accounts.find((account) => account.number === "3900")!;
      const entryLines = lines.filter((line) => line.entryId === entryId);
      return {
        equityLine: entryLines.find((line) => line.accountId === equity._id)!,
        assetLine: entryLines.find((line) => line.accountId !== equity._id)!,
      };
    });
    // Negative balance debits equity / credits the asset.
    expect(equityLine.debitMinor).toBe(120000);
    expect(assetLine.creditMinor).toBe(120000);
  });

  it("skipping opening balances leaves openingBalancesSet false and is resumable", async () => {
    const t = convexTest(schema, modules);
    const { session } = await ownerWithBusiness(t, "opening-skip@example.com");

    await session.mutation(api.onboarding.markStep, { step: "openingBalances", state: "skipped" });
    const progress = await session.query(api.onboarding.getProgress, {});
    expect(progress.flags.openingBalancesSet).toBe(false);
    expect(progress.skippedSteps).toContain("openingBalances");
  });
});
