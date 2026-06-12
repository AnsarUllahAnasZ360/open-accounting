import {
  Agent,
  listUIMessages,
  mockModel,
  saveMessage,
  syncStreams,
  vStreamArgs,
} from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";

import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { openBooksAgent, aiChatRuntimeStatus, isAiChatConfigured } from "./agent";
import { authorizeThreadAccess, requireAnyWorkspaceRole, requireWorkspaceRole } from "./authz";

const MAX_TITLE_LENGTH = 80;
const DEFAULT_TITLE = "New conversation";

function deriveTitle(message: string | undefined): string {
  const trimmed = (message ?? "").trim().replace(/\s+/g, " ");
  if (!trimmed) return DEFAULT_TITLE;
  if (trimmed.length <= MAX_TITLE_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/**
 * Resolve the active entity for a workspace member. Prefers the explicit
 * entityId argument (workspace-checked) and otherwise falls back to the demo
 * entity, then the first entity. Mirrors aiChatTools.getEntity so chat context
 * matches the rest of the app.
 */
async function resolveEntityForWorkspace(
  ctx: QueryCtx | MutationCtx,
  workspaceId: Id<"workspaces">,
  entityId: Id<"entities"> | undefined,
): Promise<Doc<"entities">> {
  if (entityId) {
    const entity = await ctx.db.get(entityId);
    if (!entity || entity.workspaceId !== workspaceId) {
      throw new ConvexError("Choose an entity in this workspace.");
    }
    return entity;
  }
  const demo = await ctx.db
    .query("entities")
    .withIndex("by_workspace_and_slug", (q) =>
      q.eq("workspaceId", workspaceId).eq("slug", "acme-studio-llc"),
    )
    .unique();
  if (demo) return demo;
  const first = await ctx.db
    .query("entities")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .first();
  if (!first) {
    throw new ConvexError("No OpenBooks entity is available for Ask AI.");
  }
  return first;
}

function threadSummary(record: Doc<"chatThreads">) {
  return {
    threadId: record.threadId,
    workspaceId: record.workspaceId,
    entityId: record.entityId,
    title: record.title,
    lastActiveAt: record.lastActiveAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Internal: resolve a thread's workspace/entity context for action-side tools
 * and the streaming action. Tools must derive scope from here, never from
 * client args.
 */
export const threadContext = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("chatThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .unique();
    if (!record) {
      throw new ConvexError("OpenBooks chat thread not found.");
    }
    const entity = await ctx.db.get(record.entityId);
    if (!entity) {
      throw new ConvexError("OpenBooks entity for this thread no longer exists.");
    }
    return {
      threadId: record.threadId,
      workspaceId: record.workspaceId,
      entityId: record.entityId,
      entityName: entity.name,
      currency: entity.currency,
    };
  },
});

export const createThread = mutation({
  args: {
    entityId: v.optional(v.id("entities")),
    firstMessage: v.optional(v.string()),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireAnyWorkspaceRole(ctx, "member");
    const entity = await resolveEntityForWorkspace(ctx, membership.workspaceId, args.entityId);

    const { threadId } = await openBooksAgent.createThread(ctx, {
      userId,
      title: args.title?.trim() || deriveTitle(args.firstMessage),
    });

    const now = Date.now();
    const title = args.title?.trim() || deriveTitle(args.firstMessage);
    await ctx.db.insert("chatThreads", {
      threadId,
      workspaceId: membership.workspaceId,
      entityId: entity._id,
      userId,
      title,
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    });

    return { threadId, entityId: entity._id, title };
  },
});

export const listMine = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireAnyWorkspaceRole(ctx, "member");
    const limit = Math.min(50, Math.max(1, Math.floor(args.limit ?? 20)));
    const records = await ctx.db
      .query("chatThreads")
      .withIndex("by_workspace_and_user", (q) =>
        q.eq("workspaceId", membership.workspaceId).eq("userId", userId),
      )
      .collect();
    return records
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .slice(0, limit)
      .map(threadSummary);
  },
});

export const rename = mutation({
  args: { threadId: v.string(), title: v.string() },
  handler: async (ctx, args) => {
    const { record } = await authorizeThreadAccess(ctx, args.threadId);
    const title = args.title.trim();
    if (title.length < 1) {
      throw new ConvexError("Thread title cannot be empty.");
    }
    const now = Date.now();
    await ctx.db.patch(record._id, {
      title: title.slice(0, MAX_TITLE_LENGTH),
      updatedAt: now,
    });
    await openBooksAgent.updateThreadMetadata(ctx, {
      threadId: args.threadId,
      patch: { title: title.slice(0, MAX_TITLE_LENGTH) },
    });
    return { threadId: args.threadId, title: title.slice(0, MAX_TITLE_LENGTH) };
  },
});

