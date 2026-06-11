/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("workspace authorization", () => {
  it("rejects protected workspace reads without sign-in", async () => {
    const t = convexTest(schema, modules);

    await expect(t.query(api.requestAccess.list, {})).rejects.toThrow(
      "OpenBooks requires sign-in",
    );
  });

  it("allows an active workspace admin to list request-access leads", async () => {
    const t = convexTest(schema, modules);

    const ids = await t.run(async (ctx) => {
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
});
