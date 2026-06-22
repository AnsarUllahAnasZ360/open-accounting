import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { getPublicDemoWorkspace } from "./demoWorkspace";

// ---------------------------------------------------------------------------
// Public, NO-LOGIN demo view (Epic E4-T10 / E11-T5).
//
// The single shared PUBLIC demo workspace is resolved entirely on the SERVER via
// the E11-T2 registry (`isDemo === true && demoKind === 'public'`) — never by a
// client-supplied id, never by the legacy `acme-studio-llc` slug, and never
// behind any user identity (no anonymous Convex Auth identity is minted, decided
// Q56). Reads are allowed ONLY because the workspace is the flagged public demo;
// this server-side resolution (not UI hiding) is the boundary, so the route is
// safe for truly unauthenticated visitors and can read ONLY the demo workspace.
//
// The demo BACKEND (provisioning the shared workspace + the daily reset cron) is
// OWNED by E11 (`publicDemo.ts` + `crons.ts`). There is NO mutation here — a demo
// visitor cannot change any workspace; the write boundary is `assertNotDemoWrite`
// (E11-T6) on every workspace-scoped mutation.
// ---------------------------------------------------------------------------

async function resolveDemoWorkspace(ctx: QueryCtx): Promise<Doc<"workspaces"> | null> {
  // Server-side registry resolution — the visitor passes nothing. Resolves the
  // single `demoKind === 'public'` workspace, so a `'seed'`-kind in-workspace
  // demo is never exposed by the public route.
  return getPublicDemoWorkspace(ctx);
}

function pickDemoEntity(entities: Doc<"entities">[]): Doc<"entities"> | null {
  const active = entities.filter((entity) => !entity.archived);
  // Prefer the seeded demo entity, then any active entity.
  return active.find((entity) => entity.isDemo) ?? active[0] ?? null;
}

/**
 * Read-only populated demo data for the public `/demo` route. Returns null when
 * no demo workspace is provisioned (the route renders a graceful "demo not
 * available" state). Never requires auth; never exposes another workspace.
 */
export const demoView = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const workspace = await resolveDemoWorkspace(ctx);
    if (!workspace) {
      return { available: false as const };
    }

    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const entity = pickDemoEntity(entities);
    if (!entity) {
      return { available: false as const };
    }

    const limit = Math.max(1, Math.min(args.limit ?? 50, 200));
    const txnRows = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .order("desc")
      .take(limit);

    // Resolve category + contact display labels for the read-only table.
    const accountIds = new Set<Id<"ledgerAccounts">>();
    const contactIds = new Set<Id<"contacts">>();
    for (const txn of txnRows) {
      if (txn.categoryAccountId) accountIds.add(txn.categoryAccountId);
      if (txn.contactId) contactIds.add(txn.contactId);
    }
    const accounts = await Promise.all([...accountIds].map((id) => ctx.db.get(id)));
    const contacts = await Promise.all([...contactIds].map((id) => ctx.db.get(id)));
    const accountName = new Map(
      accounts.filter((a): a is Doc<"ledgerAccounts"> => a !== null).map((a) => [a._id, a.name]),
    );
    const contactName = new Map(
      contacts.filter((c): c is Doc<"contacts"> => c !== null).map((c) => [c._id, c.name]),
    );

    const transactions = txnRows.map((txn) => ({
      id: txn._id,
      date: txn.date,
      merchant: txn.merchant,
      amountMinor: txn.amountMinor,
      currency: txn.currency,
      category: txn.categoryAccountId ? accountName.get(txn.categoryAccountId) ?? null : null,
      contact: txn.contactId ? contactName.get(txn.contactId) ?? null : null,
      review: txn.review,
    }));

    return {
      available: true as const,
      workspace: { name: workspace.name },
      entity: { name: entity.name, currency: entity.currency },
      transactionCount: transactions.length,
      transactions,
    };
  },
});

/**
 * Read-only demo CONTEXT (Epic E11-T5). Returns the public demo workspace +
 * default entity identity for the no-login `/demo` route WITHOUT any auth and
 * WITHOUT minting an anonymous identity. The shell reads this to know it is in a
 * read-only demo and which entity to point at. Returns `available: false` for a
 * deployment with no public demo so the route degrades gracefully — and it can
 * NEVER return a real workspace (it resolves only the `demoKind === 'public'`
 * row via the registry).
 */
export const demoContext = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await resolveDemoWorkspace(ctx);
    if (!workspace) {
      return { available: false as const };
    }
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const entity = pickDemoEntity(entities);
    if (!entity) {
      return { available: false as const };
    }
    return {
      available: true as const,
      readOnly: true as const,
      workspace: { id: workspace._id, name: workspace.name, slug: workspace.slug },
      entity: { id: entity._id, name: entity.name, currency: entity.currency },
    };
  },
});

/**
 * Read-only dashboard summary for the public `/demo` route (Epic E11-T5). A
 * compact set of ledger-derived headline figures so the demo "renders the
 * dashboard" rather than only a transaction list. Auth-free; reads ONLY the
 * public demo entity. All money is integer minor units.
 */
export const demoDashboard = query({
  args: {},
  handler: async (ctx) => {
    const workspace = await resolveDemoWorkspace(ctx);
    if (!workspace) {
      return { available: false as const };
    }
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
      .collect();
    const entity = pickDemoEntity(entities);
    if (!entity) {
      return { available: false as const };
    }

    const transactions = await ctx.db
      .query("transactions")
      .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
      .take(5000);

    let incomeMinor = 0;
    let expenseMinor = 0;
    let openInbox = 0;
    for (const txn of transactions) {
      if (txn.review === "needs_review") openInbox += 1;
      if (txn.amountMinor > 0) incomeMinor += txn.amountMinor;
      else expenseMinor += Math.abs(txn.amountMinor);
    }

    return {
      available: true as const,
      readOnly: true as const,
      workspace: { name: workspace.name },
      entity: { name: entity.name, currency: entity.currency },
      summary: {
        transactionCount: transactions.length,
        moneyInMinor: incomeMinor,
        moneyOutMinor: expenseMinor,
        netMinor: incomeMinor - expenseMinor,
        openInboxCount: openInbox,
      },
    };
  },
});
