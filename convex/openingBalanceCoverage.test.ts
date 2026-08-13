/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

/**
 * Opening-balance cutoff COVERAGE GATE (remediation plan, task 2.4).
 *
 * The cutoff has to hold at every entity-scoped read site. It did not: it was
 * applied in 7 modules out of ~38, so Streams reported a business's whole
 * pre-cutoff history while the P&L reported only the working set — the same
 * books, two different revenue totals, depending on which screen you opened.
 *
 * Fixing those modules one by one does not stop it happening again. This does.
 * It is a static source scan, deliberately modelled on `authzCoverage.test.ts`:
 * a module that reads entity-scoped financial rows must either go through the
 * scoped loaders in `openingBalanceCutoff.ts`, or appear on one of the two lists
 * below with a stated reason.
 *
 * The lists are the point. Every entry is a decision someone made on purpose,
 * written down where the next person will read it.
 */

const sources = import.meta.glob<string>("./*.ts", { query: "?raw", import: "default", eager: true });

/** Entity-scoped tables whose rows carry a date that the cutoff governs. */
const GUARDED_TABLES = ["transactions", "invoices", "bills", "journalEntries"] as const;

const READS_GUARDED_TABLE = new RegExp(`query\\("(${GUARDED_TABLES.join("|")})"\\)`);
const USES_SCOPED_LOADER = /from "\.\/openingBalanceCutoff"/;

/**
 * PERMANENTLY EXEMPT — reading the full history here is correct, and filtering
 * these would be the bug.
 */
const EXEMPT: Record<string, string> = {
  // Owns the cutoff. Filtering itself would be circular.
  "openingBalanceCutoff.ts": "defines the cutoff and the scoped loaders",
  // Must see behind the cutoff — that is the whole job.
  "openingBalanceDiagnostics.ts": "compares ledger vs bank across the FULL history to expose the double-count",
  "onboarding.ts": "runs the re-base sweep; it exists to find and reverse pre-cutoff entries",

  // Already cutoff-aware by a different mechanism (a direct `openingBalanceDate`
  // index bound rather than the shared loader). Migrating them to the loader is
  // tidy-up, not a correctness gap.
  "entityMetrics.ts": "date-bounds the journal load on entity.openingBalanceDate directly",
  "reportViews.ts": "date-bounds every report loader on entity.openingBalanceDate directly",
  "unreviewedGap.ts": "date-bounds the needs-review count on entity.openingBalanceDate directly",
  "coreViews.ts": "uses the loaders AND cutoffsByEntity; listed for completeness",

  // WRITE / CLASSIFY paths. These decide whether a row may be created or posted;
  // the cutoff is enforced there by refusing the write (pipeline.ts, stripe.ts),
  // not by hiding rows from a reader.
  "ledger.ts": "the single posting path; must read any entry to post against it",
  "pipeline.ts": "classification write path; enforces the cutoff by REFUSING pre-cutoff posts",
  "plaid.ts": "connector ingest; dedupes against full history before the cutoff applies",
  "stripe.ts": "connector ingest; skips pre-cutoff items explicitly at write time",
  "receipts.ts": "document ingest write path",
  "rules.ts": "rule matching over candidate rows at write time",
  "payrollSettlement.ts": "settlement matcher; pairs a payout to its bank row at write time",

  // Full-fidelity reads that must NOT be filtered.
  "exportAccount.ts": "a full account export must contain the complete history",
  "performance.ts": "measures raw table sizes; filtering would misreport the limits",

  // Fixtures and demo data, not owner-facing books.
  "demo.ts": "demo fixture seeding",
  "seedDemo.ts": "demo fixture seeding",
  "insightsFixtures.ts": "test fixtures",
  "testSupport.ts": "test helpers",
  "realTestReset.ts": "test reset helper",
  "workspaceReset.ts": "destructive reset; operates on everything by design",
  "publicDemo.ts": "public demo surface",
  "entities.ts": "entity CRUD; reads rows to decide deletion safety, not to report figures",

  // Invoice NUMBERING must span the whole history. `nextInvoiceNumber` scans every
  // invoice to find the highest OB-nnnn; bounding it at the cutoff would reissue a
  // number already used before the re-base — two invoices, one number, which is a
  // worse defect than the one the cutoff exists to fix. This module's only guarded
  // read is that scan; the AR list and ageing live in incomeViews/reportViews and
  // ARE bounded.
  "invoices.ts": "nextInvoiceNumber must see all history to keep invoice numbers unique",

  // The materialisation itself. It sums the ledger and must therefore see ALL of
  // it — a cutoff-bounded rebuild would produce balances that disagree with the
  // lines they summarise. The cutoff is applied when these balances are READ
  // (entityMetrics.loadEntityBalances sums month buckets from the books-start
  // date), which is the right layer for it.
  "ledgerBalances.ts": "materialises balances from the whole ledger; the cutoff is applied on read",
};

/**
 * PENDING MIGRATION — recorded debt, not approval.
 *
 * These are owner-facing reads that should go through the scoped loaders and do
 * not yet. Each one can still show pre-cutoff figures on a re-based book. This
 * list must only ever SHRINK; the assertion below fails if a new module appears
 * without a decision.
 *
 * Tracked as plan task 2.2 (remaining) — see
 * docs/finishing/opening-balance-remediation-plan.md.
 */
const PENDING_MIGRATION: Record<string, string> = {
  "reconciliation.ts": "worksheet can still offer pre-cutoff rows for matching",
  "intercompany.ts": "can still suggest links against archived activity",
  "proposals.ts": "proposal queue may include pre-cutoff targets",
  "onboardingProposals.ts": "onboarding proposal queue, same as proposals.ts",
  "contacts.ts": "per-contact money-in/out totals still span the archive",
  "categories.ts": "category usage counts still span the archive",
  "payroll.ts": "payroll statement reads are not yet cutoff-bounded",
  "reports.ts": "seed-verification helper; low risk but unbounded",
  "ai.ts": "legacy AI helpers not yet migrated (aiCfoAggregate and agentToolQueries ARE)",
  "aiChatTools.ts": "chat tool reads not yet migrated",
  "aiChatActions.ts": "chat action reads not yet migrated",
};

function moduleName(path: string) {
  return path.replace(/^\.\//, "");
}

describe("opening-balance cutoff coverage", () => {
  const offenders: string[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const name = moduleName(path);
    if (name.endsWith(".test.ts")) continue;
    if (!READS_GUARDED_TABLE.test(source)) continue;
    if (USES_SCOPED_LOADER.test(source)) continue;
    if (name in EXEMPT || name in PENDING_MIGRATION) continue;
    offenders.push(name);
  }

  it("every module reading entity-scoped financial rows is covered, exempt, or recorded as pending", () => {
    // A NEW name here means a read path was added that can report figures from
    // before the owner's books start. Route it through the scoped loaders in
    // openingBalanceCutoff.ts, or add it to EXEMPT with a reason.
    expect(offenders).toEqual([]);
  });

  it("the pending-migration list only shrinks", () => {
    // Guards the debt from growing. Lower this number as modules migrate; never
    // raise it. Was 13 at the end of Phase 2's first pass; bills.ts migrated and
    // invoices.ts reclassified as permanently exempt.
    expect(Object.keys(PENDING_MIGRATION).length).toBeLessThanOrEqual(11);
  });

  it("no module is both exempt and pending", () => {
    const both = Object.keys(EXEMPT).filter((name) => name in PENDING_MIGRATION);
    expect(both).toEqual([]);
  });
});
