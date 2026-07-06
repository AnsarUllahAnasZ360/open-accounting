import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

function authAs(t: TestConvex<typeof schema>, userId: string) {
  return t.withIdentity({ subject: `${userId}|s`, tokenIdentifier: `test|${userId}`, issuer: "test" });
}

describe("session.viewer reports a workspace-unavailable state", () => {
  it("flags workspace_unavailable when the active membership's workspace was deleted", async () => {
    const t = convexTest(schema, modules);
    const { userId, workspaceId } = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { email: "member@ex.com", name: "Member" });
      const workspaceId = await ctx.db.insert("workspaces", { name: "WS", slug: "ws", createdAt: now, updatedAt: now });
      await ctx.db.insert("workspaceMembers", {
        workspaceId, userId, role: "hr", status: "active", createdAt: now, updatedAt: now,
      });
      return { userId, workspaceId };
    });

    // Owner deletes the workspace out from under the member.
    await t.run(async (ctx) => {
      await ctx.db.delete(workspaceId);
    });

    const viewer = await authAs(t, userId).query(api.session.viewer, {});
    expect(viewer.status).toBe("workspace_unavailable");
    expect(viewer.workspace).toBeNull();
  });

  it("flags workspace_unavailable when the member's access was disabled", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", { email: "suspended@ex.com", name: "Suspended" });
      const workspaceId = await ctx.db.insert("workspaces", { name: "WS", slug: "ws2", createdAt: now, updatedAt: now });
      await ctx.db.insert("workspaceMembers", {
        workspaceId, userId, role: "hr", status: "disabled", createdAt: now, updatedAt: now,
      });
      return userId;
    });

    const viewer = await authAs(t, userId).query(api.session.viewer, {});
    expect(viewer.status).toBe("workspace_unavailable");
  });

  it("a brand-new user with no membership still routes to onboarding", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "new@ex.com", name: "New" }),
    );
    const viewer = await authAs(t, userId).query(api.session.viewer, {});
    expect(viewer.status).toBe("needs_onboarding");
  });
});
