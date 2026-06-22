import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Bring-your-own-key AI provider catalog. Bedrock plus thirteen others; the
// `openai_compatible` slot covers Together, OpenRouter, vLLM, and any other
// OpenAI-shaped endpoint. Shared by aiConfigs (the chosen provider) and
// aiCredentials (the stored key for a provider).
const aiProviderIdValidator = v.union(
  v.literal("gateway"),
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("bedrock"),
  v.literal("azure"),
  v.literal("groq"),
  v.literal("deepseek"),
  v.literal("mistral"),
  v.literal("moonshot"),
  v.literal("xai"),
  v.literal("fireworks"),
  v.literal("ollama"),
  v.literal("openai_compatible"),
);

export default defineSchema({
  ...authTables,
  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
    // The workspace's deterministic default business (Epic E5-T1). When set and
    // still active, `resolveDefaultEntity` returns it before any other heuristic.
    // Optional so existing workspaces read as no-explicit-default (and fall back
    // to the isDefault flag / oldest non-demo entity). Never a name/slug match.
    defaultEntityId: v.optional(v.id("entities")),
    // The single shared, no-login public demo workspace flag (Epic E4-T10 /
    // E11). When true, the server-side `/demo` read guard allows truly
    // unauthenticated reads of this workspace (read-only; UI hiding is not the
    // boundary). The demo backend + daily reset cron are OWNED by E11; E4 reads
    // this flag to render the populated demo view and the clone CTA. Optional so
    // every existing/real workspace reads as not-a-demo.
    isDemo: v.optional(v.boolean()),
    // What KIND of demo this workspace is (Epic E11-T2). `'public'` is the single
    // shared no-login `/demo` workspace that the daily cron resets; `'seed'` is an
    // in-workspace demo dataset. The read-only guard, cron reset, and no-bleed
    // fallback all key off the public flag via `getPublicDemoWorkspace`, so the
    // magic `'acme-studio-llc'` slug is no longer the demo signal. Optional so
    // existing rows (and real workspaces) read as undefined / non-demo.
    demoKind: v.optional(v.union(v.literal("public"), v.literal("seed"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_is_demo", ["isDemo"]),
  workspaceSettings: defineTable({
    workspaceId: v.id("workspaces"),
    appName: v.string(),
    defaultCurrency: v.string(),
    fiscalYearStartMonth: v.number(),
    // Notification preferences (Epic E5). A small fixed-key map of toggles plus
    // the delivery email. Email delivery itself is wired to Plunk only when
    // configured; these flags just control which copies would be sent.
    notificationEmail: v.optional(v.string()),
    notifications: v.optional(
      v.object({
        review: v.boolean(),
        digest: v.boolean(),
        anomaly: v.boolean(),
        sync: v.boolean(),
        owed: v.boolean(),
        close: v.boolean(),
        marketing: v.boolean(),
      }),
    ),
    // Weekly-digest cadence (Epic E9-T6). "weekly" default; "monthly" subscribers
    // only receive the first-Monday digest. Optional so existing rows read weekly.
    digestCadence: v.optional(v.union(v.literal("weekly"), v.literal("monthly"))),
    // Tax set-aside reserve rate (Epic E9-T3 / decisions Q46). The fraction of
    // trailing book NET INCOME the AI CFO suggests parking for taxes. A single
    // FLAT workspace rate (not per-entity) for v1; default 0.30 (the conservative
    // end of the 25–30% rule: SE tax ~14.13% + a typical federal bracket; state
    // tax is why it's editable). Optional so legacy rows read the 0.30 default.
    // Surfaced only as a "money to park" ESTIMATE with a mandatory "not tax
    // advice" disclaimer — never a posted journal entry.
    taxSetAsidePct: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),
  onboardingChecklists: defineTable({
    workspaceId: v.id("workspaces"),
    bankConnected: v.boolean(),
    aiConnected: v.boolean(),
    stripeConnected: v.boolean(),
    firstInboxZero: v.boolean(),
    firstReportViewed: v.boolean(),
    // Guided first-run state machine (Epic E4-T1). All additive + optional so
    // existing rows read as a fresh, unstarted setup phase. `currentStep` is the
    // step the wizard should resume on; completed/skipped are append-only step-id
    // arrays (deduped by markStep); the booleans mirror per-step completion for
    // the post-finish checklist; `phase` advances setup -> ai-bulk-setup -> done.
    currentStep: v.optional(v.string()),
    completedSteps: v.optional(v.array(v.string())),
    skippedSteps: v.optional(v.array(v.string())),
    plunkConnected: v.optional(v.boolean()),
    teamInvited: v.optional(v.boolean()),
    openingBalancesSet: v.optional(v.boolean()),
    historyReviewed: v.optional(v.boolean()),
    proposalsReviewed: v.optional(v.boolean()),
    phase: v.optional(
      v.union(v.literal("setup"), v.literal("ai-bulk-setup"), v.literal("done")),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),
  entities: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    slug: v.string(),
    businessType: v.string(),
    // Entity currency. Locked to "USD" on create (Epic E5-T4 / decisions Q24/Q25)
    // — the general ledger is USD-only, so the portfolio roll-up is plain USD
    // summation. Existing non-USD rows (if any) are read as-is but never created.
    currency: v.string(),
    isDemo: v.boolean(),
    // The workspace's default business flag (Epic E5-T1). At most one entity per
    // workspace should carry it; `setDefaultBusiness` clears the prior flag when
    // it moves. Optional so existing rows read as not-default.
    isDefault: v.optional(v.boolean()),
    // Archived businesses keep their books but disappear from the entity
    // switcher (Epic E2). Optional so existing rows read as not-archived.
    archived: v.optional(v.boolean()),
    // Tax & Fiscal Year section (Epic E2). All optional so legacy entities read.
    fiscalYearStartMonth: v.optional(v.number()), // 1-12, default 1 (January)
    accountingBasis: v.optional(v.union(v.literal("accrual"), v.literal("cash"))),
    legalName: v.optional(v.string()),
    entityType: v.optional(v.string()), // LLC, S-Corporation, ...
    taxId: v.optional(v.string()),
    homeState: v.optional(v.string()),
    // Approved revenue-stream taxonomy for this business. Defined ONCE here and
    // SHARED across epics: onboarding's AI-proposes/owner-approves flow (E4)
    // WRITES it, the categorizer prompt (E2-T9) and the weekly digest/dashboard
    // (E9-T8) READ it. Each entry is an owner-approved label plus an optional
    // default income account the stream maps to. Optional so legacy rows read as
    // an empty (cold-start) taxonomy; the categorizer falls back to a derived
    // top-vendor/customer hint when this is empty.
    incomeStreams: v.optional(
      v.array(
        v.object({
          label: v.string(),
          accountId: v.optional(v.id("ledgerAccounts")),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_slug", ["workspaceId", "slug"])
    .index("by_slug", ["slug"]),
  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.union(
      v.literal("owner"),
      v.literal("accountant"),
      v.literal("hr"),
      // Legacy aliases retained so existing finishing/dev data can migrate
      // without locking users out. New writes use accountant/hr.
      v.literal("admin"),
      v.literal("member"),
    ),
    status: v.union(v.literal("active"), v.literal("disabled")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_user_and_workspace", ["userId", "workspaceId"]),
  userProfiles: defineTable({
    userId: v.id("users"),
    displayName: v.string(),
    initials: v.string(),
    avatarColor: v.string(),
    timezone: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
  invites: defineTable({
    email: v.string(),
    role: v.union(
      v.literal("owner"),
      v.literal("accountant"),
      v.literal("hr"),
      v.literal("admin"),
      v.literal("member"),
    ),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked")),
    workspaceId: v.optional(v.id("workspaces")),
    tokenHash: v.optional(v.string()),
    acceptedByUserId: v.optional(v.id("users")),
    acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_token_hash", ["tokenHash"]),
  auditEvents: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    actorUserId: v.optional(v.id("users")),
    action: v.string(),
    entityType: v.string(),
    entityId: v.optional(v.string()),
    summary: v.string(),
    createdAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_actor", ["actorUserId"]),
  systemActors: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    kind: v.literal("sync"),
    label: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace_and_kind", ["workspaceId", "kind"])
    .index("by_user", ["userId"]),
  accessLeads: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    company: v.optional(v.string()),
    message: v.optional(v.string()),
    source: v.string(),
    status: v.union(v.literal("pending"), v.literal("invited"), v.literal("declined")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_status", ["status"]),
  ledgerAccounts: defineTable({
    entityId: v.id("entities"),
    name: v.string(),
    type: v.union(
      v.literal("asset"),
      v.literal("liability"),
      v.literal("equity"),
      v.literal("income"),
      v.literal("expense"),
    ),
    subtype: v.string(),
    number: v.string(),
    currency: v.string(),
    isSystem: v.boolean(),
    archived: v.boolean(),
    // Owner-facing REVENUE STREAM tag (Epic E9-T8). Lets several income ledger
    // accounts (e.g. platform fee + usage + setup) roll up into one stream label
    // ("Z360 product") for the dashboard revenue-by-stream widget. Additive +
    // optional: an untagged income account falls back to its own name. Only
    // meaningful on income accounts; the posting path never reads it. The
    // taxonomy itself is the owner-approved `entities.incomeStreams` set (defined
    // once, shared with E2/E4) — this tag is the per-account assignment INTO it.
    streamTag: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_and_number", ["entityId", "number"]),
  journalEntries: defineTable({
    entityId: v.id("entities"),
    date: v.string(),
    memo: v.string(),
    source: v.union(
      v.literal("bank"),
      v.literal("stripe"),
      v.literal("manual"),
      v.literal("payroll"),
      v.literal("invoice"),
      v.literal("bill"),
      v.literal("ai"),
      v.literal("rule"),
    ),
    sourceId: v.optional(v.string()),
    reversesEntryId: v.optional(v.id("journalEntries")),
    postedByUserId: v.id("users"),
    locked: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_and_date", ["entityId", "date"]),
  journalLines: defineTable({
    entityId: v.id("entities"),
    entryId: v.id("journalEntries"),
    accountId: v.id("ledgerAccounts"),
    debitMinor: v.number(),
    creditMinor: v.number(),
    currency: v.string(),
    // DEAD FIELD (Epic E5-T4 / decisions Q24/Q25). The general ledger is USD-only
    // — there is no FX engine, no base-currency conversion, no per-currency
    // normalization. `fxRate` is never written or read by any production code; it
    // is retained as optional-and-unused only to avoid a destructive schema
    // migration. Do NOT start writing or reading it.
    fxRate: v.optional(v.number()),
    contactId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_entry", ["entryId"])
    .index("by_account", ["accountId"]),
  periodLocks: defineTable({
    entityId: v.id("entities"),
    lockedThroughDate: v.string(),
    updatedAt: v.number(),
    updatedByUserId: v.id("users"),
  }).index("by_entity", ["entityId"]),
  // Bank reconciliation worksheet (Epic E1-T12). Anchored on a STATEMENT ENDING
  // BALANCE + ending date — the owner marks ledger transactions cleared until
  // the cleared book balance equals the statement balance, then "completes" the
  // reconciliation (refused unless differenceMinor === 0 — QBO's $0.00 gate).
  // Decision Q6: cleared state is a PER-TRANSACTION `reconciliationId`+`clearedAt`
  // marker (below on `transactions`), NOT an array on this row, so it scales for
  // queries. Adjusting entries for fees/interest post through postLedgerEntryCore
  // (never a raw balance edit) and are reversible like any posted entry.
  bankReconciliations: defineTable({
    entityId: v.id("entities"),
    bankAccountId: v.id("bankAccounts"),
    statementEndDate: v.string(),
    statementEndBalanceMinor: v.number(),
    status: v.union(v.literal("open"), v.literal("completed")),
    startedByUserId: v.id("users"),
    completedAt: v.optional(v.number()),
    completedByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_bank_account", ["bankAccountId"]),
  bankAccounts: defineTable({
    entityId: v.id("entities"),
    ledgerAccountId: v.id("ledgerAccounts"),
    name: v.string(),
    mask: v.string(),
    kind: v.union(v.literal("checking"), v.literal("savings"), v.literal("credit")),
    balanceMinor: v.number(),
    includeInSync: v.boolean(),
    plaidAccountId: v.optional(v.string()),
    plaidItemId: v.optional(v.string()),
    lastSyncCursor: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
  plaidItems: defineTable({
    entityId: v.id("entities"),
    plaidItemId: v.string(),
    accessToken: v.optional(v.string()),
    accessTokenCiphertext: v.optional(v.string()),
    institutionName: v.optional(v.string()),
    environment: v.union(
      v.literal("sandbox"),
      v.literal("development"),
      v.literal("production"),
    ),
    status: v.union(v.literal("active"), v.literal("relink_required"), v.literal("disconnected")),
    lastSyncCursor: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
    lastSyncStartedAt: v.optional(v.number()),
    syncLockUntil: v.optional(v.number()),
    lastSyncTrigger: v.optional(v.union(v.literal("cron"), v.literal("webhook"), v.literal("manual"))),
    lastWebhookCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_item", ["plaidItemId"]),
  contacts: defineTable({
    entityId: v.id("entities"),
    name: v.string(),
    roles: v.array(v.union(v.literal("customer"), v.literal("vendor"))),
    email: v.optional(v.string()),
    defaultCategoryId: v.optional(v.id("ledgerAccounts")),
    aliases: v.array(v.string()),
    // Free-form owner notes shown on the contact profile (Epic 5). Optional so
    // existing rows read as no-notes.
    notes: v.optional(v.string()),
    // Opaque bank / payout details shown ADMIN-ONLY on the contact Details tab
    // (Epic E4.3). Free-text (e.g. "Routing 021000021 · Acct ••4321"); NEVER a
    // live banking token. Optional so existing rows read as none on file.
    bankDetails: v.optional(v.string()),
    // SOFT archive only (approved decision D1/11.0). Archived contacts drop out
    // of the default directory but keep every contactId reference on journal
    // lines, bills, and invoices — posted ledger history stays immutable. Never
    // a hard delete. Optional so legacy rows read as not-archived.
    archived: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
  rules: defineTable({
    entityId: v.id("entities"),
    order: v.number(),
    name: v.string(),
    merchantContains: v.optional(v.string()),
    descriptionContains: v.optional(v.string()),
    // Optional amount bounds for the AND condition builder (Epic E5). Integer
    // minor units, compared against the absolute transaction amount.
    amountMinMinor: v.optional(v.number()),
    amountMaxMinor: v.optional(v.number()),
    direction: v.union(v.literal("inflow"), v.literal("outflow"), v.literal("any")),
    // Ordered condition GROUPS (Epic E12-T4). A rule matches if ANY group matches
    // (groups are OR'd); within a group every condition must hold (AND'd). This
    // is a WIDEN-only addition: legacy flat rules (the merchant/description/
    // amount/direction fields above) keep working — a read-time shim folds them
    // into a single implicit group, so both shapes evaluate identically and the
    // cross-rule first-match-wins ordering is unchanged. When present, this array
    // is authoritative; when absent, the flat fields are.
    conditionGroups: v.optional(
      v.array(
        v.object({
          merchantContains: v.optional(v.string()),
          descriptionContains: v.optional(v.string()),
          amountMinMinor: v.optional(v.number()),
          amountMaxMinor: v.optional(v.number()),
          direction: v.optional(v.union(v.literal("inflow"), v.literal("outflow"), v.literal("any"))),
        }),
      ),
    ),
    categoryAccountId: v.id("ledgerAccounts"),
    autoPost: v.boolean(),
    hitCount: v.number(),
    active: v.boolean(),
    createdBy: v.union(v.literal("user"), v.literal("ai"), v.literal("seed")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
  aiConfigs: defineTable({
    workspaceId: v.id("workspaces"),
    provider: aiProviderIdValidator,
    chatModel: v.optional(v.string()),
    categorizeModel: v.optional(v.string()),
    autonomy: v.union(v.literal("suggest"), v.literal("balanced"), v.literal("autopilot")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),
  // Unified bring-your-own-key credential store for EVERY secret in the app:
  // AI provider keys, Plunk email keys, plus Stripe/Plaid credentials. One
  // proven blob shape (single `encryptedPayload` JSON + `fingerprint` +
  // `keyPreview` + `status`), encrypted at rest via secretBox (AES-GCM key
  // derived from OPENBOOKS_SECRET_ENCRYPTION_KEY via HKDF, with
  // OPENBOOKS_TOKEN_ENCRYPTION_KEY retained as a fallback). This collapses the
  // dead per-field aiCredentials table and converges on the connectionCredentials
  // template (E3-T1). Plaintext NEVER leaves the server; only `keyPreview`
  // (last 4) and non-secret payload fields are surfaced to the client.
  //
  // Scoping (E3 decisions Q13/Q17): AI + Plunk are workspace-scoped (entityId
  // unset); Stripe is per-business (entityId set); the Plaid Item is
  // workspace-anchored with account→entity mapping living on the account rows.
  // One row per (workspaceId, kind, provider?, entityId?) scope key.
  credentials: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.union(
      v.literal("ai"),
      v.literal("plaid"),
      v.literal("stripe"),
      v.literal("plunk"),
    ),
    // Set for AI rows (the catalog provider id). Unused for plunk/plaid/stripe.
    provider: v.optional(v.string()),
    // Set when the credential is per-business (Stripe). Unset for workspace
    // scopes (AI, Plunk, the Plaid Item anchor).
    entityId: v.optional(v.id("entities")),
    // The whole secret payload, encrypted as one JSON blob. Decryptable only
    // server-side; never returned to the client.
    encryptedPayload: v.string(),
    // Stable, non-reversible fingerprint of the raw secret (for change detection
    // and audit, never reveals the key).
    fingerprint: v.string(),
    // Masked tail of the raw secret for display only, e.g. "••••a1b2".
    keyPreview: v.optional(v.string()),
    // Non-secret, plaintext connection details safe to read back.
    baseUrl: v.optional(v.string()),
    region: v.optional(v.string()),
    fromEmail: v.optional(v.string()),
    fromName: v.optional(v.string()),
    // The owner's chosen model id (AI rows).
    model: v.optional(v.string()),
    status: v.union(
      v.literal("active"),
      v.literal("invalid"),
      v.literal("disconnected"),
      v.literal("pending_verification"),
    ),
    lastValidatedAt: v.optional(v.number()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_kind", ["workspaceId", "kind"])
    .index("by_workspace_and_kind_and_provider", ["workspaceId", "kind", "provider"])
    .index("by_workspace_and_kind_and_entity", ["workspaceId", "kind", "entityId"]),
  aiCorrectionMemories: defineTable({
    entityId: v.id("entities"),
    merchantKey: v.string(),
    merchantDisplayName: v.string(),
    direction: v.union(v.literal("inflow"), v.literal("outflow")),
    categoryAccountId: v.id("ledgerAccounts"),
    occurrenceCount: v.number(),
    lastTransactionId: v.id("transactions"),
    status: v.union(v.literal("active"), v.literal("rule_suggested")),
    suggestedRuleId: v.optional(v.id("rules")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_and_merchant_key_and_direction", ["entityId", "merchantKey", "direction"]),
  aiMemoryEmbeddings: defineTable({
    entityId: v.id("entities"),
    correctionMemoryId: v.id("aiCorrectionMemories"),
    merchantKey: v.string(),
    merchantDisplayName: v.string(),
    direction: v.union(v.literal("inflow"), v.literal("outflow")),
    categoryAccountId: v.id("ledgerAccounts"),
    sourceText: v.string(),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
    occurrenceCount: v.number(),
    status: v.union(v.literal("active"), v.literal("rule_suggested")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_memory", ["correctionMemoryId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["entityId"],
    }),
  aiEvalRuns: defineTable({
    entityId: v.id("entities"),
    evaluatedCount: v.number(),
    correctCount: v.number(),
    accuracy: v.number(),
    targetAccuracy: v.number(),
    status: v.union(v.literal("meets_target"), v.literal("below_target"), v.literal("no_eval_rows")),
    providerMode: v.union(v.literal("active"), v.literal("degraded")),
    finding: v.string(),
    createdAt: v.number(),
  }).index("by_entity", ["entityId"]),
  aiBatchRuns: defineTable({
    entityId: v.id("entities"),
    requestedByUserId: v.id("users"),
    status: v.union(v.literal("completed"), v.literal("partial"), v.literal("degraded")),
    attemptedCount: v.number(),
    postedCount: v.number(),
    needsReviewCount: v.number(),
    skippedCount: v.number(),
    degradedCount: v.number(),
    fallbackCount: v.number(),
    summary: v.string(),
    createdAt: v.number(),
  }).index("by_entity", ["entityId"]),
  // E6.1: fitted confidence-calibration parameters, scoped per workspace.
  // The applied probability = sigmoid(a * logit(rawConfidence) + b). These are
  // DERIVED from holdout (rawConfidence, wasCorrect) pairs, never hardcoded.
  aiCalibrations: defineTable({
    workspaceId: v.id("workspaces"),
    // E2-T10: calibration is PER-ENTITY (two LLCs calibrate differently), with a
    // workspace-level fallback row (entityId omitted) for entities whose holdout
    // labels are too thin to fit. Optional for back-compat with pre-T10 rows that
    // were workspace-keyed only; getEntityCalibration reads by_entity first, then
    // the workspace fallback, then identity.
    entityId: v.optional(v.id("entities")),
    method: v.union(v.literal("temperature"), v.literal("platt"), v.literal("identity")),
    a: v.number(),
    b: v.number(),
    sampleCount: v.number(),
    positiveCount: v.number(),
    eceBefore: v.number(),
    eceAfter: v.number(),
    fittedFrom: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_entity", ["entityId"]),
  transactions: defineTable({
    entityId: v.id("entities"),
    bankAccountId: v.optional(v.id("bankAccounts")),
    date: v.string(),
    amountMinor: v.number(),
    currency: v.string(),
    merchant: v.string(),
    rawDescription: v.string(),
    status: v.union(v.literal("pending"), v.literal("posted")),
    review: v.union(
      v.literal("auto"),
      v.literal("confirmed"),
      v.literal("needs_review"),
      v.literal("excluded"),
    ),
    source: v.union(v.literal("bank"), v.literal("stripe"), v.literal("manual")),
    categoryAccountId: v.optional(v.id("ledgerAccounts")),
    contactId: v.optional(v.id("contacts")),
    entryId: v.optional(v.id("journalEntries")),
    transferPairId: v.optional(v.string()),
    // Intercompany pairing (Epic E5-T5). Mirrors `transferPairId` but spans two
    // entities in the SAME workspace (Zikra↔Z360). Set only when an
    // `intercompanyLinks` pair is CONFIRMED; consolidation (E5-T7) keys its
    // read-time elimination off this id. Pure metadata — never edits posted
    // journal lines, and never produces a P&L line (1300/2300 are balance-sheet).
    intercompanyPairId: v.optional(v.string()),
    externalId: v.string(),
    decidedBy: v.optional(
      v.union(
        v.literal("transfer"),
        v.literal("match"),
        v.literal("rule"),
        v.literal("memory"),
        // E2-T5: semantic-memory (embedding/k-NN) recall stage. Additive widening
        // only — no existing decidedBy value changes meaning.
        v.literal("embedding"),
        v.literal("plaid_prior"),
        v.literal("ai"),
        v.literal("needs_review"),
      ),
    ),
    confidence: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    evalExpectedAccountId: v.optional(v.id("ledgerAccounts")),
    evalSet: v.boolean(),
    // Bank reconciliation markers (Epic E1-T12, decision Q6). When the owner
    // marks a transaction "cleared" against an open reconciliation, we stamp the
    // reconciliation id + the clear time here (NOT an array on the reconciliation
    // row) so the worksheet's cleared-balance query stays a single indexed scan.
    // Additive/optional — existing rows read as never-cleared.
    reconciliationId: v.optional(v.id("bankReconciliations")),
    clearedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_external_id", ["externalId"])
    .index("by_entry", ["entryId"])
    .index("by_reconciliation", ["reconciliationId"]),
  // Intercompany transfer links (Epic E5-T5). Detected money moving between two
  // entities in the SAME workspace (Zikra↔Z360): an outflow on one entity whose
  // matched counter-leg is an inflow on a different same-workspace entity. Pure
  // METADATA — never edits posted journal lines, never produces a P&L line.
  // Consolidation (E5-T7) eliminates CONFIRMED pairs at read time, keyed on
  // `intercompanyPairId`. Currency is always "USD" (USD-only ledger; Q24/Q25).
  intercompanyLinks: defineTable({
    workspaceId: v.id("workspaces"),
    fromEntityId: v.id("entities"),
    toEntityId: v.id("entities"),
    fromTxnId: v.id("transactions"),
    toTxnId: v.id("transactions"),
    amountMinor: v.number(),
    currency: v.string(),
    status: v.union(
      v.literal("suggested"),
      v.literal("confirmed"),
      v.literal("rejected"),
    ),
    // Detector tier that produced the suggestion: "high" auto-classifies,
    // "medium" routes to the Inbox for owner confirmation.
    tier: v.union(v.literal("high"), v.literal("medium")),
    // Set when CONFIRMED (mirrors transactions.intercompanyPairId); cleared on
    // reject. Consolidation keys its elimination off this.
    intercompanyPairId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_status", ["workspaceId", "status"])
    .index("by_from_txn", ["fromTxnId"])
    .index("by_to_txn", ["toTxnId"]),
  // Owner/team notes on a transaction. Separate table (not an array on the
  // transaction) so the comment list stays unbounded-safe per Convex guidance.
  transactionComments: defineTable({
    entityId: v.id("entities"),
    transactionId: v.id("transactions"),
    userId: v.id("users"),
    authorName: v.optional(v.string()),
    text: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_transaction", ["transactionId"])
    .index("by_entity", ["entityId"]),
  inboxItems: defineTable({
    entityId: v.id("entities"),
    transactionId: v.optional(v.id("transactions")),
    documentId: v.optional(v.id("documents")),
    kind: v.union(
      v.literal("categorize"),
      v.literal("receipt"),
      v.literal("transfer"),
      v.literal("payout_mismatch"),
      // E1-T4: the per-payout clearing-zeroes invariant tripped — posting this
      // payout would leave Stripe Clearing (1150) negative beyond epsilon. The
      // drain is skipped and this card surfaces the drift for review instead of
      // silently accumulating a half-posted chain.
      v.literal("clearing_drift"),
      v.literal("connection"),
      v.literal("question"),
    ),
    payloadSummary: v.string(),
    status: v.union(v.literal("open"), v.literal("resolved"), v.literal("dismissed")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
  documents: defineTable({
    entityId: v.id("entities"),
    kind: v.union(v.literal("receipt"), v.literal("bill"), v.literal("statement"), v.literal("attachment")),
    storageId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    vendor: v.string(),
    date: v.string(),
    totalMinor: v.number(),
    currency: v.string(),
    extractionSource: v.optional(
      v.union(
        v.literal("filename_fixture"),
        v.literal("manual"),
        v.literal("bedrock_degraded"),
        v.literal("bedrock_vision"),
        v.literal("pdf_text"),
      ),
    ),
    extractionConfidence: v.optional(v.number()),
    extractionNotes: v.optional(v.string()),
    matchedTransactionId: v.optional(v.id("transactions")),
    status: v.union(v.literal("pending"), v.literal("matched"), v.literal("unmatched")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
  receiptEmbeddings: defineTable({
    entityId: v.id("entities"),
    documentId: v.id("documents"),
    vendor: v.string(),
    date: v.string(),
    totalMinor: v.number(),
    currency: v.string(),
    sourceText: v.string(),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
    matchedTransactionId: v.optional(v.id("transactions")),
    matchScore: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("stale")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_document", ["documentId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["entityId"],
    }),
  receiptTransactionEmbeddings: defineTable({
    entityId: v.id("entities"),
    transactionId: v.id("transactions"),
    sourceText: v.string(),
    embedding: v.array(v.float64()),
    embeddingModel: v.string(),
    status: v.union(v.literal("ready"), v.literal("stale")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_transaction", ["transactionId"]),
  invoices: defineTable({
    entityId: v.id("entities"),
    contactId: v.id("contacts"),
    number: v.string(),
    status: v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("overdue"), v.literal("void")),
    currency: v.string(),
    issueDate: v.string(),
    dueDate: v.string(),
    totalMinor: v.number(),
    amountPaidMinor: v.number(),
    entryIds: v.array(v.id("journalEntries")),
    // Composer fields (Epic C). Line items are a small bounded list per invoice
    // (a handful of services), so an array is safe — it never grows unbounded
    // like an audit feed would. Money is integer minor units, never floats.
    lineItems: v.optional(
      v.array(
        v.object({
          description: v.string(),
          quantity: v.number(),
          unitAmountMinor: v.number(),
        }),
      ),
    ),
    memo: v.optional(v.string()),
    terms: v.optional(v.string()),
    // Stripe hosted invoice link + lifecycle timeline (Created -> Sent ->
    // Viewed -> Paid). A fixed-cardinality event list, also safe as an array.
    hostedInvoiceUrl: v.optional(v.string()),
    timeline: v.optional(
      v.array(
        v.object({
          kind: v.union(
            v.literal("created"),
            v.literal("sent"),
            v.literal("viewed"),
            v.literal("paid"),
            v.literal("voided"),
          ),
          label: v.string(),
          at: v.number(),
        }),
      ),
    ),
    source: v.optional(v.union(v.literal("manual"), v.literal("stripe"))),
    // E7.2: Stripe's native invoice object id (in_...). Real optional indexed
    // column (the widen step). When present, Stripe invoices dedupe on this
    // stable id instead of the human-facing `number` (which can repeat across
    // accounts). Optional so legacy/manual invoices read as none on file.
    stripeInvoiceId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_and_stripe_invoice_id", ["entityId", "stripeInvoiceId"]),
  bills: defineTable({
    entityId: v.id("entities"),
    contactId: v.id("contacts"),
    documentId: v.optional(v.id("documents")),
    status: v.union(v.literal("open"), v.literal("paid"), v.literal("void")),
    issueDate: v.string(),
    dueDate: v.string(),
    totalMinor: v.number(),
    currency: v.string(),
    entryIds: v.array(v.id("journalEntries")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
  employees: defineTable({
    entityId: v.id("entities"),
    name: v.string(),
    country: v.string(),
    currency: v.string(),
    monthlySalaryMinor: v.number(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Optional fields owned by the parallel payroll module (the richer employee
    // record from the payroll redesign). They are additive and unused by this
    // branch, but the shared dev deployment already carries rows seeded with
    // them; widening the validator keeps the atomic Convex push green without
    // destructively rewriting that parallel-branch data. `payTo` is an
    // intentionally loose object so the payroll branch can evolve its shape
    // without re-breaking this validator. `exitDate`/`exitReason` come from the
    // payroll branch's employee-lifecycle (offboarding) work and likewise land
    // on rows the shared dev deployment already carries; they are additive and
    // unused here, so widening the validator keeps the atomic push green without
    // rewriting parallel-branch data.
    title: v.optional(v.string()),
    payTo: v.optional(v.any()),
    exitDate: v.optional(v.string()),
    exitReason: v.optional(v.string()),
  }).index("by_entity", ["entityId"]),
  // Per-entity pay cadence. Additive + optional: an entity with no row (or an
  // `enabled: false` row) is never auto-drafted, so demo data — which never
  // gets an enabled schedule — is untouched by the auto-draft cron. Runs are
  // still drafted manually from active salaries until an owner turns this on.
  paySchedules: defineTable({
    entityId: v.id("entities"),
    cadence: v.union(v.literal("monthly"), v.literal("semimonthly")),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
  payrollRuns: defineTable({
    entityId: v.id("entities"),
    period: v.string(),
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("paid")),
    // How this run was created. Absent/"manual" = an owner started it; an
    // "auto-draft" run was drafted by the scheduled function and still requires
    // a manual approval before anything posts to the ledger.
    source: v.optional(v.union(v.literal("auto-draft"), v.literal("manual"))),
    totalBaseMinor: v.number(),
    entryIds: v.array(v.id("journalEntries")),
    // Accounts + approval entry are filled when the run is approved through the
    // ledger so settlement can find the payable to clear and link back.
    expenseAccountId: v.optional(v.id("ledgerAccounts")),
    payableAccountId: v.optional(v.id("ledgerAccounts")),
    bankAccountId: v.optional(v.id("ledgerAccounts")),
    approvalEntryId: v.optional(v.id("journalEntries")),
    approvedAt: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    // Period this run posts against (last day of the month). Defaults derived
    // from `period` when absent so legacy seeded runs still read.
    postingDate: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
  // Per-employee payroll line. A child table (not an array on payrollRuns) so
  // adjustments / FX / paid-state are individually editable and the parent
  // document never grows unbounded (Convex schema guideline).
  payrollRunLines: defineTable({
    entityId: v.id("entities"),
    runId: v.id("payrollRuns"),
    employeeId: v.optional(v.id("employees")),
    // Snapshot of employee identity at run time (employees can change later).
    employeeName: v.string(),
    country: v.string(),
    currency: v.string(),
    baseSalaryMinor: v.number(), // local minor units, before adjustment
    adjustmentMinor: v.number(), // local minor units, signed (+ bonus / − deduction)
    // FX expressed as integer micro-units of local currency per 1 base unit
    // (e.g. 278 PKR/USD -> 278_000_000). Avoids storing a float rate.
    fxRateMicros: v.number(),
    finalLocalMinor: v.number(), // baseSalaryMinor + adjustmentMinor
    baseEquivalentMinor: v.number(), // converted to entity base currency
    paid: v.boolean(),
    settlementEntryId: v.optional(v.id("journalEntries")),
    settlementTxnId: v.optional(v.id("transactions")),
    // Base equivalent actually settled (may differ from approval -> FX diff).
    settledBaseMinor: v.optional(v.number()),
    // E10-T3: the day-of-pay FX rate (local-per-base micro-units) actually used at
    // settlement. May differ from `fxRateMicros` (the accrual rate) when the rate
    // moved between approval and pay — the difference books to FX gain/loss.
    // Additive optional (widen-migrate-narrow): never written until a line is
    // settled, so legacy/seeded lines read back unchanged.
    settledFxRateMicros: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_entity", ["entityId"]),
  // E10-T3: persisted day-of-pay FX rates so the settle/read path never depends on
  // a live network fetch. A Convex action fetches the rate (no provider
  // preference; decisions.md Q51) and writes a row here as integer micro-units of
  // local currency per 1 base unit (e.g. 278.5 PKR/USD -> 278_500_000). Floats
  // never persist. Keyed by (base, local, date "YYYY-MM-DD").
  fxRates: defineTable({
    baseCurrency: v.string(),
    localCurrency: v.string(),
    date: v.string(),
    rateMicros: v.number(),
    source: v.string(),
    createdAt: v.number(),
  }).index("by_pair_and_date", ["baseCurrency", "localCurrency", "date"]),
  stripeAccounts: defineTable({
    entityId: v.id("entities"),
    clearingAccountId: v.id("ledgerAccounts"),
    label: v.string(),
    connectedAccountId: v.optional(v.string()),
    mode: v.optional(v.union(v.literal("test"), v.literal("live"))),
    status: v.optional(
      v.union(
        v.literal("active"),
        v.literal("pending_oauth"),
        v.literal("disconnected"),
        v.literal("deauthorized"),
      ),
    ),
    scopes: v.optional(v.array(v.string())),
    // E3-T6: `pending_verification` means a webhook secret is saved but no signed
    // delivery has confirmed it yet — the connection must NOT report "listening"
    // until a real verified delivery (or the explicit verify action) flips it.
    webhookStatus: v.optional(
      v.union(
        v.literal("not_configured"),
        v.literal("pending_verification"),
        v.literal("listening"),
        v.literal("failing"),
        v.literal("unknown"),
      ),
    ),
    lastValidatedAt: v.optional(v.number()),
    lastSyncedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
  financialConnections: defineTable({
    workspaceId: v.id("workspaces"),
    entityId: v.id("entities"),
    provider: v.union(v.literal("plaid"), v.literal("stripe")),
    mode: v.union(
      v.literal("sandbox"),
      v.literal("development"),
      v.literal("production"),
      v.literal("test"),
      v.literal("live"),
      v.literal("fixture"),
    ),
    displayName: v.string(),
    externalId: v.optional(v.string()),
    status: v.union(
      v.literal("configuration_required"),
      v.literal("pending_oauth"),
      v.literal("active"),
      v.literal("relink_required"),
      v.literal("disconnected"),
    ),
    webhookStatus: v.optional(
      v.union(
        v.literal("not_configured"),
        v.literal("pending_verification"),
        v.literal("listening"),
        v.literal("failing"),
        v.literal("unknown"),
      ),
    ),
    lastSyncedAt: v.optional(v.number()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_entity", ["entityId"])
    .index("by_provider", ["provider"])
    .index("by_entity_and_provider", ["entityId", "provider"])
    .index("by_external", ["provider", "externalId"]),
  connectionCredentials: defineTable({
    workspaceId: v.id("workspaces"),
    entityId: v.id("entities"),
    connectionId: v.id("financialConnections"),
    provider: v.union(v.literal("plaid"), v.literal("stripe")),
    mode: v.union(
      v.literal("sandbox"),
      v.literal("development"),
      v.literal("production"),
      v.literal("test"),
      v.literal("live"),
    ),
    label: v.string(),
    encryptedPayload: v.string(),
    fingerprint: v.string(),
    keyPreview: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("invalid"), v.literal("disconnected")),
    lastValidatedAt: v.optional(v.number()),
    createdByUserId: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_connection", ["connectionId"])
    .index("by_entity_and_provider", ["entityId", "provider"])
    .index("by_workspace_and_provider", ["workspaceId", "provider"]),
  stripeOAuthStates: defineTable({
    workspaceId: v.id("workspaces"),
    entityId: v.id("entities"),
    state: v.string(),
    mode: v.union(v.literal("test"), v.literal("live")),
    redirectUri: v.string(),
    createdByUserId: v.id("users"),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_workspace", ["workspaceId"]),
  realTestResetJobs: defineTable({
    actorUserId: v.optional(v.id("users")),
    workspaceName: v.string(),
    confirmation: v.string(),
    status: v.union(
      v.literal("previewed"),
      v.literal("blocked"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    dryRunCounts: v.optional(v.any()),
    batchesDeleted: v.optional(v.number()),
    archiveRemaining: v.optional(v.boolean()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_actor", ["actorUserId"])
    .index("by_status", ["status"]),
  // Per-workspace factory-reset job/audit trail (Epic E11-T3). Distinct from the
  // global `realTestResetJobs` (the dev rebuild): this records each owner-run
  // "reset this workspace to factory" with the typed confirmation, counts, and
  // outcome, scoped to one workspace. Kept after the run so the owner has an
  // auditable record alongside the `auditEvents` row.
  workspaceResetJobs: defineTable({
    workspaceId: v.id("workspaces"),
    actorUserId: v.id("users"),
    workspaceName: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    deletedCount: v.optional(v.number()),
    batches: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_actor", ["actorUserId"]),
  stripePayouts: defineTable({
    entityId: v.id("entities"),
    payoutId: v.string(),
    amountMinor: v.number(),
    grossMinor: v.number(),
    feesMinor: v.number(),
    arrivalDate: v.string(),
    status: v.union(v.literal("pending"), v.literal("reconciled"), v.literal("mismatch")),
    bankTxnId: v.optional(v.id("transactions")),
    entryIds: v.array(v.id("journalEntries")),
    // E7.1/E7.3: the Payouts In-Transit ledger account (1160) this payout drains
    // Stripe Clearing into when it is created. The matched Plaid arrival later
    // posts Dr Bank / Cr In-Transit against this same account, so the bank cash
    // is debited exactly once — at arrival, not at payout time. Optional so
    // legacy rows (which posted Dr Bank directly at payout) still read.
    inTransitAccountId: v.optional(v.id("ledgerAccounts")),
    // Currency the payout settles in. Optional so legacy rows read; the matcher
    // requires same-currency to pair a deposit to a payout.
    currency: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_and_status", ["entityId", "status"])
    .index("by_entity_status_amount", ["entityId", "status", "amountMinor"]),
  stripePayoutLines: defineTable({
    entityId: v.id("entities"),
    payoutId: v.id("stripePayouts"),
    stripePayoutId: v.string(),
    sourceId: v.string(),
    description: v.string(),
    grossMinor: v.number(),
    feeMinor: v.number(),
    netMinor: v.number(),
    currency: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_payout", ["payoutId"])
    .index("by_entity", ["entityId"])
    .index("by_entity_and_source", ["entityId", "sourceId"]),
  stripeWebhookEvents: defineTable({
    workspaceId: v.optional(v.id("workspaces")),
    entityId: v.optional(v.id("entities")),
    connectionId: v.optional(v.id("financialConnections")),
    stripeEventId: v.string(),
    type: v.string(),
    objectId: v.optional(v.string()),
    relatedPaymentIntentId: v.optional(v.string()),
    livemode: v.boolean(),
    apiVersion: v.optional(v.string()),
    status: v.union(v.literal("received"), v.literal("ignored"), v.literal("duplicate")),
    summary: v.string(),
    receivedAt: v.number(),
  })
    .index("by_event_id", ["stripeEventId"])
    .index("by_received_at", ["receivedAt"]),
  demoSeedRuns: defineTable({
    entityId: v.id("entities"),
    seed: v.string(),
    transactionCount: v.number(),
    postedCount: v.number(),
    inboxCount: v.number(),
    evalCount: v.number(),
    trialBalanceDifferenceMinor: v.number(),
    createdAt: v.number(),
  }).index("by_entity", ["entityId"]),
  chatThreads: defineTable({
    threadId: v.string(),
    workspaceId: v.id("workspaces"),
    entityId: v.id("entities"),
    userId: v.id("users"),
    title: v.string(),
    lastActiveAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_and_user", ["workspaceId", "userId"]),
  proposals: defineTable({
    workspaceId: v.id("workspaces"),
    entityId: v.id("entities"),
    threadId: v.string(),
    messageId: v.optional(v.string()),
    kind: v.union(
      v.literal("categorize"),
      v.literal("rule"),
      v.literal("invoiceDraft"),
      v.literal("bill"),
      v.literal("journalEntry"),
    ),
    payload: v.any(),
    summary: v.string(),
    status: v.union(
      v.literal("proposed"),
      v.literal("confirmed"),
      v.literal("dismissed"),
      v.literal("expired"),
    ),
    createdBy: v.id("users"),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    resultSummary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_thread_and_status", ["threadId", "status"])
    .index("by_entity", ["entityId"])
    .index("by_workspace", ["workspaceId"]),
  // The AI "done-for-you books" bulk-setup proposals generated during onboarding
  // (Epic E4-T7/T8). Unlike `proposals` (thread-scoped, chat-driven) these are
  // workspace+entity scoped and reviewed in the onboarding wizard, NOT a chat
  // thread. Each is one suggested income stream, expense category, or rule the
  // owner approves/rejects before the AI runs the books. Approving WRITES the
  // underlying record via the existing confirm paths (createConfirmedRule /
  // entity.incomeStreams); rejecting marks it dismissed. The generator is a
  // batch keyed by `runId` so a re-run supersedes the prior batch.
  onboardingProposals: defineTable({
    workspaceId: v.id("workspaces"),
    entityId: v.id("entities"),
    runId: v.string(),
    kind: v.union(
      v.literal("incomeStream"),
      v.literal("category"),
      v.literal("rule"),
    ),
    // The concrete, editable payload (merchant text, suggested label/account,
    // sample counts). Validated at approve time; never posts to the ledger.
    payload: v.any(),
    summary: v.string(),
    status: v.union(
      v.literal("proposed"),
      v.literal("confirmed"),
      v.literal("dismissed"),
      v.literal("superseded"),
    ),
    // How the suggestion was produced — "ai" when the owner's provider enriched
    // it, "deterministic" for the graceful-degradation clustering fallback.
    origin: v.union(v.literal("ai"), v.literal("deterministic")),
    createdBy: v.id("users"),
    decidedBy: v.optional(v.id("users")),
    decidedAt: v.optional(v.number()),
    resultSummary: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_and_status", ["entityId", "status"])
    .index("by_workspace", ["workspaceId"]),
  // The small clarifying-questions set the onboarding bulk-setup asks the owner
  // (Epic E4-T7, decision Q22): a fixed core set (<= ~5) plus AI-detected
  // ambiguities, with the owner's answers persisted per entity. Read back into
  // the proposal-review step and (for the income-stream taxonomy) into the
  // categorizer prompt that E2/E9 share.
  onboardingQuestions: defineTable({
    workspaceId: v.id("workspaces"),
    entityId: v.id("entities"),
    runId: v.string(),
    key: v.string(),
    prompt: v.string(),
    // "core" = the fixed set; "detected" = an AI/heuristic-detected ambiguity.
    kind: v.union(v.literal("core"), v.literal("detected")),
    answer: v.optional(v.string()),
    answeredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_entity_and_run", ["entityId", "runId"]),
  demoSeedJobs: defineTable({
    workspaceId: v.id("workspaces"),
    kind: v.literal("demo"),
    status: v.union(v.literal("running"), v.literal("succeeded"), v.literal("failed")),
    operationId: v.string(),
    startedAt: v.number(),
    heartbeatAt: v.number(),
    finishedAt: v.optional(v.number()),
    message: v.optional(v.string()),
    result: v.optional(
      v.object({
        seed: v.string(),
        entityId: v.id("entities"),
        transactionCount: v.number(),
        postedCount: v.number(),
        inboxCount: v.number(),
        evalCount: v.number(),
        trialBalanceDifferenceMinor: v.number(),
        may2026: v.object({
          incomeMinor: v.number(),
          expenseMinor: v.number(),
          netIncomeMinor: v.number(),
          assetMinor: v.number(),
          liabilityMinor: v.number(),
          equityMinor: v.number(),
          currentEarningsMinor: v.number(),
          balanceSheetDifferenceMinor: v.number(),
        }),
        payoutEntryCount: v.number(),
      }),
    ),
  }).index("by_workspace_and_kind", ["workspaceId", "kind"]),
  // Weekly-digest send log (Epic E9-T6). The idempotency ledger for the digest
  // cron: one row per (workspace, ISO-week). A row's existence means we already
  // attempted (and recorded the outcome of) the digest for that week, so a second
  // run in the same week is a no-op. Additive + backfill-safe; the ledger posting
  // path never touches this table.
  digestLog: defineTable({
    workspaceId: v.id("workspaces"),
    // ISO week key, e.g. "2026-W25" (Monday-anchored), the dedupe key.
    weekKey: v.string(),
    sentAt: v.number(),
    // "sent" once Plunk accepted it; "skipped" when no key/recipient/disabled.
    status: v.union(v.literal("sent"), v.literal("skipped")),
    // Non-secret diagnostics: the recipient and a short reason for a skip.
    recipient: v.optional(v.string()),
    detail: v.optional(v.string()),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_week", ["workspaceId", "weekKey"]),
});
