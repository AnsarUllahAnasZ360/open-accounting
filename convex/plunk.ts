/**
 * Plunk (transactional email) bring-your-own-key surface (E3-T7).
 *
 * Plunk powers the weekly CFO digest, team invites, and password reset. Before
 * this, the only way to configure it was a Convex env var (PLUNK_SECRET_KEY).
 * Now an owner can paste a Plunk key (+ from-email/from-name) in Settings; it is
 * encrypted at rest in the SINGLE unified `credentials` table (`kind:"plunk"`,
 * workspace-scoped — decision Q14), validated against Plunk, and the app's email
 * senders prefer the saved BYO key over the env var.
 *
 * Hard rules:
 *  - The secret key lives ONLY inside `encryptedPayload` (via E3-T1 saveCredential).
 *  - `plunkStatus` returns last4 + verified state — never the key.
 *  - Senders fall back to PLUNK_SECRET_KEY so env-only deployments still work.
 */

import { ConvexError, v } from "convex/values";

import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalQuery, mutation, query } from "./_generated/server";
import { requireWorkspaceRole } from "./authz";
import { decryptSecret, isSecretEncryptionConfigured, secretEncryptionEnvLabel } from "./secretBox";

function plunkBaseUrl() {
  return (process.env.PLUNK_API_BASE_URL ?? "https://api.plunk.zikrainfotech.com").replace(/\/+$/, "");
}

/**
 * Lightweight, non-destructive auth probe against Plunk. We never send a real
 * email to validate. A 401/403 means the key is bad; any other reachable
 * response (including a 404 from a benign path) means the key authenticated.
 * Network failure is reported as unreachable, not "invalid", so we don't flag a
 * good key just because Plunk was briefly down.
 */
async function probePlunkKey(secretKey: string): Promise<{ ok: boolean; message: string }> {
  let response: Response;
  try {
    response = await fetch(`${plunkBaseUrl()}/v1/contacts/count`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
  } catch {
    return { ok: false, message: "Could not reach Plunk to verify the key. Try again shortly." };
  }
  if (response.status === 401 || response.status === 403) {
    return { ok: false, message: "Plunk rejected this key. Double-check the secret key from your Plunk project." };
  }
  // Any authenticated (or benign-not-found) response means the key is accepted.
  return { ok: true, message: "Plunk key verified." };
}

/** Authorize an admin for this workspace from an action context (no db). */
export const authorizeWorkspaceAdmin = internalQuery({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ userId: Id<"users"> }> => {
    const { userId } = await requireWorkspaceRole(ctx, args.workspaceId, "admin");
    return { userId };
  },
});

/**
 * Save (or update) the workspace Plunk credential. Admin-only. Validates the key
 * against Plunk, then persists through the unified `credentials` store
 * (`kind:"plunk"`). The secret is encrypted; from-email/from-name are non-secret
 * payload fields. Returns last4 + verified — never the key.
 */
export const savePlunkCredential = action({
  args: {
    workspaceId: v.id("workspaces"),
    secretKey: v.string(),
    fromEmail: v.optional(v.string()),
    fromName: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ configured: true; verified: boolean; keyPreview: string | null; message: string }> => {
    await ctx.runQuery(internal.plunk.authorizeWorkspaceAdmin, { workspaceId: args.workspaceId });
    if (!isSecretEncryptionConfigured()) {
      throw new ConvexError(
        `${secretEncryptionEnvLabel()} is required before saving the Plunk key. Set OPENBOOKS_SECRET_ENCRYPTION_KEY in your Convex deployment.`,
      );
    }
    const secretKey = args.secretKey.trim();
    if (!secretKey) {
      throw new ConvexError("Paste your Plunk secret key.");
    }
    const fromEmail = args.fromEmail?.trim();
    const fromName = args.fromName?.trim();

    const probe = await probePlunkKey(secretKey);
    const status = probe.ok ? ("active" as const) : ("invalid" as const);

    // Route through the unified credentials writer (E3-T1) so encryption + audit
    // + last4 logic lives in exactly one place. It re-checks admin role.
    const saved = await ctx.runMutation(api.credentials.saveCredential, {
      workspaceId: args.workspaceId,
      kind: "plunk",
      payload: {
        apiKey: secretKey,
        ...(fromEmail ? { fromEmail } : {}),
        ...(fromName ? { fromName } : {}),
      },
      status,
      lastValidatedAt: Date.now(),
    });

    return {
      configured: true as const,
      verified: probe.ok,
      keyPreview: saved.keyPreview,
      message: probe.message,
    };
  },
});

