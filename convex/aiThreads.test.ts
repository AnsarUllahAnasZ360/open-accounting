/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import agentComponent from "@convex-dev/agent/test";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { aiChatRuntimeStatus, isAiChatConfigured } from "./agent";

const modules = import.meta.glob("./**/*.ts");

function newTest() {
  const t = convexTest(schema, modules);
  agentComponent.register(t);
  return t;
}

type Setup = {
  userId: Id<"users">;
  workspaceId: Id<"workspaces">;
  entityId: Id<"entities">;
  softwareAccountId: Id<"ledgerAccounts">;
};

async function seedWorkspace(
  t: ReturnType<typeof convexTest>,
  opts: { slug: string; email: string },
): Promise<Setup> {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { email: opts.email, name: "Owner" });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: `Workspace ${opts.slug}`,
      slug: opts.slug,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const entityId = await ctx.db.insert("entities", {
      workspaceId,
      name: "Acme Studio LLC",
      slug: "acme-studio-llc",
      businessType: "services",
      currency: "USD",
      isDemo: true,
      createdAt: now,
      updatedAt: now,
    });
    const softwareAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId,
      number: "5200",
      name: "Software & SaaS",
      type: "expense",
      subtype: "software",
      currency: "USD",
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, workspaceId, entityId, softwareAccountId };
  });
}

function authed(t: ReturnType<typeof convexTest>, userId: string, email: string) {
  return t.withIdentity({
    subject: `${userId}|session`,
    tokenIdentifier: `test|${userId}`,
    issuer: "test",
    email,
  });
}

