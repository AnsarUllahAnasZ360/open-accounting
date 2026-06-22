/**
 * Unified bring-your-own-key credential store (E3-T1).
 *
 * ONE place that writes, reads, and validates every secret in the app — AI
 * provider keys, Plunk email keys, and (going forward) Stripe/Plaid credentials.
 * The proven `connectionCredentials` blob shape is the template: a single
 * `encryptedPayload` JSON blob + `fingerprint` + `keyPreview` + `status`, keyed
 * by (workspaceId, kind, provider?, entityId?). E2/E4/E8/E9 consume the resolver
 * here; they never build their own storage path.
 *
 * Hard rules enforced here:
 *  - The plaintext secret is encrypted (AES-GCM, HKDF-derived key) and stored
 *    ONLY inside `encryptedPayload`. No column ever holds the raw key.
 *  - The client-facing query (`credentialStatus`) returns `keyPreview` (last 4)
 *    and non-secret payload fields ONLY — never ciphertext or plaintext.
 *  - Saving requires a configured secret vault; otherwise we throw a clear
 *    ConvexError naming OPENBOOKS_SECRET_ENCRYPTION_KEY.
 */

import { ConvexError, v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import { internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { normalizeAiProviderId } from "./aiCatalog";
import { requireWorkspaceRole } from "./authz";
import { encryptSecret, isSecretEncryptionConfigured, secretEncryptionEnvLabel } from "./secretBox";

export type CredentialKind = "ai" | "plaid" | "stripe" | "plunk";

const credentialKindValidator = v.union(
  v.literal("ai"),
  v.literal("plaid"),
  v.literal("stripe"),
  v.literal("plunk"),
);

const credentialStatusValidator = v.union(
  v.literal("active"),
  v.literal("invalid"),
  v.literal("disconnected"),
  v.literal("pending_verification"),
);

// The payload object an owner submits. Only the *secret* fields land inside the
// encrypted blob; the rest are mirrored to plaintext columns for display.
const credentialPayloadValidator = v.object({
  apiKey: v.optional(v.string()),
  accessKeyId: v.optional(v.string()),
  secretAccessKey: v.optional(v.string()),
  sessionToken: v.optional(v.string()),
  webhookSecret: v.optional(v.string()),
  baseUrl: v.optional(v.string()),
  region: v.optional(v.string()),
  fromEmail: v.optional(v.string()),
  fromName: v.optional(v.string()),
});

type CredentialPayload = {
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  webhookSecret?: string;
  baseUrl?: string;
  region?: string;
  fromEmail?: string;
  fromName?: string;
};

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Mask a raw secret for display: "••••" + last 4. Never reveals the body. */
function maskKeyPreview(value: string): string {
  return `••••${value.slice(-4)}`;
}

/** Stable, non-reversible 24-hex-char fingerprint of the raw secret. */
async function secretFingerprint(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The single "raw" secret used for keyPreview + fingerprint. For most providers
 * this is the API key; Bedrock uses its secret-access-key; Plaid/Stripe blobs
 * carry their own secret field.
 */
function primarySecret(payload: CredentialPayload): string | undefined {
  return (
    clean(payload.apiKey) ??
    clean(payload.secretAccessKey) ??
    clean(payload.webhookSecret) ??
    clean(payload.accessKeyId)
  );
}

function requireSecretVault() {
  if (!isSecretEncryptionConfigured()) {
    throw new ConvexError(
      `${secretEncryptionEnvLabel()} is required before saving any credential. Set OPENBOOKS_SECRET_ENCRYPTION_KEY in your Convex deployment.`,
    );
  }
}

/** Build the deterministic upsert scope key for a credential row. */
async function findExistingCredential(
  ctx: MutationCtx,
  args: { workspaceId: Id<"workspaces">; kind: CredentialKind; provider?: string; entityId?: Id<"entities"> },
): Promise<Doc<"credentials"> | null> {
  const rows = await ctx.db
    .query("credentials")
    .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", args.workspaceId).eq("kind", args.kind))
    .take(200);
  return (
    rows.find((row) => {
      if (args.kind === "ai") return (row.provider ?? null) === (args.provider ?? null);
      if (args.kind === "stripe") return (row.entityId ?? null) === (args.entityId ?? null);
      // Plunk + the Plaid Item anchor are one workspace row.
      return true;
    }) ?? null
  );
}

/**
 * Save (or upsert) a credential for any kind. Admin-only. Encrypts the whole
 * payload object into `encryptedPayload`, computes keyPreview + fingerprint from
 * the raw secret, mirrors non-secret fields to plaintext columns, and writes
 * exactly one row per scope key.
 */
export const saveCredential = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    kind: credentialKindValidator,
    entityId: v.optional(v.id("entities")),
    provider: v.optional(v.string()),
    payload: credentialPayloadValidator,
    model: v.optional(v.string()),
    status: v.optional(credentialStatusValidator),
    lastValidatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceRole(ctx, args.workspaceId, "admin");
    requireSecretVault();

    let provider: string | undefined;
    if (args.kind === "ai") {
      const normalized = normalizeAiProviderId(args.provider);
      if (!normalized) {
        throw new ConvexError(`Unknown AI provider "${args.provider ?? ""}".`);
      }
      provider = normalized;
    }

    // Stripe credentials are per-business; require the entity for that scope.
    let entityId: Id<"entities"> | undefined;
    if (args.kind === "stripe") {
      if (!args.entityId) throw new ConvexError("Stripe credentials require a business.");
      const entity = await ctx.db.get(args.entityId);
      if (!entity || entity.workspaceId !== args.workspaceId) {
        throw new ConvexError("Business not found in this workspace.");
      }
      entityId = args.entityId;
    }

    const payload: CredentialPayload = {};
    for (const [key, value] of Object.entries(args.payload)) {
      const cleaned = clean(value as string | undefined);
      if (cleaned !== undefined) payload[key as keyof CredentialPayload] = cleaned;
    }

    const raw = primarySecret(payload);
    if (!raw) {
      throw new ConvexError("No secret material was provided to save.");
    }

    const encryptedPayload = await encryptSecret(JSON.stringify(payload));
    if (!encryptedPayload) {
      // Should be unreachable after requireSecretVault, but never store plaintext.
      throw new ConvexError(`${secretEncryptionEnvLabel()} is required to encrypt the credential.`);
    }
    const fingerprint = await secretFingerprint(raw);
    const keyPreview = maskKeyPreview(raw);

    const now = Date.now();
    const existing = await findExistingCredential(ctx, {
      workspaceId: args.workspaceId,
      kind: args.kind,
      provider,
      entityId,
    });

    const rowPatch = {
      workspaceId: args.workspaceId,
      kind: args.kind,
      provider,
      entityId,
      encryptedPayload,
      fingerprint,
      keyPreview,
      baseUrl: clean(payload.baseUrl),
      region: clean(payload.region),
      fromEmail: clean(payload.fromEmail),
      fromName: clean(payload.fromName),
      model: clean(args.model),
      status: args.status ?? ("active" as const),
      lastValidatedAt: args.lastValidatedAt,
      createdByUserId: userId,
      updatedAt: now,
    };

    let credentialId: Id<"credentials">;
    if (existing) {
      await ctx.db.patch(existing._id, rowPatch);
      credentialId = existing._id;
    } else {
      credentialId = await ctx.db.insert("credentials", { ...rowPatch, createdAt: now });
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: args.workspaceId,
      actorUserId: userId,
      action: `credential.${args.kind}.saved`,
      entityType: "credential",
      entityId: credentialId,
      summary: `Saved ${args.kind}${provider ? ` (${provider})` : ""} credential`,
      createdAt: now,
    });

    return {
      credentialId,
      kind: args.kind,
      provider: provider ?? null,
      keyPreview,
      fingerprint,
      status: rowPatch.status,
    };
  },
});

