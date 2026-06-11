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
});
