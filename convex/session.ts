import { getAuthUserId } from "@convex-dev/auth/server";

import { query } from "./_generated/server";
import { isDevAuthBypassEnabled, requireUserId } from "./authz";
import { getPublicDemoWorkspace } from "./demoWorkspace";
import { profileSnapshot } from "./profile";

export const viewer = query({
  args: {},
  handler: async (ctx) => {
    // No-login public demo context (Epic E11-T5). A truly unauthenticated visitor
    // on `/demo` has no identity and no membership — rather than throw, the viewer
    // resolves the single public demo workspace BY THE SERVER (registry, not slug)
    // and returns a READ-ONLY demo context. No anonymous Convex Auth identity is
    // minted (decided Q56). This branch only fires when there is genuinely no auth
    // AND no dev bypass, so a real signed-in user is never routed into the demo.
    const authedUserId = await getAuthUserId(ctx);
    if (!authedUserId && !isDevAuthBypassEnabled()) {
      const demoWorkspace = await getPublicDemoWorkspace(ctx);
      if (demoWorkspace) {
        return {
          user: null,
          workspace: {
            id: demoWorkspace._id,
            name: demoWorkspace.name,
            slug: demoWorkspace.slug,
          },
          defaultEntityId: demoWorkspace.defaultEntityId ?? null,
          role: null,
          joinedViaInvite: false,
          isDemo: true as const,
          readOnly: true as const,
          status: "demo" as const,
        };
      }
    }

    const userId = await requireUserId(ctx);
    const [user, memberships] = await Promise.all([
      ctx.db.get(userId),
      ctx.db
        .query("workspaceMembers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    ]);
    const membership = memberships.find((candidate) => candidate.status === "active") ?? null;
    const activeWorkspace = membership ? await ctx.db.get(membership.workspaceId) : null;

    // A workspace with zero active businesses means the owner has not finished
    // (or has just RESET — Epic E4-T10) their books: there is nothing to show, so
    // the viewer is in onboarding. This keeps a scoped data-reset honest (viewer
    // flips back to needs_onboarding) without deleting the workspace/membership,
    // and matches the AppShell first-run gate. Only consulted for non-invited
    // members (an invited teammate joins an already-populated workspace).
    let workspaceHasBusiness = true;
    if (activeWorkspace) {
      const someEntity = await ctx.db
        .query("entities")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", activeWorkspace._id))
        .take(50);
      workspaceHasBusiness = someEntity.some((entity) => !entity.archived);
    }

    const profile = user ? await profileSnapshot(ctx, user, userId) : null;

    // Self-host first-run vs invited-teammate join (Epic E4-T6). An invited
    // teammate consumed a pending invite during sign-up (`auth.createOrUpdateUser`
    // marks it accepted with `acceptedByUserId`), so their membership is a NON-owner
    // role inside someone else's workspace. The wizard reads this to skip business
    // creation and route the teammate to their role's landing instead of the full
    // first-run. Owners (role === "owner") always get the full first-run.
    let joinedViaInvite = false;
    if (membership && membership.role !== "owner") {
      const acceptedInvite = await ctx.db
        .query("invites")
        .withIndex("by_email", (q) => q.eq("email", user?.email ?? ""))
        .collect();
      joinedViaInvite = acceptedInvite.some(
        (invite) =>
          invite.status === "accepted" &&
          invite.acceptedByUserId === userId &&
          invite.workspaceId === membership.workspaceId,
      );
    }

    return {
      user: user
        ? {
            id: user._id,
            email: user.email ?? null,
            name: user.name ?? null,
            profile,
          }
        : null,
      workspace: activeWorkspace
        ? {
            id: activeWorkspace._id,
            name: activeWorkspace.name,
            slug: activeWorkspace.slug,
          }
        : null,
      // The workspace's deterministic default business (Epic E5-T1). The shell
      // seeds first-render entity selection from this before localStorage. Null
      // when no default is persisted yet (the shell then falls back to the
      // stored id, then the first active row).
      defaultEntityId: activeWorkspace?.defaultEntityId ?? null,
      role: membership?.role ?? null,
      // Epic E4-T6: distinguishes an invited teammate (joined an existing
      // workspace) from a self-host owner running first-run. The shell uses this
      // to skip business creation for invited teammates.
      joinedViaInvite,
      // A signed-in viewer is never the read-only public demo (E11-T5). Kept on
      // both branches so the shell can read `viewer.isDemo` uniformly.
      isDemo: false as const,
      readOnly: false as const,
      status:
        membership && activeWorkspace && (joinedViaInvite || workspaceHasBusiness)
          ? ("ready" as const)
          : ("needs_onboarding" as const),
    };
  },
});
