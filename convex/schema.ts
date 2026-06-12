import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),
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
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),
  entities: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    slug: v.string(),
    businessType: v.string(),
    currency: v.string(),
    isDemo: v.boolean(),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_slug", ["workspaceId", "slug"])
    .index("by_slug", ["slug"]),
  workspaceMembers: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
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
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
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
    accessToken: v.string(),
    institutionName: v.optional(v.string()),
    environment: v.literal("sandbox"),
    status: v.union(v.literal("active"), v.literal("relink_required")),
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
    provider: v.union(
      v.literal("bedrock"),
      v.literal("anthropic"),
      v.literal("openai"),
      v.literal("google"),
      v.literal("ollama"),
    ),
    chatModel: v.optional(v.string()),
    categorizeModel: v.optional(v.string()),
    embedModel: v.optional(v.string()),
    autonomy: v.union(v.literal("suggest"), v.literal("balanced"), v.literal("autopilot")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),
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
    externalId: v.string(),
    decidedBy: v.optional(
      v.union(
        v.literal("transfer"),
        v.literal("match"),
        v.literal("rule"),
        v.literal("memory"),
        v.literal("plaid_prior"),
        v.literal("ai"),
        v.literal("needs_review"),
      ),
    ),
    confidence: v.optional(v.number()),
    reasoning: v.optional(v.string()),
    evalExpectedAccountId: v.optional(v.id("ledgerAccounts")),
    evalSet: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_entity", ["entityId"])
    .index("by_external_id", ["externalId"])
    .index("by_entry", ["entryId"]),
  inboxItems: defineTable({
    entityId: v.id("entities"),
    transactionId: v.optional(v.id("transactions")),
    documentId: v.optional(v.id("documents")),
    kind: v.union(
      v.literal("categorize"),
      v.literal("receipt"),
      v.literal("transfer"),
      v.literal("payout_mismatch"),
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
    kind: v.union(v.literal("receipt"), v.literal("bill"), v.literal("statement")),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
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
  }).index("by_entity", ["entityId"]),
  payrollRuns: defineTable({
    entityId: v.id("entities"),
    period: v.string(),
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("paid")),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_entity", ["entityId"]),
  stripeAccounts: defineTable({
    entityId: v.id("entities"),
    clearingAccountId: v.id("ledgerAccounts"),
    label: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_entity", ["entityId"]),
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
});