/** Hard-delete a credential row (admin). */
export const deleteCredential = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    kind: credentialKindValidator,
    entityId: v.optional(v.id("entities")),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireWorkspaceRole(ctx, args.workspaceId, "admin");
    const provider = args.kind === "ai" ? normalizeAiProviderId(args.provider) ?? undefined : undefined;
    const existing = await findExistingCredential(ctx, {
      workspaceId: args.workspaceId,
      kind: args.kind,
      provider,
      entityId: args.entityId,
    });
    if (!existing) return { deleted: false as const };
    await ctx.db.delete(existing._id);
    await ctx.db.insert("auditEvents", {
      workspaceId: args.workspaceId,
      actorUserId: userId,
      action: `credential.${args.kind}.deleted`,
      entityType: "credential",
      entityId: existing._id,
      summary: `Deleted ${args.kind}${provider ? ` (${provider})` : ""} credential`,
      createdAt: Date.now(),
    });
    return { deleted: true as const };
  },
});

type CredentialStatusRow = {
  kind: CredentialKind;
  provider: string | null;
  entityId: Id<"entities"> | null;
  keyPreview: string | null;
  baseUrl: string | null;
  region: string | null;
  fromEmail: string | null;
  fromName: string | null;
  model: string | null;
  configured: true;
  hasApiKey: boolean;
  hasAwsKeys: boolean;
  status: "active" | "invalid" | "disconnected" | "pending_verification";
  lastValidatedAt: number | null;
  updatedAt: number;
};

