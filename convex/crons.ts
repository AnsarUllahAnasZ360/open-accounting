import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("sync Plaid transactions", { hours: 4 }, internal.plaid.syncAllActiveItems, {});

// Auto-draft payroll once a day for entities that have explicitly enabled a pay
// schedule. SAFE by construction: it only drafts (never posts to the ledger —
// approval stays a manual human step), it is idempotent via the duplicate-period
// guard, and it is a NO-OP on any entity without an enabled schedule, so demo /
// seed data is never touched.
crons.cron(
  "auto-draft payroll runs",
  "0 9 * * *", // 09:00 UTC daily
  internal.payroll.autoDraftScheduledRuns,
  {},
);

// E2-T10: refit the per-entity confidence calibration weekly so the auto-post
// gate tracks the live confidence distribution. SAFE by construction: it only
// reads holdout (eval-set) rows and writes aiCalibrations, never the ledger; it
// is a NO-OP on workspaces without seeded eval rows; and the conservative-only
// clamp means a refit can only ever TIGHTEN auto-post, never loosen it. The
// shared AI_AUTONOMY_THRESHOLDS constant is untouched.
crons.cron(
  "refit AI calibrations",
  "0 6 * * 1", // 06:00 UTC every Monday
  internal.ai.refitAllCalibrations,
  {},
);

// E9-T6: weekly plain-English digest email (revenue/expense/profit deltas + top
// advisory cards) per digest-enabled workspace. SAFE by construction: it only
// READS the grounded CFO aggregate and SENDS email (never the ledger); it is a
// clean NO-OP when no Plunk key/recipient is configured or the digest toggle is
// off; it is idempotent per (workspace, ISO week) via the digestLog table; and a
// single workspace failing never aborts the run. Monday 13:00 UTC (decisions
// Q47); monthly subscribers are skipped on non-first-Monday weeks.
crons.cron(
  "weekly digest",
  "0 13 * * 1", // 13:00 UTC every Monday
  internal.weeklyDigest.runAll,
  {},
);

// E11-T8: reset + re-seed the public no-login demo workspace daily so prospect
// edits — even one that slipped past the read-only guard — never persist. SAFE
// by construction: it is a clean NO-OP unless OPENBOOKS_PUBLIC_DEMO_ENABLED=1
// (OFF by default for self-hosters; ON for the hosted instance, decisions Q60),
// it only ever touches the dedicated public demo workspace (scoped + batched
// deletes, never another workspace, never the ledger of a real account), it is
// idempotent + deterministic (the same seed yields the same transaction count +
// balanced trial balance), and it records a `demo.public.reseeded` audit row for
// observability. 08:00 UTC is the low-traffic window (decisions Q57).
const PUBLIC_DEMO_RESET_CRON = "0 8 * * *"; // 08:00 UTC daily
crons.cron(
  "reset public demo",
  PUBLIC_DEMO_RESET_CRON,
  internal.publicDemo.resetAndSeedPublicDemo,
  {},
);

export default crons;
