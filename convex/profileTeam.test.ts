/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { describe, expect, it } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Profile Team Workspace",
      slug: `profile-team-${now}`,
      createdAt: now,
      updatedAt: now,
    });
    const ownerId = await ctx.db.insert("users", { email: "owner@example.com", name: "Owner User" });
    const staffId = await ctx.db.insert("users", { email: "staff@example.com", name: "Staff User" });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId: ownerId,
      role: "owner",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workspaceMembers", {
      workspaceId,
      userId: staffId,
      role: "member",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return { workspaceId, ownerId, staffId };
  });
}

function authed(t: TestConvex<typeof schema>, userId: Id<"users">, email: string) {
  return t.withIdentity({
    subject: `${userId}|test-session`,
    tokenIdentifier: `test|${email}`,
    issuer: "test",
    email,
  });
}

describe("profile and team identity", () => {
  it("updates only the signed-in user's profile", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const owner = authed(t, ids.ownerId, "owner@example.com");
    const staff = authed(t, ids.staffId, "staff@example.com");

    await owner.mutation(api.profile.update, {
      displayName: "Ansar Founder",
      timezone: "America/Chicago",
      avatarColor: "#2ca01c",
    });

    const ownerProfile = await owner.query(api.profile.me, {});
    expect(ownerProfile.profile.displayName).toBe("Ansar Founder");
    expect(ownerProfile.profile.initials).toBe("AF");

    const staffProfile = await staff.query(api.profile.me, {});
    expect(staffProfile.profile.displayName).toBe("Staff User");
    expect(staffProfile.profile.initials).toBe("SU");
  });

  it("creates a tokenized invite link that resolves on the public accept page", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const owner = authed(t, ids.ownerId, "owner@example.com");

    const invite = await owner.mutation(api.team.invite, {
      email: "invitee@example.com",
      role: "member",
    });
    expect(invite.inviteUrl).toContain("/invite/");

    const token = invite.inviteUrl.split("/invite/").at(-1);
    expect(token).toBeTruthy();
    const publicInvite = await t.query(api.team.lookupInvite, { token: token! });

    expect(publicInvite).toMatchObject({
      status: "pending",
      email: "invitee@example.com",
      roleLabel: "Staff",
      workspaceName: "Profile Team Workspace",
    });
  });

  it("rejects Staff from team invite management", async () => {
    const t = convexTest(schema, modules);
    const ids = await setup(t);
    const staff = authed(t, ids.staffId, "staff@example.com");

    await expect(
      staff.mutation(api.team.invite, {
        email: "blocked@example.com",
        role: "member",
      }),
    ).rejects.toThrow(/access/i);
  });
});
