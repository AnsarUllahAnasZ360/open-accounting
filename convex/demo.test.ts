/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("public demo view (E4-T10)", () => {
  it("returns populated, read-only transactions for the flagged demo workspace WITHOUT auth", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const now = Date.now();
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "OpenBooks Demo",
        slug: "openbooks-demo",
        isDemo: true,
        // E11-T5: the public demo is now resolved via the registry
        // (`demoKind === 'public'`), not merely `isDemo`, so a `'seed'`-kind demo
        // is never exposed by the public route.
        demoKind: "public",
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
      for (let i = 0; i < 3; i += 1) {
        await ctx.db.insert("transactions", {
          entityId,
          date: `2026-0${i + 1}-10`,
          amountMinor: -(1000 + i * 250),
          currency: "USD",
          merchant: `Demo Vendor ${i + 1}`,
          rawDescription: "demo",
          status: "posted",
          review: "auto",
          source: "bank",
          externalId: `demo-txn-${i}`,
          evalSet: false,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    // No identity — a truly unauthenticated visitor.
    const view = await t.query(api.demo.demoView, {});
    expect(view.available).toBe(true);
    if (view.available) {
      expect(view.workspace.name).toBe("OpenBooks Demo");
      expect(view.transactionCount).toBe(3);
      expect(view.transactions.length).toBe(3);
      expect(view.transactions[0].merchant).toContain("Demo Vendor");
    }
  });

  it("reports unavailable when no demo workspace is flagged (does not leak real workspaces)", async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const now = Date.now();
      // A REAL (non-demo) workspace must never be exposed by the demo route.
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "Real Co",
        slug: "real-co",
        createdAt: now,
        updatedAt: now,
      });
      const entityId = await ctx.db.insert("entities", {
        workspaceId,
        name: "Real Business",
        slug: "real-business",
        businessType: "services",
        currency: "USD",
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("transactions", {
        entityId,
        date: "2026-01-01",
        amountMinor: -5000,
        currency: "USD",
        merchant: "Private Vendor",
        rawDescription: "private",
        status: "posted",
        review: "auto",
        source: "bank",
        externalId: "private-1",
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
    });

    const view = await t.query(api.demo.demoView, {});
    expect(view.available).toBe(false);
  });
});
