/**
 * Convex read budgets.
 *
 * THE CEILING IS 4,096 DOCUMENTS READ PER FUNCTION EXECUTION.
 *
 *   "Too many reads in a single function execution (limit: 4096). Consider using
 *    smaller limits in your queries, paginating your queries, or using indexed
 *    queries with selective index range expressions."
 *
 * Older comments across this codebase cite 32k. They are wrong, and the wrong
 * number is why several screens shipped with `.take(5000)` or `.take(20000)` —
 * caps that exceed the whole transaction's allowance on a single table, before
 * anything else is read.
 *
 * Three things make this easy to get wrong:
 *
 *  1. The limit is per FUNCTION, not per query. A handler reading eight tables
 *     spends one budget across all eight.
 *  2. Journal entries drag their lines behind them — roughly three documents per
 *     entry, so an entry cap of N costs about 3N.
 *  3. A multi-business (portfolio) read multiplies everything by the number of
 *     businesses. A cap that fits one business fails at two.
 *
 * So: budget below the ceiling, divide by the number of entities in scope, and
 * report `truncated` rather than throwing. A partial figure that says it is
 * partial beats an exception, and both beat a confident wrong number.
 */

/** The hard runtime ceiling. Never budget to this — leave headroom. */
export const CONVEX_READ_LIMIT = 4096;

/**
 * What a single handler may plan to read. The gap to the ceiling absorbs
 * incidental reads (auth lookups, entity resolution, a `ctx.db.get` in a loop)
 * that are easy to forget when counting.
 */
export const HANDLER_READ_BUDGET = 3000;

/**
 * Default cap for one table on a single-entity screen that reads several tables.
 * Roughly six tables at this cap fits inside the handler budget.
 */
export const TABLE_READ_LIMIT = 400;

/** Cap for small, bounded tables — bank accounts, payroll runs, period locks. */
export const SMALL_TABLE_READ_LIMIT = 60;

/**
 * Divide a cap across the businesses in scope.
 *
 * The budget belongs to the TRANSACTION, not to the business. Applying a
 * per-entity cap once per entity is exactly what made "All businesses" exceed
 * the ceiling while each business alone rendered fine.
 */
export function perEntity(limit: number, entityCount: number, floor = 60): number {
  const count = Math.max(1, entityCount);
  return Math.max(floor, Math.min(limit, Math.floor(limit / count)));
}