/** Hard-delete the workspace Plunk credential (admin). */
export const deletePlunkCredential = mutation({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    const { userId } = await requireWorkspaceRole(ctx, args.workspaceId, "admin");
    const rows = await ctx.db
      .query("credentials")
      .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", args.workspaceId).eq("kind", "plunk"))
      .take(10);
    const row = rows.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!row) return { deleted: false };
    await ctx.db.delete(row._id);
    await ctx.db.insert("auditEvents", {
      workspaceId: args.workspaceId,
      actorUserId: userId,
      action: "credential.plunk.deleted",
      entityType: "credential",
      entityId: row._id,
      summary: "Deleted plunk credential",
      createdAt: Date.now(),
    });
    return { deleted: true };
  },
});

type PlunkStatus = {
  configured: boolean;
  lastFour: string | null;
  fromEmail: string | null;
  fromName: string | null;
  verified: boolean;
  lastValidatedAt: number | null;
};

/**
 * Public status for the Settings UI. NEVER returns the key — only the redacted
 * last4, the non-secret from-email/from-name, and the verified state. Reflects
 * the env-only fallback as configured-but-not-BYO so the owner sees the truth.
 */
export const plunkStatus = query({
  args: { workspaceId: v.id("workspaces") },
  handler: async (ctx, args): Promise<PlunkStatus> => {
    await requireWorkspaceRole(ctx, args.workspaceId, "member");
    const rows = await ctx.db
      .query("credentials")
      .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", args.workspaceId).eq("kind", "plunk"))
      .take(10);
    const row = rows.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (row) {
      return {
        configured: true,
        lastFour: row.keyPreview ? row.keyPreview.slice(-4) : null,
        fromEmail: row.fromEmail ?? null,
        fromName: row.fromName ?? null,
        verified: row.status === "active",
        lastValidatedAt: row.lastValidatedAt ?? null,
      };
    }
    // No BYO row: env may still provide a key (back-compat deployments).
    const envConfigured = Boolean(process.env.PLUNK_SECRET_KEY);
    return {
      configured: envConfigured,
      lastFour: null,
      fromEmail: envConfigured ? process.env.PLUNK_FROM_EMAIL ?? null : null,
      fromName: envConfigured ? process.env.PLUNK_FROM_NAME ?? null : null,
      verified: envConfigured,
      lastValidatedAt: null,
    };
  },
});

export type ResolvedPlunkConfig = {
  source: "byo" | "env";
  secretKey: string;
  fromEmail?: string;
  fromName?: string;
};

/**
 * Server-side resolution used by the email senders. Prefers the saved BYO key;
 * falls back to PLUNK_SECRET_KEY. Returns null only when neither exists, so a
 * deployment with just env vars keeps working unchanged. Internal-only — the
 * decrypted key never reaches the client.
 */
export const resolvePlunkConfig = internalAction({
  args: { workspaceId: v.optional(v.id("workspaces")) },
  handler: async (ctx, args): Promise<ResolvedPlunkConfig | null> => {
    if (args.workspaceId) {
      const row: Doc<"credentials"> | null = await ctx.runQuery(internal.credentials.getActiveCredential, {
        workspaceId: args.workspaceId,
        kind: "plunk",
      });
      if (row?.encryptedPayload) {
        try {
          const payload = JSON.parse(await decryptSecret(row.encryptedPayload, "Plunk credentials")) as {
            apiKey?: string;
            fromEmail?: string;
            fromName?: string;
          };
          if (payload.apiKey) {
            return {
              source: "byo" as const,
              secretKey: payload.apiKey,
              fromEmail: payload.fromEmail ?? row.fromEmail ?? undefined,
              fromName: payload.fromName ?? row.fromName ?? undefined,
            };
          }
        } catch {
          // Fall through to env; never leak a decryption error with the key in it.
        }
      }
    }
    const envKey = process.env.PLUNK_SECRET_KEY?.trim();
    if (!envKey) return null;
    return {
      source: "env" as const,
      secretKey: envKey,
      fromEmail: process.env.PLUNK_FROM_EMAIL,
      fromName: process.env.PLUNK_FROM_NAME,
    };
  },
});