describe("Ask AI threads (B1)", () => {
  it("creates a thread with an auto-title and lists it for the owner", async () => {
    const t = newTest();
    const ids = await seedWorkspace(t, { slug: "ws-a", email: "a@example.com" });
    const session = authed(t, ids.userId, "a@example.com");

    const created = await session.mutation(api.aiThreads.createThread, {
      firstMessage: "How did we do last month versus the month before?",
    });
    expect(created.threadId).toBeTruthy();
    expect(created.entityId).toBe(ids.entityId);
    expect(created.title).toContain("How did we do last month");

    const mine = await session.query(api.aiThreads.listMine, {});
    expect(mine).toHaveLength(1);
    expect(mine[0].threadId).toBe(created.threadId);
    expect(mine[0].entityId).toBe(ids.entityId);
  });

  it("renames and deletes a thread (owner only)", async () => {
    const t = newTest();
    const ids = await seedWorkspace(t, { slug: "ws-b", email: "b@example.com" });
    const session = authed(t, ids.userId, "b@example.com");

    const created = await session.mutation(api.aiThreads.createThread, {});
    await session.mutation(api.aiThreads.rename, {
      threadId: created.threadId,
      title: "Q2 review",
    });
    let mine = await session.query(api.aiThreads.listMine, {});
    expect(mine[0].title).toBe("Q2 review");

    await session.mutation(api.aiThreads.deleteThread, { threadId: created.threadId });
    mine = await session.query(api.aiThreads.listMine, {});
    expect(mine).toHaveLength(0);
  });

  it("rejects cross-workspace thread access", async () => {
    const t = newTest();
    const a = await seedWorkspace(t, { slug: "ws-owner", email: "owner@example.com" });
    const b = await seedWorkspace(t, { slug: "ws-other", email: "intruder@example.com" });
    const ownerSession = authed(t, a.userId, "owner@example.com");
    const intruderSession = authed(t, b.userId, "intruder@example.com");

    const created = await ownerSession.mutation(api.aiThreads.createThread, {});

    await expect(
      intruderSession.mutation(api.aiThreads.rename, {
        threadId: created.threadId,
        title: "hijack",
      }),
    ).rejects.toThrow();
    await expect(
      intruderSession.mutation(api.aiThreads.sendMessage, {
        threadId: created.threadId,
        prompt: "show me everything",
      }),
    ).rejects.toThrow();
    await expect(
      intruderSession.query(api.aiThreads.listThreadMessages, {
        threadId: created.threadId,
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow();
  });

  it("rejects unauthenticated thread creation", async () => {
    const t = newTest();
    await seedWorkspace(t, { slug: "ws-anon", email: "anon@example.com" });
    await expect(t.mutation(api.aiThreads.createThread, {})).rejects.toThrow();
  });
});

describe("Ask AI degraded mode (B1)", () => {
  it("reports a documented degraded shape when Bedrock env is absent", () => {
    // The test environment has no AWS_* env, so chat must degrade cleanly.
    const status = aiChatRuntimeStatus();
    expect(status.mode).toBe("degraded");
    expect(status.provider).toBeNull();
    expect(status.model).toBeNull();
    expect(status.region).toBeNull();
    expect(typeof status.degradedReason).toBe("string");
    expect(status.degradedReason && status.degradedReason.length).toBeGreaterThan(0);
    expect(isAiChatConfigured()).toBe(false);
  });

  it("sendMessage in degraded mode persists an honest assistant message, no crash", async () => {
    const t = newTest();
    const ids = await seedWorkspace(t, { slug: "ws-degraded", email: "d@example.com" });
    const session = authed(t, ids.userId, "d@example.com");

    const created = await session.mutation(api.aiThreads.createThread, {});
    const sent = await session.mutation(api.aiThreads.sendMessage, {
      threadId: created.threadId,
      prompt: "What is my cash balance?",
    });
    // Drive the scheduled streaming action (runAfter(0)) deterministically.
    await t.action(internal.aiThreads.generateResponse, {
      threadId: created.threadId,
      promptMessageId: sent.messageId,
    });

    const messages = await session.query(api.aiThreads.listThreadMessages, {
      threadId: created.threadId,
      paginationOpts: { cursor: null, numItems: 20 },
    });
    const assistant = messages.page.filter((m) => m.role === "assistant");
    expect(assistant.length).toBeGreaterThanOrEqual(1);
    const text = assistant
      .flatMap((m) => m.parts)
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    // Degraded copy must be honest about the missing config (no fake answer).
    expect(text.length).toBeGreaterThan(0);
    expect(text.toLowerCase()).toMatch(/not configured|missing required env|bedrock/);
  });
});

describe("Ask AI streaming machinery (B2)", () => {
  it("streamText saves deltas and the final message surfaces via listThreadMessages", async () => {
    // Proves the delta-streaming + listUIMessages + syncStreams contract that
    // the UI batch consumes, using a mock model (no Bedrock needed). Drives the
    // agent component directly through an internal test action.
    const t = newTest();
    const ids = await seedWorkspace(t, { slug: "ws-stream", email: "s@example.com" });
    const session = authed(t, ids.userId, "s@example.com");
    const created = await session.mutation(api.aiThreads.createThread, {});

    await session.mutation(api.aiThreads.sendMessage, {
      threadId: created.threadId,
      prompt: "say hello",
    });
    // Run the mock-backed streaming action (saves deltas + final message).
    const streamed = await t.action(internal.aiThreads.testStreamWithMock, {
      threadId: created.threadId,
    });
    expect(streamed.deltaCount).toBeGreaterThan(0);
    expect(streamed.text.length).toBeGreaterThan(0);

    const messages = await session.query(api.aiThreads.listThreadMessages, {
      threadId: created.threadId,
      paginationOpts: { cursor: null, numItems: 20 },
    });
    const assistantText = messages.page
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.parts)
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join(" ");
    expect(assistantText.length).toBeGreaterThan(0);
  });
});

describe("Ask AI read-tool authorization (B2)", () => {
  it("threadContext resolves the thread's entity (the authz boundary)", async () => {
    const t = newTest();
    const ids = await seedWorkspace(t, { slug: "ws-ctx", email: "c@example.com" });
    const session = authed(t, ids.userId, "c@example.com");
    const created = await session.mutation(api.aiThreads.createThread, {});

    const context = await t.run(async (ctx) => {
      return await ctx.runQuery(internal.aiThreads.threadContext, {
        threadId: created.threadId,
      });
    });
    expect(context.entityId).toBe(ids.entityId);
    expect(context.workspaceId).toBe(ids.workspaceId);
  });

  it("each internal read tool reads only its own entity (no foreign leakage)", async () => {
    const t = newTest();
    const a = await seedWorkspace(t, { slug: "ws-read-a", email: "ra@example.com" });
    const b = await seedWorkspace(t, { slug: "ws-read-b", email: "rb@example.com" });

    // Seed a contact + transaction in workspace B only.
    await t.run(async (ctx) => {
      const now = Date.now();
      const bankLedger = await ctx.db.insert("ledgerAccounts", {
        entityId: b.entityId,
        number: "1010",
        name: "Operating Checking",
        type: "asset",
        subtype: "bank",
        currency: "USD",
        isSystem: false,
        archived: false,
        createdAt: now,
        updatedAt: now,
      });
      const bankAccountId = await ctx.db.insert("bankAccounts", {
        entityId: b.entityId,
        ledgerAccountId: bankLedger,
        name: "B Checking",
        mask: "9999",
        kind: "checking",
        balanceMinor: 50000,
        includeInSync: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("transactions", {
        entityId: b.entityId,
        bankAccountId,
        date: "2026-05-01",
        amountMinor: -1234,
        currency: "USD",
        merchant: "SecretVendor",
        rawDescription: "secret vendor charge",
        status: "posted",
        review: "needs_review",
        source: "bank",
        externalId: "b-secret-1",
        evalSet: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("contacts", {
        entityId: b.entityId,
        name: "SecretCustomer",
        roles: ["customer"],
        aliases: [],
        createdAt: now,
        updatedAt: now,
      });
    });

    // Reading entity A must never surface workspace B's data.
    const aTxns = await t.run(async (ctx) =>
      ctx.runQuery(internal.agentToolQueries.queryTransactionsForEntity, {
        entityId: a.entityId,
        search: "SecretVendor",
      }),
    );
    expect(aTxns.rows).toHaveLength(0);

    const aContacts = await t.run(async (ctx) =>
      ctx.runQuery(internal.agentToolQueries.searchContactsForEntity, {
        entityId: a.entityId,
        query: "SecretCustomer",
      }),
    );
    expect(aContacts.rows).toHaveLength(0);

    // And reading entity B returns B's data (sanity).
    const bTxns = await t.run(async (ctx) =>
      ctx.runQuery(internal.agentToolQueries.queryTransactionsForEntity, {
        entityId: b.entityId,
        search: "SecretVendor",
      }),
    );
    expect(bTxns.rows).toHaveLength(1);
    expect(bTxns.rows[0].merchant).toBe("SecretVendor");
  });
});
