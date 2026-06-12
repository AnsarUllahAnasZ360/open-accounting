/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  buildFixtureProjection,
  classifyStripeKeyForTest,
} from "./stripe";

const modules = import.meta.glob("./**/*.ts");

type ApplyProjectionResult = {
  contactsCreated: number;
  incomeTransactionsCreated: number;
	  invoicesCreated: number;
	  payoutsCreated: number;
	  payoutLinesCreated: number;
	  inboxItemsCreated: number;
	  ledgerEntriesPosted: number;
	  skippedDuplicates: number;
	};

type WebhookSyncResult = {
  status: "synced" | "ignored" | "skipped" | "error";
  reason: string;
  result?: ApplyProjectionResult;
};

const applyProjectionRef = makeFunctionReference<
  "mutation",
  {
    entityId: Id<"entities">;
    projection: ReturnType<typeof buildFixtureProjection>;
  },
  ApplyProjectionResult
>("stripe:applyProjection");
const syncFromWebhookEventRef = makeFunctionReference<
  "action",
  {
    stripeEventId: string;
    type: string;
    objectId?: string;
    relatedPaymentIntentId?: string;
  },
  WebhookSyncResult
>("stripe:syncFromWebhookEvent");

async function setupWorkspace(t: TestConvex<typeof schema>) {
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
      name: "Live Sandbox",
      slug: "live-sandbox",
      businessType: "services",
      currency: "USD",
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, workspaceId, entityId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("M8 Stripe projection", () => {
  it("rejects missing, live, and unknown keys before any Stripe call", () => {
    expect(classifyStripeKeyForTest(undefined)).toMatchObject({
      configured: false,
      mode: "missing",
      safeToCallStripe: false,
    });
    expect(classifyStripeKeyForTest(["sk", "live", "never_allowed"].join("_"))).toMatchObject({
      configured: true,
      mode: "live",
      safeToCallStripe: false,
    });
    expect(classifyStripeKeyForTest(["rk", "test", "allowed"].join("_"))).toMatchObject({
      configured: true,
      mode: "test",
      safeToCallStripe: true,
    });
  });

  it("builds deterministic fixture-mode seed and payout reconciliation data", () => {
    const fixture = buildFixtureProjection();
    expect(fixture.customers).toHaveLength(10);
    expect(fixture.income).toHaveLength(25);
    expect(fixture.invoices).toHaveLength(3);
    expect(fixture.payouts[0].grossMinor - fixture.payouts[0].feesMinor - fixture.payouts[0].amountMinor).toBe(0);
    expect(fixture.payouts[1].grossMinor - fixture.payouts[1].feesMinor - fixture.payouts[1].amountMinor).not.toBe(0);
  });

	  it("applies fixture projection through contacts, transactions, invoices, postEntry, and mismatch Inbox cards", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const fixture = buildFixtureProjection();

    const first = await session.mutation(applyProjectionRef, {
      entityId: ids.entityId,
      projection: fixture,
    });
    const second = await session.mutation(applyProjectionRef, {
      entityId: ids.entityId,
      projection: fixture,
    });

    expect(first.contactsCreated).toBe(10);
    expect(first.incomeTransactionsCreated).toBe(25);
	    expect(first.invoicesCreated).toBe(3);
	    expect(first.payoutsCreated).toBe(2);
	    expect(first.payoutLinesCreated).toBe(fixture.payouts.reduce((sum, payout) => sum + payout.lines.length, 0));
	    expect(first.inboxItemsCreated).toBe(1);
	    expect(first.ledgerEntriesPosted).toBeGreaterThan(50);
	    expect(second.incomeTransactionsCreated).toBe(0);
	    expect(second.invoicesCreated).toBe(0);
	    expect(second.payoutsCreated).toBe(0);
	    expect(second.payoutLinesCreated).toBe(0);
	    expect(second.skippedDuplicates).toBeGreaterThan(0);

	    const verification = await t.run(async (ctx) => {
	      const [transactions, invoices, payouts, payoutLines, inboxItems, lines] = await Promise.all([
	        ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
	        ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
	        ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
	        ctx.db.query("stripePayoutLines").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
	        ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
	        ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
	      ]);
      return {
	        transactions,
	        invoices,
	        payouts,
	        payoutLines,
	        inboxItems,
        debitMinor: lines.reduce((sum, line) => sum + line.debitMinor, 0),
        creditMinor: lines.reduce((sum, line) => sum + line.creditMinor, 0),
      };
    });

    expect(verification.transactions).toHaveLength(25);
	    expect(verification.invoices).toHaveLength(3);
	    expect(verification.payouts.some((payout) => payout.status === "reconciled")).toBe(true);
	    expect(verification.payouts.some((payout) => payout.status === "mismatch")).toBe(true);
	    expect(verification.payoutLines).toHaveLength(fixture.payouts.reduce((sum, payout) => sum + payout.lines.length, 0));
	    expect(verification.payoutLines.every((line) => line.grossMinor - line.feeMinor === line.netMinor)).toBe(true);
	    expect(verification.inboxItems.some((item) => item.kind === "payout_mismatch")).toBe(true);
	    expect(verification.debitMinor).toBe(verification.creditMinor);
	  });

  it("updates an existing Stripe invoice status instead of duplicating the invoice", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);
    const fixture = buildFixtureProjection();
    const invoice = fixture.invoices[0];

    await session.mutation(applyProjectionRef, {
      entityId: ids.entityId,
      projection: {
        ...fixture,
        income: [],
        invoices: [invoice],
        payouts: [],
      },
    });
    const update = await session.mutation(applyProjectionRef, {
      entityId: ids.entityId,
      projection: {
        ...fixture,
        income: [],
        invoices: [{ ...invoice, status: "paid", amountPaidMinor: invoice.totalMinor }],
        payouts: [],
      },
    });

    expect(update.invoicesCreated).toBe(0);
    expect(update.skippedDuplicates).toBe(1);
    const invoices = await t.run(async (ctx) =>
      await ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
    );
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({
      number: invoice.number,
      status: "paid",
      amountPaidMinor: invoice.totalMinor,
      source: "stripe",
    });
  });

  it("syncs a payout webhook through Stripe test APIs, system actor posting, and persisted payout lines", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", ["sk", "test", "webhook"].join("_"));
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/payouts/po_webhook_001")) {
        return new Response(
          JSON.stringify({
            id: "po_webhook_001",
            amount: 9_700,
            currency: "usd",
            arrival_date: 1_780_000_000,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.includes("/balance_transactions")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "txn_fee_1",
                amount: 5_000,
                fee: 145,
                net: 4_855,
                currency: "usd",
                source: "ch_webhook_1",
                description: "Webhook charge one",
              },
              {
                id: "txn_fee_2",
                amount: 5_000,
                fee: 155,
                net: 4_845,
                currency: "usd",
                source: "ch_webhook_2",
                description: "Webhook charge two",
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: { message: `Unexpected URL ${url}` } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const result = await t.action(syncFromWebhookEventRef, {
      stripeEventId: "evt_webhook_payout_001",
      type: "payout.paid",
      objectId: "po_webhook_001",
    });

    expect(result.status).toBe("synced");
    expect(result.result?.payoutsCreated).toBe(1);
    expect(result.result?.payoutLinesCreated).toBe(2);
    expect(result.result?.ledgerEntriesPosted).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const verification = await t.run(async (ctx) => {
      const [payouts, payoutLines, journalLines, audits, systemActors] = await Promise.all([
        ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
        ctx.db.query("stripePayoutLines").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
        ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
        ctx.db.query("auditEvents").withIndex("by_workspace", (q) => q.eq("workspaceId", ids.workspaceId)).collect(),
        ctx.db.query("systemActors").withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", ids.workspaceId).eq("kind", "sync")).collect(),
      ]);
      return {
        payouts,
        payoutLines,
        debitMinor: journalLines.reduce((sum, line) => sum + line.debitMinor, 0),
        creditMinor: journalLines.reduce((sum, line) => sum + line.creditMinor, 0),
        auditActions: audits.map((audit) => audit.action),
        systemActors,
      };
    });

    expect(verification.payouts).toHaveLength(1);
    expect(verification.payouts[0]).toMatchObject({ payoutId: "po_webhook_001", status: "reconciled" });
    expect(verification.payoutLines).toHaveLength(2);
    expect(verification.payoutLines.reduce((sum, line) => sum + line.netMinor, 0)).toBe(9_700);
    expect(verification.debitMinor).toBe(verification.creditMinor);
    expect(verification.auditActions).toContain("system.sync.stripe.ledger_entry.posted");
    expect(verification.systemActors).toHaveLength(1);
  });

  it("refuses live Stripe keys before webhook sync can call Stripe", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", ["sk", "live", "blocked"].join("_"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const t = convexTest(schema, modules);

    const result = await t.action(syncFromWebhookEventRef, {
      stripeEventId: "evt_live_rejected",
      type: "payout.paid",
      objectId: "po_live_never",
    });

    expect(result.status).toBe("skipped");
    expect(result.reason).toMatch(/test-mode keys/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
	});
