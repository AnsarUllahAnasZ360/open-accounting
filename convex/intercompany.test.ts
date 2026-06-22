/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { matchIntercompanyTransfers } from "./intercompany";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type TxnSeed = {
  entityId: Id<"entities">;
  amountMinor: number;
  date: string;
  merchant: string;
};

async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar workspace",
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

    async function entity(name: string, slug: string) {
      return ctx.db.insert("entities", {
        workspaceId,
        name,
        slug,
        businessType: "services",
        currency: "USD",
        isDemo: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    const zikraId = await entity("Zikra", "zikra");
    const z360Id = await entity("Z360", "z360");

    async function bankAccount(entityId: Id<"entities">) {
      const ledgerAccountId = await ctx.db.insert("ledgerAccounts", {
        entityId,
        name: "Operating Checking",
        type: "asset",
        subtype: "bank",
        number: "1010",
        currency: "USD",
        isSystem: true,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      return ctx.db.insert("bankAccounts", {
        entityId,
        ledgerAccountId,
        name: "Checking",
        mask: "0000",
        kind: "checking",
        balanceMinor: 0,
        includeInSync: true,
        createdAt: now,
        updatedAt: now,
      });
    }
    const zikraBank = await bankAccount(zikraId);
    const z360Bank = await bankAccount(z360Id);

    async function txn(seed: TxnSeed, bankAccountId: Id<"bankAccounts">) {
      return ctx.db.insert("transactions", {
        entityId: seed.entityId,
        bankAccountId,
        date: seed.date,
        amountMinor: seed.amountMinor,
        currency: "USD",
        merchant: seed.merchant,
        rawDescription: seed.merchant,
        status: "posted",
        review: "confirmed",
        source: "bank",
        externalId: `${seed.entityId}:${seed.merchant}:${seed.date}`,
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Matching pair: Zikra -$5,000 on 06-10, Z360 +$5,000 on 06-11 (exact net,
    // 1 day apart → HIGH tier).
    const fromTxnId = await txn(
      { entityId: zikraId, amountMinor: -5_000_00, date: "2026-06-10", merchant: "Transfer to Z360" },
      zikraBank,
    );
    const toTxnId = await txn(
      { entityId: z360Id, amountMinor: 5_000_00, date: "2026-06-11", merchant: "Transfer from Zikra" },
      z360Bank,
    );

    // Non-matching pair: outflow $9,999 way outside the ±5d window from the only
    // inflow → yields no candidate.
    await txn(
      { entityId: zikraId, amountMinor: -9_999_00, date: "2026-01-01", merchant: "Random vendor" },
      zikraBank,
    );

    return { userId, workspaceId, zikraId, z360Id, fromTxnId, toTxnId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|intercompany",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("matchIntercompanyTransfers (E5-T5)", () => {
  it("pairs an opposite-sign cross-entity match within tolerance and skips a non-match", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const all = await t.run((ctx) =>
      ctx.db.query("transactions").collect() as Promise<Array<Doc<"transactions">>>,
    );
    const candidates = matchIntercompanyTransfers(all);
    expect(candidates).toHaveLength(1);
    const [pair] = candidates;
    expect(String(pair.fromEntityId)).toBe(String(ids.zikraId));
    expect(String(pair.toEntityId)).toBe(String(ids.z360Id));
    expect(pair.amountMinor).toBe(5_000_00);
    expect(pair.tier).toBe("high");
  });

  it("yields nothing for a same-entity pair (intercompany is cross-entity only)", () => {
    const fakeEntity = "e1" as Id<"entities">;
    const sameEntityTxns = [
      {
        _id: "t1" as Id<"transactions">,
        entityId: fakeEntity,
        amountMinor: -100_00,
        date: "2026-06-01",
      },
      {
        _id: "t2" as Id<"transactions">,
        entityId: fakeEntity,
        amountMinor: 100_00,
        date: "2026-06-01",
      },
    ] as unknown as Array<Doc<"transactions">>;
    expect(matchIntercompanyTransfers(sameEntityTxns)).toHaveLength(0);
  });
});

describe("detect + confirm/reject (E5-T5)", () => {
  it("persists exactly one suggested link with an intercompanyPairId on confirm", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await t.mutation(internal.intercompany.detectForWorkspace, { workspaceId: ids.workspaceId });

    const suggestions = await session.query(api.intercompany.listIntercompanySuggestions, { scope: "all" });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.fromEntityName).toBe("Zikra");
    expect(suggestions[0]?.toEntityName).toBe("Z360");

    const linkId = suggestions[0]!.id;
    const confirmed = await session.mutation(api.intercompany.confirmIntercompany, { linkId });
    expect(confirmed.intercompanyPairId).toBeTruthy();

    // Both legs carry the pair id; no journal lines were written.
    const afterConfirm = await t.run(async (ctx) => {
      const from = await ctx.db.get(ids.fromTxnId);
      const to = await ctx.db.get(ids.toTxnId);
      const lines = await ctx.db.query("journalLines").collect();
      const link = await ctx.db.get(linkId);
      return {
        fromPair: from?.intercompanyPairId,
        toPair: to?.intercompanyPairId,
        lineCount: lines.length,
        status: link?.status,
      };
    });
    expect(afterConfirm.fromPair).toBe(confirmed.intercompanyPairId);
    expect(afterConfirm.toPair).toBe(confirmed.intercompanyPairId);
    expect(afterConfirm.lineCount).toBe(0);
    expect(afterConfirm.status).toBe("confirmed");

    // Detection re-run is idempotent (no duplicate link).
    await t.mutation(internal.intercompany.detectForWorkspace, { workspaceId: ids.workspaceId });
    const stillOpen = await session.query(api.intercompany.listIntercompanySuggestions, { scope: "all" });
    expect(stillOpen).toHaveLength(0); // confirmed → not "suggested"
  });

  it("clears the pair id on reject", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const session = authed(t, ids.userId);

    await t.mutation(internal.intercompany.detectForWorkspace, { workspaceId: ids.workspaceId });
    const suggestions = await session.query(api.intercompany.listIntercompanySuggestions, { scope: "all" });
    const linkId = suggestions[0]!.id;

    await session.mutation(api.intercompany.confirmIntercompany, { linkId });
    await session.mutation(api.intercompany.rejectIntercompany, { linkId });

    const afterReject = await t.run(async (ctx) => {
      const from = await ctx.db.get(ids.fromTxnId);
      const link = await ctx.db.get(linkId);
      return { fromPair: from?.intercompanyPairId, status: link?.status };
    });
    expect(afterReject.fromPair).toBeUndefined();
    expect(afterReject.status).toBe("rejected");
  });

  it("scopes suggestions to the caller's workspace only", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);

    // A second workspace + member who must never see workspace A's suggestions.
    const other = await t.run(async (ctx) => {
      const now = Date.now();
      const otherUserId = await ctx.db.insert("users", { email: "other@example.com", name: "Other" });
      const otherWorkspaceId = await ctx.db.insert("workspaces", {
        name: "Other workspace",
        slug: "other-workspace",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("workspaceMembers", {
        workspaceId: otherWorkspaceId,
        userId: otherUserId,
        role: "owner",
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      return { otherUserId };
    });

    await t.mutation(internal.intercompany.detectForWorkspace, { workspaceId: ids.workspaceId });

    const otherSession = authed(t, other.otherUserId);
    const otherView = await otherSession.query(api.intercompany.listIntercompanySuggestions, { scope: "all" });
    expect(otherView).toHaveLength(0);
  });
});
