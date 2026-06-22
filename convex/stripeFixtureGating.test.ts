/// <reference types="vite/client" />
import { makeFunctionReference } from "convex/server";
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { buildFixtureProjection, projectionFromStripeLists } from "./stripe";

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

const applyProjectionRef = makeFunctionReference<
  "mutation",
  {
    entityId: Id<"entities">;
    projection: ReturnType<typeof buildFixtureProjection>;
  },
  ApplyProjectionResult
>("stripe:applyProjection");

async function setupWorkspace(t: TestConvex<typeof schema>, isDemo: boolean) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace",
      slug: `ansar-workspace-${isDemo ? "demo" : "real"}`,
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
      name: isDemo ? "Demo Books" : "Live Sandbox",
      slug: isDemo ? "demo-books" : "live-sandbox",
      businessType: "services",
      currency: "USD",
      isDemo,
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

describe("E1-T1 Stripe fixture-payout gating", () => {
  // The fixture substitution lives in projectionFromStripeLists; the demo-vs-real
  // decision is made by the `includeFixturePayoutFallback` flag that the sync
  // callers derive from entity.isDemo.
  it("substitutes fixture payouts only when fixtures are explicitly allowed (demo path)", () => {
    const realProjection = projectionFromStripeLists({
      reason: "real sync, empty payouts",
      customers: [],
      paymentIntents: [],
      invoices: [],
      payouts: [],
      includeFixturePayoutFallback: false,
    });
    expect(realProjection.payouts).toHaveLength(0);

    const demoProjection = projectionFromStripeLists({
      reason: "demo sync, empty payouts",
      customers: [],
      paymentIntents: [],
      invoices: [],
      payouts: [],
      includeFixturePayoutFallback: true,
    });
    // The demo experience is unchanged: the 2 deterministic fixture payouts appear.
    expect(demoProjection.payouts).toHaveLength(buildFixtureProjection().payouts.length);
    expect(demoProjection.payouts.length).toBe(2);
  });

  it("defaults the fallback OFF so an omitted flag never injects fixtures", () => {
    const projection = projectionFromStripeLists({
      reason: "default behavior",
      customers: [],
      paymentIntents: [],
      invoices: [],
      payouts: [],
    });
    expect(projection.payouts).toHaveLength(0);
  });

  it("posts ZERO payout entries and NO payout_mismatch card for a real entity with empty payouts", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t, false);
    const session = authed(t, ids.userId);

    const emptyRealProjection = {
      mode: "stripe_test" as const,
      reason: "real sync returned zero payouts",
      customers: [],
      income: [],
      invoices: [],
      payouts: [],
    };

    const result = await session.mutation(applyProjectionRef, {
      entityId: ids.entityId,
      projection: emptyRealProjection,
    });

    expect(result.payoutsCreated).toBe(0);
    expect(result.payoutLinesCreated).toBe(0);
    expect(result.ledgerEntriesPosted).toBe(0);

    const verification = await t.run(async (ctx) => {
      const [payouts, inboxItems, lines] = await Promise.all([
        ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
        ctx.db.query("inboxItems").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
        ctx.db.query("journalLines").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
      ]);
      return { payouts, inboxItems, lines };
    });

    expect(verification.payouts).toHaveLength(0);
    expect(verification.inboxItems.some((item) => item.kind === "payout_mismatch")).toBe(false);
    expect(verification.lines).toHaveLength(0);
  });

  it("still posts the 2 fixture payouts for a demo entity (demo experience unchanged)", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t, true);
    const session = authed(t, ids.userId);

    // A demo sync resolves its projection through projectionFromStripeLists with
    // the fallback ON, producing the 2 fixture payouts; applyProjection then posts
    // them. We feed that resolved projection here.
    const demoProjection = {
      ...buildFixtureProjection(),
      income: [],
      invoices: [],
      customers: [],
    };

    const result = await session.mutation(applyProjectionRef, {
      entityId: ids.entityId,
      projection: demoProjection,
    });

    expect(result.payoutsCreated).toBe(2);

    const payouts = await t.run(async (ctx) =>
      ctx.db.query("stripePayouts").withIndex("by_entity", (q) => q.eq("entityId", ids.entityId)).collect(),
    );
    expect(payouts).toHaveLength(2);
  });
});
