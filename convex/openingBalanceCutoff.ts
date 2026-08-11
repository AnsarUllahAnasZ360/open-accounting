import type { Doc, Id } from "./_generated/dataModel";

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