export const deleteThread = mutation({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const { record } = await authorizeThreadAccess(ctx, args.threadId);
    // Drop the ownership row + any proposals; the agent component's messages
    // and streams are cleaned up asynchronously in batches.
    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    for (const proposal of proposals) {
      await ctx.db.delete(proposal._id);
    }
    await ctx.db.delete(record._id);
    await openBooksAgent.deleteThreadAsync(ctx, { threadId: args.threadId });
    return { threadId: args.threadId, deleted: true };
  },
});

/**
 * Send a message into a thread. Saves the user message and schedules the
 * streaming response. Starting a new generation expires any still-open
 * proposals in the thread (a newer turn supersedes them).
 */
export const sendMessage = mutation({
  args: { threadId: v.string(), prompt: v.string() },
  handler: async (ctx, args) => {
    const { record } = await authorizeThreadAccess(ctx, args.threadId);
    const prompt = args.prompt.trim().slice(0, 4_000);
    if (!prompt) {
      throw new ConvexError("Ask a question about your books first.");
    }

    await expireOpenProposals(ctx, args.threadId, "A newer message superseded this proposal.");

    // The standalone saveMessage does not generate embeddings (safe in a
    // mutation, which cannot run fetch). The scheduled action picks it up via
    // promptMessageId.
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: args.threadId,
      prompt,
    });

    const now = Date.now();
    await ctx.db.patch(record._id, { lastActiveAt: now, updatedAt: now });

    await ctx.scheduler.runAfter(0, internal.aiThreads.generateResponse, {
      threadId: args.threadId,
      promptMessageId: messageId,
    });

    return { messageId, scheduled: true };
  },
});

/**
 * Internal streaming action. Runs real delta streaming over Bedrock when
 * configured; otherwise saves a single documented degraded assistant message
 * (never crashes).
 */
export const generateResponse = internalAction({
  args: { threadId: v.string(), promptMessageId: v.string() },
  handler: async (ctx, args) => {
    if (!isAiChatConfigured()) {
      const status = aiChatRuntimeStatus();
      await saveMessage(ctx, components.agent, {
        threadId: args.threadId,
        message: {
          role: "assistant",
          content:
            status.degradedReason ??
            "AI is not configured. Connect Amazon Bedrock in Settings → AI to ask questions about your books.",
        },
      });
      return { ok: false, mode: "degraded" as const };
    }

    const result = await openBooksAgent.streamText(
      ctx,
      { threadId: args.threadId },
      { promptMessageId: args.promptMessageId },
      { saveStreamDeltas: { chunking: "word", throttleMs: 250 } },
    );
    // Consume the stream so deltas are saved and the final message persists.
    await result.consumeStream();
    return { ok: true, mode: "active" as const };
  },
});

/**
 * Live query the UI batch (B4) consumes via `useUIMessages(..., { stream: true })`.
 * Returns UIMessages plus stream deltas, re-checking thread authz.
 */
export const listThreadMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: v.optional(vStreamArgs),
  },
  handler: async (ctx, args) => {
    await authorizeThreadAccess(ctx, args.threadId);
    const paginated = await listUIMessages(ctx, components.agent, args);
    const streams = await syncStreams(ctx, components.agent, {
      threadId: args.threadId,
      streamArgs: args.streamArgs,
    });
    return { ...paginated, streams };
  },
});

/**
 * Expire any still-open proposals in a thread. Used when a newer generation
 * starts and on demand. Returns the number expired.
 */
export async function expireOpenProposals(
  ctx: MutationCtx,
  threadId: string,
  reason: string,
): Promise<number> {
  const open = await ctx.db
    .query("proposals")
    .withIndex("by_thread_and_status", (q) =>
      q.eq("threadId", threadId).eq("status", "proposed"),
    )
    .collect();
  const now = Date.now();
  for (const proposal of open) {
    await ctx.db.patch(proposal._id, {
      status: "expired",
      resultSummary: reason,
      updatedAt: now,
    });
  }
  return open.length;
}

/**
 * Dev/admin smoke action: stream a one-off prompt through a fresh thread and
 * report whether deltas were saved. Used for the real-Bedrock streaming smoke
 * test. Authz: any workspace member.
 */
