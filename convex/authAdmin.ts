import {
  createAccount,
  modifyAccountCredentials,
  retrieveAccount,
} from "@convex-dev/auth/server";
import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { ensureWorkspaceForUser } from "./auth";
import { normalizeEmail, ownerEmail } from "./authz";

export const bootstrapOwner = internalAction({
  args: {
    workspaceName: v.optional(v.string()),
    workspaceSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = ownerEmail();
    const password = process.env.OWNER_PASSWORD;

    if (!email || !password) {
      return { status: "skipped", reason: "missing-owner-env" };
    }

    try {
      const { user } = await retrieveAccount(ctx, {
        provider: "password",
        account: { id: email },
      });
      await modifyAccountCredentials(ctx, {
        provider: "password",
        account: { id: email, secret: password },
      });
      await ctx.runMutation(internal.authAdmin.ensureOwnerWorkspace, {
        userId: user._id as Id<"users">,
        email,
        workspaceName: args.workspaceName,
        workspaceSlug: args.workspaceSlug,
      });
      return { status: "updated" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== "InvalidAccountId") {
        throw error;
      }

      const { user } = await createAccount(ctx, {
        provider: "password",
        account: { id: email, secret: password },
        profile: {
          email,
          name: "OpenBooks Owner",
        },
        shouldLinkViaEmail: false,
        shouldLinkViaPhone: false,
      });
      await ctx.runMutation(internal.authAdmin.ensureOwnerWorkspace, {
        userId: user._id as Id<"users">,
        email,
        workspaceName: args.workspaceName,
        workspaceSlug: args.workspaceSlug,
      });
      return { status: "created" };
    }
  },
});

export const ensureOwnerWorkspace = internalMutation({
  args: {
    userId: v.id("users"),
    email: v.string(),
    workspaceName: v.optional(v.string()),
    workspaceSlug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const email = normalizeEmail(args.email);
    await ctx.db.patch(args.userId, {
      email,
      name: "OpenBooks Owner",
    });
    const workspaceId = await ensureWorkspaceForUser(ctx, {
      userId: args.userId,
      email,
      role: "owner",
      workspaceName: args.workspaceName,
      workspaceSlug: args.workspaceSlug,
    });
    return { workspaceId };
  },
});
