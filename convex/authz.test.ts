/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupWorkspace(t: TestConvex<typeof schema>) {
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
      userId,
      workspaceId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("accessLeads", {
      email: "founder@example.com",
      source: "landing",
      status: "pending",
      createdAt: now,
      updatedAt: now,
    });
    return { userId };
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("workspace authorization", () => {
  it("rejects protected workspace reads without sign-in", async () => {
    const t = convexTest(schema, modules);

    await expect(t.query(api.requestAccess.list, {})).rejects.toThrow(
      "OpenBooks requires sign-in",
    );
  });

  it("allows an active workspace admin to list request-access leads", async () => {
    const t = convexTest(schema, modules);

    const ids = await setupWorkspace(t);

    const authed = t.withIdentity({
      subject: `${ids.userId}|test-session`,
      tokenIdentifier: "test|owner",
      issuer: "test",
      email: "owner@example.com",
    });

    const leads = await authed.query(api.requestAccess.list, {});
    expect(leads).toHaveLength(1);
    expect(leads[0].email).toBe("founder@example.com");
  });

  it("allows local dev auth bypass for a bootstrapped owner workspace", async () => {
    const t = convexTest(schema, modules);
    await setupWorkspace(t);
    vi.stubEnv("OPENBOOKS_DEV_AUTH_BYPASS", "1");
    vi.stubEnv("OPENBOOKS_DEV_OWNER_EMAIL", "owner@example.com");
    vi.stubEnv("SITE_URL", "http://localhost:3000");

    const leads = await t.query(api.requestAccess.list, {});

    expect(leads).toHaveLength(1);
    expect(leads[0].email).toBe("founder@example.com");
  });

  it("keeps dev auth bypass disabled away from localhost", async () => {
    const t = convexTest(schema, modules);
    await setupWorkspace(t);
    vi.stubEnv("OPENBOOKS_DEV_AUTH_BYPASS", "1");
    vi.stubEnv("OPENBOOKS_DEV_OWNER_EMAIL", "owner@example.com");
    vi.stubEnv("SITE_URL", "https://openbooks.ansarullahanas.com");

    await expect(t.query(api.requestAccess.list, {})).rejects.toThrow(
      "OpenBooks requires sign-in",
    );
  });
});
