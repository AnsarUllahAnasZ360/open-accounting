import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";

/**
 * Opening-balance cutoff helpers.
 *
 * An entity may carry an `openingBalanceDate` (ISO `YYYY-MM-DD`, floored to the
 * first of its month). It means "my books start here": the opening balance entry
 * is dated that day, and everything DATED BEFORE it is history that must not
 * appear in the day-to-day surfaces (Dashboard, Inbox, Transactions).
 *
 * Nothing is deleted. Pre-cutoff rows stay in the database so exports, the audit
 * log, and reconciliation history remain complete — they are simply not part of
 * the working set.
 *
 * These helpers exist because the cutoff has to be enforced at EVERY read site
 * (`coreViews.dashboard`, `coreViews.inbox`, `coreViews.transactions`, …). A
 * connector that keeps back-filling old activity will re-introduce pre-cutoff
 * rows after the one-time archive pass, so read-time filtering is the backstop,
 * not an optimization.
 */

/**
 * Build the entityId -> cutoff-date lookup for a set of entities. Entities with
 * no `openingBalanceDate` are omitted, so an empty map means "no cutoff anywhere"
 * and callers can skip filtering entirely.
 */
export function cutoffsByEntity(
  entities: ReadonlyArray<Doc<"entities">>,
): Map<Id<"entities">, string> {
  return new Map(
    entities
      .filter((entity) => Boolean(entity.openingBalanceDate))
      .map((entity) => [entity._id, entity.openingBalanceDate!] as const),
  );
}

/**
 * True when a dated row belongs to the working set — i.e. its entity has no
 * cutoff, or the row is dated on/after that cutoff. A null/undefined date is
 * kept: an undated row (a question, a bare document) is not history we can
 * confidently place behind the cutoff.
 */
export function isWithinCutoff(
  cutoffs: ReadonlyMap<Id<"entities">, string>,
  entityId: Id<"entities">,
  date: string | null | undefined,
): boolean {
  const cutoff = cutoffs.get(entityId);
  if (!cutoff) return true;
  if (!date) return true;
  return date >= cutoff;
}

/** Convenience for the single-entity read paths (`coreViews.inbox`). */
export function isWithinEntityCutoff(
  entity: Doc<"entities">,
  date: string | null | undefined,
): boolean {
  if (!entity.openingBalanceDate) return true;
  if (!date) return true;
  return date >= entity.openingBalanceDate;
}

/* -------------------------------------------------------------------------- */
/* Scoped loaders — the working set, by default, everywhere                    */
/* -------------------------------------------------------------------------- */

/**
 * WHY THESE EXIST.
 *
 * The cutoff has to hold at EVERY read site, and enforcing it by hand in each
 * module did not scale: it was applied in 7 modules out of ~38, so Streams,
 * Income, Expenses, the AI/CFO signals and the weekly digest all kept reporting
 * figures the owner had told the system to leave behind. One screen said 300k
 * where the P&L said 80k, and both were reading the same books.
 *
 * So the cutoff stops being a filter each caller remembers to write, and becomes
 * a loader every caller goes through. Pair it with the coverage test
 * (`openingBalanceCoverage.test.ts`) and a module that reads entity-scoped
 * financial rows without one of these fails CI — the same discipline this repo
 * already applies to authorization.
 *
 * READ-ONLY. These never write, and they perform NO authorization: the caller
 * must have already resolved the entity through `assertScopeAuthorized` /
 * `getActiveEntity` and checked the workspace role.
 */

/**
 * Which slice of a business's books to read.
 *
 * `working` is the default at every call site ON PURPOSE. A caller that forgets
 * the argument gets the owner's actual books; the unsafe mode is the one you
 * have to type. (Decision D1 — Xero and QuickBooks both keep pre-conversion data
 * reachable rather than hidden; QuickBooks calls it "excluded".)
 */
