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
    updatedAt: v.number(),
  }).index("by_workspace", ["workspaceId"]),
  entities: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    slug: v.string(),
    businessType: v.string(),
    currency: v.string(),
    isDemo: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_slug", ["workspaceId", "slug"]),
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
  invites: defineTable({
    email: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked")),
    workspaceId: v.optional(v.id("workspaces")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_status", ["status"]),
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
});
