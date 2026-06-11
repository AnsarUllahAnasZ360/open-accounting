import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const answer = makeFunctionReference<
  "action",
  { workspaceId: string; question: string },
  { ok: boolean; mode: "active" | "degraded"; runtime: string; text: string; toolsUsed: string[] }
>("aiChatRuntime:answer");

const envNames = [
  "AI_PROVIDER",
  "AI_MODEL",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
] as const;
const previousEnv = new Map<string, string | undefined>();

function clearAiEnv() {
  for (const name of envNames) {
    previousEnv.set(name, process.env[name]);
    delete process.env[name];
  }
}

function restoreAiEnv() {
  for (const name of envNames) {
    const value = previousEnv.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  previousEnv.clear();
}

async function setupWorkspace(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "owner@example.com",
      name: "Owner",
    });
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Ansar's workspace",
      slug: "ansar-workspace",
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
    return { userId, workspaceId };
  });
}

function authed(t: ReturnType<typeof convexTest>, userId: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: "test|owner",
    issuer: "test",
    email: "owner@example.com",
  });
}

describe("M10 AI chat runtime", () => {
  afterEach(() => {
    restoreAiEnv();
  });

  it("degrades without calling Bedrock when AI env is incomplete", async () => {
    clearAiEnv();
    const t = convexTest(schema, modules);
    const ids = await setupWorkspace(t);
    const session = authed(t, ids.userId);

    const result = await session.action(answer, {
      workspaceId: ids.workspaceId,
      question: "Show me recent Figma transactions",
    });

    expect(result).toMatchObject({
      ok: false,
      mode: "degraded",
      runtime: "degraded",
      toolsUsed: [],
    });
    expect(result.text).toMatch(/AI provider is not configured|Missing required env/);
  });
});