export type BooksWindow =
  /** On/after the books-start date. The books as the owner defined them. */
  | "working"
  /** Strictly before the books-start date. History, read-only. */
  | "archived"
  /** No cutoff bound. Exports and the audit log ONLY — never a headline figure. */
  | "all";

export const booksWindowValidator = v.union(
  v.literal("working"),
  v.literal("archived"),
  v.literal("all"),
);

/**
 * Does a dated row belong to `window` for this entity?
 *
 * Used for tables with no date index (invoices, bills), where the bound cannot be
 * pushed down to the query. An undated row is treated as working-set: a bare
 * document is not history we can confidently place behind the cutoff.
 *
 * An entity with no cutoff has no archive, so `archived` is empty for it rather
 * than "everything" — the distinction matters on a workspace where one business
 * has re-based and another has not.
 */
export function isInBooksWindow(
  entity: Doc<"entities">,
  date: string | null | undefined,
  window: BooksWindow = "working",
): boolean {
  if (window === "all") return true;
  const cutoff = entity.openingBalanceDate;
  if (!cutoff) return window === "working";
  if (!date) return window === "working";
  return window === "working" ? date >= cutoff : date < cutoff;
}

/**
 * The indexed range bound for a window, or `null` when the whole table is in
 * scope (no cutoff, or `window: "all"`).
 *
 * Pushing the bound into the index means archived years are never READ, rather
 * than read and then discarded. On a re-based book that is also the difference
 * between fitting inside Convex's document budget and not.
 *
 * Returned as data rather than applied by a shared helper because Convex's range
 * builder narrows its type after the first bound (`gte` yields an upper-bound-only
 * builder), so a generic "apply to any query" wrapper cannot typecheck.
 */
function windowBound(
  entity: Doc<"entities">,
  window: BooksWindow,
): { kind: "gte" | "lt"; date: string } | null {
  const cutoff = entity.openingBalanceDate;
  if (!cutoff || window === "all") return null;
  return window === "working" ? { kind: "gte", date: cutoff } : { kind: "lt", date: cutoff };
}

type LoadOptions = {
  window?: BooksWindow;
  limit: number;
  /**
   * Narrow to a reporting period, ON TOP of the books window.
   *
   * Prefer this over a bare `limit` wherever the screen shows a period. A count
   * cap answers "give me some rows"; a date range answers "give me exactly the
   * rows this figure is computed from". The difference matters twice over:
   *
   *  - Convex's 4,096-document ceiling is far easier to stay under when the read
   *    is the month being displayed rather than the whole book.
   *  - Two screens showing the same period reconcile. Under count caps they
   *    truncate at different points and report different totals for the same
   *    books — which is the class of bug this module exists to prevent.
   */
  from?: string;
  to?: string;
};

/** Intersect the books-window bound with an optional reporting range. */
function effectiveBounds(
  entity: Doc<"entities">,
  options: LoadOptions,
): { from: string | null; to: string | null; exclusiveTo: boolean } {
  const window = options.window ?? "working";
  const bound = windowBound(entity, window);
  let from = options.from ?? null;
  let to = options.to ?? null;
  let exclusiveTo = false;

  if (bound?.kind === "gte") {
    // Books start here; never read earlier than the later of the two lower bounds.
    from = from && from > bound.date ? from : bound.date;
  } else if (bound?.kind === "lt") {
    // Archived window: strictly before the cutoff.
    if (to === null || to >= bound.date) {
      to = bound.date;
      exclusiveTo = true;
    }
  }
  return { from, to, exclusiveTo };
}

/**
 * Transactions in one business's books window, bounded at the index.
 *
 * NOTE the `review === "excluded"` rows are NOT filtered here. The cutoff sweep
 * marks pre-cutoff transactions excluded, but a caller may legitimately want the
 * archive with its own labelling — and callers that exclude for their own reasons
 * (settlement legs, transfers) already do so explicitly.
 */
