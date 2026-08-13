/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

import { CONVEX_READ_LIMIT, HANDLER_READ_BUDGET, perEntity, TABLE_READ_LIMIT } from "./readBudget";

/**
 * READ-BUDGET GATE.
 *
 * Convex allows 4,096 document reads per function execution. Several handlers
 * shipped with `.take(5000)` and `.take(20000)` because comments across this
 * codebase cited 32k, and nothing checked. The result was a hard runtime failure
 * on the "All businesses" dashboard:
 *
 *   "Too many reads in a single function execution (limit: 4096)"
 *
 * A cap above the ceiling is not a tuning choice — it is a query that cannot
 * succeed on a real book. This test finds them in source before a user does.
 */

const sources = import.meta.glob<string>("./*.ts", { query: "?raw", import: "default", eager: true });

/** Any `.take(<number>)` literal in a module. */
const TAKE_LITERAL = /\.take\(\s*(\d+)\s*\)/g;

/**
 * The largest single-table read we permit anywhere.
 *
 * Deliberately well under the ceiling: the limit is per FUNCTION, not per query,
 * so a handler touching six tables has to fit all six inside 4,096 — and a
 * multi-business read multiplies everything again.
 */
const MAX_SINGLE_TAKE = 2000;

/**
 * Modules allowed to exceed it, with a reason. These are bulk/maintenance paths
 * that page or run outside a user-facing query, not screens.
 */
const EXEMPT: Record<string, string> = {
  "workspaceReset.ts": "destructive bulk reset; batches and reschedules itself",
  "dataLifecycle.ts": "retention sweep; batched background job",
  "seedDemo.ts": "demo fixture seeding, not a user-facing read path",
  "demo.ts": "demo fixture seeding",
  "publicDemo.ts": "public demo surface, fixed-size fixture",
  "realTestReset.ts": "test reset helper",
  "testSupport.ts": "test helpers",
  "performance.ts": "deliberately measures raw table sizes against the limits",
  "readBudget.ts": "the module documenting these limits quotes them in prose",
};

describe("Convex read budgets", () => {
  it("keeps the documented ceiling and budget in the right order", () => {
    expect(CONVEX_READ_LIMIT).toBe(4096);
    // Budget must leave headroom for incidental reads the handler does not plan.
    expect(HANDLER_READ_BUDGET).toBeLessThan(CONVEX_READ_LIMIT);
    expect(TABLE_READ_LIMIT).toBeLessThan(HANDLER_READ_BUDGET);
  });

  it("divides a cap across the businesses in scope", () => {
    // The budget belongs to the transaction, not the business. Applying a
    // per-entity cap once per entity is what broke "All businesses".
    expect(perEntity(400, 1)).toBe(400);
    expect(perEntity(400, 2)).toBe(200);
    expect(perEntity(400, 4)).toBe(100);
    // Never below the floor, so a large portfolio truncates rather than
    // returning a figure built from nothing.
    expect(perEntity(400, 100)).toBe(60);
  });

  it("has no single .take() above the per-function ceiling", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      const name = path.replace(/^\.\//, "");
      if (name.endsWith(".test.ts") || name in EXEMPT) continue;
      for (const match of source.matchAll(TAKE_LITERAL)) {
        const value = Number(match[1]);
        if (value > MAX_SINGLE_TAKE) offenders.push(`${name}: .take(${value})`);
      }
    }
    // A cap above this cannot succeed once the handler's other reads are added.
    // Bound the query by an indexed DATE RANGE instead of a bigger number — see
    // openingBalanceCutoff.loadScoped* and the `from`/`to` options.
    expect(offenders).toEqual([]);
  });
});
