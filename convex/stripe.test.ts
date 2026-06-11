/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

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
  inboxItemsCreated: number;
  ledgerEntriesPosted: number;
  skippedDuplicates: number;
};

const applyProjectionRef = makeFunctionReference<
  "mutation",
  {
    entityId: Id<"entities">;
    projection: ReturnType<typeof buildFixtureProjection>;
  },
  ApplyProjectionResult
>("stripe:applyProjection");

async function setupWorkspace(t: ReturnType<typeof convexTest>) {
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

function authed(t: ReturnType<typeof convexTest>, userId: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

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
    expect(first.inboxItemsCreated).toBe(1);
    expect(first.ledgerEntriesPosted).toBeGreaterThan(50);
    expect(second.incomeTransactionsCreated).toBe(0);
    expect(second.invoicesCreated).toBe(0);
    expect(second.payoutsCreated).toBe(0);
    expect(second.skippedDuplicates).toBeGreaterThan(0);

    const verification = await t.run(async (ctx) => {
      const [transactions, invoices, payouts, inboxItems, lines] = await Promise.all([
        ctx.db.query("transactions").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
        ctx.db.query("invoices").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
        ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
        ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
        ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
      ]);
      return {
        transactions,
        invoices,
        payouts,
        inboxItems,
        debitMinor: lines.reduce((sum, line) => sum + line.debitMinor, 0),
        creditMinor: lines.reduce((sum, line) => sum + line.creditMinor, 0),
      };
    });

    expect(verification.transactions).toHaveLength(25);
    expect(verification.invoices).toHaveLength(3);
    expect(verification.payouts.some((payout) => payout.status === "reconciled")).toBe(true);
    expect(verification.payouts.some((payout) => payout.status === "mismatch")).toBe(true);
    expect(verification.inboxItems.some((item) => item.kind === "payout_mismatch")).toBe(true);
    expect(verification.debitMinor).toBe(verification.creditMinor);
  });
});