export const smokeStreamOnce = action({
  args: { workspaceId: v.id("workspaces"), prompt: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    ok: boolean;
    mode: "active" | "degraded";
    threadId: string | null;
    deltaCount: number;
    text: string;
    reason?: string;
  }> => {
    await ctx.runQuery(internal.aiThreads.assertWorkspaceMember, {
      workspaceId: args.workspaceId,
    });
    if (!isAiChatConfigured()) {
      return {
        ok: false,
        mode: "degraded",
        threadId: null,
        deltaCount: 0,
        text: "",
        reason: aiChatRuntimeStatus().degradedReason ?? "AI not configured.",
      };
    }
    const created: { threadId: string } = await ctx.runMutation(
      internal.aiThreads.smokeCreateThread,
      { workspaceId: args.workspaceId },
    );
    const prompt =
      args.prompt?.trim() ||
      "In one short sentence, what is OpenBooks? Do not use any tools.";
    const result = await openBooksAgent.streamText(
      ctx,
      { threadId: created.threadId },
      { prompt },
      { saveStreamDeltas: { chunking: "word", throttleMs: 100 } },
    );
    let deltaCount = 0;
    for await (const _chunk of result.textStream) {
      deltaCount += 1;
    }
    const text = await result.text;
    return {
      ok: true,
      mode: "active",
      threadId: created.threadId,
      deltaCount,
      text: text.slice(0, 400),
    };
  },
});

export const assertWorkspaceMember = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId, "member");
    return null;
  },
});

export const smokeCreateThread = internalMutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args) => {
    const { userId, membership } = await requireAnyWorkspaceRole(ctx, "member");
    if (membership.workspaceId !== args.workspaceId) {
      throw new ConvexError("Workspace mismatch for smoke thread.");
    }
    const entity = await resolveEntityForWorkspace(ctx, args.workspaceId, undefined);
    const { threadId } = await openBooksAgent.createThread(ctx, {
      userId,
      title: "Streaming smoke",
    });
    const now = Date.now();
    await ctx.db.insert("chatThreads", {
      threadId,
      workspaceId: args.workspaceId,
      entityId: entity._id,
      userId,
      title: "Streaming smoke",
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return { threadId };
  },
});

/**
 * Test-only: stream a mock-model response into an existing thread with real
 * delta-saving. Proves the streaming/delta/listUIMessages contract without
 * Bedrock. Internal — never client-exposed.
 */
export const testStreamWithMock = internalAction({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    const mockAgent = new Agent(components.agent, {
      name: "openbooks-test-mock",
      languageModel: mockModel({
        content: [{ type: "text", text: "Hello — your books look healthy." }],
      }),
    });
    const result = await mockAgent.streamText(
      ctx,
      { threadId: args.threadId },
      { prompt: "say hello" },
      { saveStreamDeltas: { chunking: "word", throttleMs: 0 } },
    );
    let deltaCount = 0;
    for await (const _chunk of result.textStream) {
      deltaCount += 1;
    }
    const text = await result.text;
    return { deltaCount, text };
  },
});

/**
 * Dev-only e2e fixture for the B4 confirmation-card UI. It creates a durable
 * thread plus a proposed row without relying on model nondeterminism. Guarded by
 * the backend dev-auth bypass env and owner role; never enable this in prod.
 */
export const createProposalFixture = mutation({
  args: { entityId: v.optional(v.id("entities")) },
  handler: async (ctx, args) => {
    if (process.env.OPENBOOKS_DEV_AUTH_BYPASS !== "1") {
      throw new ConvexError("AI proposal fixtures are only available in dev-auth mode.");
    }

    const { userId, membership } = await requireAnyWorkspaceRole(ctx, "owner");
    const entity = await resolveEntityForWorkspace(ctx, membership.workspaceId, args.entityId);
    const travelAccount = await ctx.db
      .query("ledgerAccounts")
      .withIndex("by_entity_and_number", (q) => q.eq("entityId", entity._id).eq("number", "5900"))
      .unique();
    if (!travelAccount) {
      throw new ConvexError("AI proposal fixture needs the Travel account seeded on this entity.");
    }
    const { threadId } = await openBooksAgent.createThread(ctx, {
      userId,
      title: "E2E proposal fixture",
    });
    const now = Date.now();
    await ctx.db.insert("chatThreads", {
      threadId,
      workspaceId: membership.workspaceId,
      entityId: entity._id,
      userId,
      title: "E2E proposal fixture",
      lastActiveAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await saveMessage(ctx, components.agent, {
      threadId,
      prompt: "Create a rule for Uber rides to Travel. Do not post anything.",
    });
    const assistant = await saveMessage(ctx, components.agent, {
      threadId,
      message: {
        role: "assistant",
        content: "I prepared a rule proposal. Nothing has been posted or written yet.",
      },
    });
    const proposalId = await ctx.db.insert("proposals", {
      workspaceId: membership.workspaceId,
      entityId: entity._id,
      threadId,
      messageId: assistant.messageId,
      kind: "rule",
      payload: {
        merchantContains: "Uber",
        categoryAccountId: travelAccount._id,
        categoryName: travelAccount.name,
        autoPost: false,
      },
      summary: `Create a rule: when a merchant contains "Uber", categorize as ${travelAccount.name}.`,
      status: "proposed",
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    return { threadId, proposalId };
  },
});