/**
 * Per-saved-row status for the client. NEVER returns ciphertext or any plaintext
 * secret — only `keyPreview` (last 4) and non-secret descriptors.
 */
export const credentialStatus = query({
  args: {
    workspaceId: v.id("workspaces"),
    kind: v.optional(credentialKindValidator),
  },
  handler: async (ctx, args): Promise<CredentialStatusRow[]> => {
    await requireWorkspaceRole(ctx, args.workspaceId, "member");
    const rows = args.kind
      ? await ctx.db
          .query("credentials")
          .withIndex("by_workspace_and_kind", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("kind", args.kind as CredentialKind),
          )
          .take(200)
      : await ctx.db
          .query("credentials")
          .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
          .take(500);
    return rows.map((row) => ({
      kind: row.kind,
      provider: row.provider ?? null,
      entityId: row.entityId ?? null,
      keyPreview: row.keyPreview ?? null,
      baseUrl: row.baseUrl ?? null,
      region: row.region ?? null,
      fromEmail: row.fromEmail ?? null,
      fromName: row.fromName ?? null,
      model: row.model ?? null,
      configured: true as const,
      // Booleans only — derived from presence, never the value.
      hasApiKey: Boolean(row.keyPreview),
      hasAwsKeys: row.kind === "ai" && row.provider === "bedrock",
      status: row.status,
      lastValidatedAt: row.lastValidatedAt ?? null,
      updatedAt: row.updatedAt,
    }));
  },
});

/**
 * Server-side resolution: return the raw credential Doc for a scope. Used by the
 * provider resolver (T2), the runtimes (T3), and Plunk (T7). Internal-only — the
 * raw row (including `encryptedPayload`) must never reach the client.
 */
export const getActiveCredential = internalQuery({
  args: {
    workspaceId: v.id("workspaces"),
    kind: credentialKindValidator,
    entityId: v.optional(v.id("entities")),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"credentials"> | null> => {
    const provider = args.kind === "ai" ? normalizeAiProviderId(args.provider) ?? undefined : undefined;
    const rows = await ctx.db
      .query("credentials")
      .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", args.workspaceId).eq("kind", args.kind))
      .take(200);
    return (
      rows
        .filter((row) => {
          if (args.kind === "ai") return provider ? (row.provider ?? null) === provider : true;
          if (args.kind === "stripe" && args.entityId) return (row.entityId ?? null) === args.entityId;
          return true;
        })
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
    );
  },
});