export async function loadScopedTransactions(
  ctx: QueryCtx,
  entity: Doc<"entities">,
  options: LoadOptions & { order?: "asc" | "desc" },
): Promise<Doc<"transactions">[]> {
  const { from, to, exclusiveTo } = effectiveBounds(entity, options);
  const scoped = ctx.db
    .query("transactions")
    .withIndex("by_entity_and_date", (q) => {
      let base = q.eq("entityId", entity._id);
      if (from !== null) base = base.gte("date", from) as typeof base;
      if (to !== null) {
        base = (exclusiveTo ? base.lt("date", to) : base.lte("date", to)) as typeof base;
      }
      return base;
    });
  return (options.order === "desc" ? scoped.order("desc") : scoped).take(options.limit);
}

/**
 * Journal entries in one business's books window, bounded at the index.
 *
 * `order: "desc"` gives most-recent-first, for callers showing recent activity.
 * Note this changes WHICH entries survive the cap on a book larger than `limit`,
 * so it is the caller's decision, not a default.
 */
export async function loadScopedJournalEntries(
  ctx: QueryCtx,
  entity: Doc<"entities">,
  options: LoadOptions & { order?: "asc" | "desc" },
): Promise<Doc<"journalEntries">[]> {
  const { from, to, exclusiveTo } = effectiveBounds(entity, options);
  const scoped = ctx.db
    .query("journalEntries")
    .withIndex("by_entity_and_date", (q) => {
      let base = q.eq("entityId", entity._id);
      if (from !== null) base = base.gte("date", from) as typeof base;
      if (to !== null) {
        base = (exclusiveTo ? base.lt("date", to) : base.lte("date", to)) as typeof base;
      }
      return base;
    });
  return (options.order === "desc" ? scoped.order("desc") : scoped).take(options.limit);
}

/**
 * Invoices in one business's books window, keyed on `issueDate`.
 *
 * `invoices` carries no date index, so the bound is applied after a capped read
 * rather than pushed down. Acceptable because invoice counts are orders of
 * magnitude below transaction counts; revisit if that stops being true.
 *
 * ACCOUNTING RULE — read before choosing a window for invoices or bills:
 *
 *   RECOGNITION is governed by the cutoff. SETTLEMENT is not.
 *
 * A pre-cutoff invoice's REVENUE belongs to the prior period and must not appear
 * in the P&L or in stream attribution → `working`.
 *
 * That same invoice, if still UNPAID, is a real receivable on the books-start
 * date. It must keep appearing in AR, in the ageing, and in the invoice list, or
 * the owner loses sight of money they are owed → `all`.
 *
 * These are different questions about the same document, and they take different
 * windows. Bounding an AR figure at the cutoff understates assets; counting
 * pre-cutoff revenue overstates income. Both are wrong; they are not opposites of
 * each other.
 *
 * (Phase 3.6 completes this by posting opening AR/AP as part of the opening entry
 * — see plan §3.3. Until then, an unpaid pre-cutoff invoice shows in AR but has
 * no corresponding opening-balance leg.)
 */
export async function loadScopedInvoices(
  ctx: QueryCtx,
  entity: Doc<"entities">,
  options: LoadOptions,
): Promise<Doc<"invoices">[]> {
  const window = options.window ?? "working";
  const rows = await ctx.db
    .query("invoices")
    .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
    .take(options.limit);
  return rows.filter((row) => isInBooksWindow(entity, row.issueDate, window));
}

/** Bills in one business's books window, keyed on `issueDate`. Mirrors invoices. */
export async function loadScopedBills(
  ctx: QueryCtx,
  entity: Doc<"entities">,
  options: LoadOptions,
): Promise<Doc<"bills">[]> {
  const window = options.window ?? "working";
  const rows = await ctx.db
    .query("bills")
    .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
    .take(options.limit);
  return rows.filter((row) => isInBooksWindow(entity, row.issueDate, window));
}
