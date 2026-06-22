import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireAnyWorkspacePermission, requireWorkspacePermission } from "./authz";
import { decryptSecret, encryptSecret, isSecretEncryptionConfigured, secretEncryptionEnvLabel } from "./secretBox";
import { safeErrorMessage } from "./secretRedaction";
import { verifyStripeWebhookSignature } from "./stripeWebhook";

const STRIPE_OAUTH_TTL_MS = 10 * 60 * 1000;
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2026-02-25.clover";

type CredentialMode = "sandbox" | "development" | "production" | "test" | "live";

type PlaidCredentialPayload = {
  clientId: string;
  secret: string;
  environment: "sandbox" | "development" | "production";
  redirectUri?: string;
  webhookUrl?: string;
  products: string[];
};

type StripeCredentialPayload = {
  restrictedKey: string;
  webhookSecret?: string;
  accountId?: string;
};

type AuthorizedConnectionEntity = {
  userId: Id<"users">;
  workspaceId: Id<"workspaces">;
  entity: {
    _id: Id<"entities">;
    name: string;
    currency: string;
    workspaceId: Id<"workspaces">;
  };
};

type CredentialSaveResult = {
  connectionId: Id<"financialConnections">;
  credentialId: Id<"connectionCredentials">;
  provider: "plaid" | "stripe";
  mode: CredentialMode;
  status: "active" | "invalid" | "disconnected";
  fingerprint: string;
  keyPreview: string | null;
  lastValidatedAt: number | null;
};

type ResolvedPlaidCredential = {
  connectionId: Id<"financialConnections">;
  credentialId: Id<"connectionCredentials">;
  workspaceId: Id<"workspaces">;
  entityId: Id<"entities">;
  label: string;
  mode: "sandbox" | "development" | "production";
  clientId: string;
  secret: string;
  environment: "sandbox" | "development" | "production";
  redirectUri?: string;
  webhookUrl?: string;
  products: string[];
};

type ResolvedStripeCredential = {
  connectionId: Id<"financialConnections">;
  credentialId: Id<"connectionCredentials">;
  workspaceId: Id<"workspaces">;
  entityId: Id<"entities">;
  label: string;
  mode: "test" | "live";
  restrictedKey: string;
  webhookSecret?: string;
  accountId?: string;
};

type StripeWebhookCredentialMatch = {
  connectionId: Id<"financialConnections">;
  credentialId: Id<"connectionCredentials">;
  workspaceId: Id<"workspaces">;
  entityId: Id<"entities">;
  mode: CredentialMode;
  accountId?: string;
};

type StripeOAuthStartResult = {
  authorizationUrl: string;
  state: string;
  mode: "test" | "live";
  redirectUri: string;
};

function siteUrl() {
  return (process.env.SITE_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

// The Convex HTTP-actions domain (`*.convex.site`) is where `convex/http.ts`
// serves the Stripe and Plaid webhook routes. Convex injects CONVEX_SITE_URL
// into every deployment, so the UI can show the owner the exact URL to register.
function convexSiteUrl() {
  return (process.env.CONVEX_SITE_URL || "").replace(/\/+$/, "");
}

function stripeWebhookUrlValue() {
  const base = convexSiteUrl();
  return base ? `${base}/stripe/webhook` : "";
}

function plaidWebhookUrlValue() {
  if (process.env.PLAID_WEBHOOK_URL) return process.env.PLAID_WEBHOOK_URL;
  const base = convexSiteUrl();
  return base ? `${base}/plaid/webhook` : "";
}

function plaidRedirectUriValue() {
  return process.env.PLAID_OAUTH_REDIRECT_URI || `${siteUrl()}/settings/connections/plaid/callback`;
}

function stripeRedirectUriValue() {
  return process.env.STRIPE_CONNECT_REDIRECT_URI || `${siteUrl()}/settings/connections/stripe/callback`;
}

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function requireRealDataFlag(provider: "Plaid" | "Stripe", mode: CredentialMode) {
  const liveMode = mode === "development" || mode === "production" || mode === "live";
  if (liveMode && process.env.OPENBOOKS_REAL_TEST_LIVE_CONNECTORS !== "1") {
    throw new ConvexError(`${provider} ${mode} mode is blocked until OPENBOOKS_REAL_TEST_LIVE_CONNECTORS=1 is set.`);
  }
}

function requireSecretVault() {
  if (!isSecretEncryptionConfigured()) {
    throw new ConvexError(`${secretEncryptionEnvLabel()} is required before saving Plaid or Stripe credentials.`);
  }
}

type WebhookStatus = "not_configured" | "pending_verification" | "listening" | "failing" | "unknown";

/**
 * E3-T6: decide the webhook status when a credential is (re)saved. A saved
 * secret is never accepted as proof the webhook works: it only earns
 * `pending_verification`. We keep an already-confirmed `listening` status sticky
 * across a key rotation that re-saves the same webhook, so a working connection
 * does not regress to pending on every edit. No secret => `not_configured`.
 */
function webhookStatusOnCredentialSave(
  webhookConfigured: boolean,
  current: WebhookStatus | string | undefined,
): WebhookStatus {
  if (!webhookConfigured) return "not_configured";
  return current === "listening" ? "listening" : "pending_verification";
}

function last4(value: string) {
  return value.slice(-4);
}

function keyPreview(value: string) {
  const [prefix] = value.split("_", 2);
  const second = value.split("_")[1] ?? "";
  return `${prefix}_${second}_...${last4(value)}`;
}

async function secretFingerprint(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parsePlaidPayload(value: string): PlaidCredentialPayload {
  const payload = JSON.parse(value) as Partial<PlaidCredentialPayload>;
  if (
    typeof payload.clientId !== "string" ||
    typeof payload.secret !== "string" ||
    (payload.environment !== "sandbox" && payload.environment !== "development" && payload.environment !== "production")
  ) {
    throw new Error("Saved Plaid credential is malformed.");
  }
  return {
    clientId: payload.clientId,
    secret: payload.secret,
    environment: payload.environment,
    redirectUri: typeof payload.redirectUri === "string" ? payload.redirectUri : undefined,
    webhookUrl: typeof payload.webhookUrl === "string" ? payload.webhookUrl : undefined,
    products: Array.isArray(payload.products) ? payload.products.filter((item): item is string => typeof item === "string") : ["transactions"],
  };
}

function parseStripePayload(value: string): StripeCredentialPayload {
  const payload = JSON.parse(value) as Partial<StripeCredentialPayload>;
  if (typeof payload.restrictedKey !== "string") {
    throw new Error("Saved Stripe credential is malformed.");
  }
  return {
    restrictedKey: payload.restrictedKey,
    webhookSecret: typeof payload.webhookSecret === "string" && payload.webhookSecret.trim() ? payload.webhookSecret : undefined,
    accountId: typeof payload.accountId === "string" ? payload.accountId : undefined,
  };
}

async function stripeRequestWithKey<T>(key: string, path: string) {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${key}`,
      "Stripe-Version": STRIPE_API_VERSION,
    },
  });
  if (!response.ok) {
    let message = `Stripe API request failed with HTTP ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      if (body.error?.message) message = `Stripe API request failed: ${body.error.message}`;
    } catch {
      // Keep the generic message and never echo credentials.
    }
    throw new ConvexError(message);
  }
  return (await response.json()) as T;
}

function stripeSecretForMode(mode: "test" | "live") {
  const value =
    mode === "live"
      ? process.env.STRIPE_LIVE_SECRET_KEY || process.env.STRIPE_SECRET_KEY
      : process.env.STRIPE_TEST_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
  if (!value) {
    throw new ConvexError(`Stripe ${mode} secret key is not configured.`);
  }
  if (mode === "live" && process.env.OPENBOOKS_REAL_TEST_LIVE_CONNECTORS !== "1") {
    throw new ConvexError("Live Stripe is blocked until OPENBOOKS_REAL_TEST_LIVE_CONNECTORS=1 is set.");
  }
  if (mode === "live" && !value.startsWith("sk_live_")) {
    throw new ConvexError("Live Stripe Connect requires an sk_live_ secret key.");
  }
  if (mode === "test" && !value.startsWith("sk_test_")) {
    throw new ConvexError("Stripe test Connect requires an sk_test_ secret key.");
  }
  return value;
}

function stripeClientIdForMode(mode: "test" | "live") {
  const value =
    mode === "live"
      ? process.env.STRIPE_CONNECT_CLIENT_ID_LIVE || process.env.STRIPE_CONNECT_CLIENT_ID
      : process.env.STRIPE_CONNECT_CLIENT_ID_TEST || process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!value) {
    throw new ConvexError(`Stripe ${mode} Connect client id is not configured.`);
  }
  return value;
}

function stripeRedirectUri() {
  const uri = process.env.STRIPE_CONNECT_REDIRECT_URI || `${siteUrl()}/settings/connections/stripe/callback`;
  if (process.env.OPENBOOKS_REAL_TEST_LIVE_CONNECTORS === "1" && !uri.startsWith("https://")) {
    throw new ConvexError("Live Stripe Connect requires an HTTPS redirect URI.");
  }
  return uri;
}

async function ensureStripeClearingAccount(ctx: MutationCtx, entity: Doc<"entities">) {
  const existing = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity_and_number", (q) => q.eq("entityId", entity._id).eq("number", "1150"))
    .unique();
  if (existing) return existing;
  const now = Date.now();
  const id = await ctx.db.insert("ledgerAccounts", {
    entityId: entity._id,
    name: "Stripe Clearing",
    type: "asset",
    subtype: "clearing",
    number: "1150",
    currency: entity.currency,
    isSystem: true,
    archived: false,
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get(id))!;
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const { membership } = await requireAnyWorkspacePermission(ctx, "connections.manage");
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .take(200);
    const connections = await ctx.db
      .query("financialConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .take(500);
    const credentials = await ctx.db
      .query("connectionCredentials")
      .withIndex("by_workspace_and_provider", (q) => q.eq("workspaceId", membership.workspaceId))
      .take(500);
    const plaidAppCredential =
      credentials
        .filter((credential) => credential.provider === "plaid" && credential.status === "active")
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    const bankAccounts = [];
    const plaidItems = [];
    const stripeAccounts: Doc<"stripeAccounts">[] = [];
    for (const entity of entities) {
      const entityBankAccounts = await ctx.db
        .query("bankAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(200);
      bankAccounts.push(...entityBankAccounts);
      const entityPlaidItems = await ctx.db
        .query("plaidItems")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(50);
      plaidItems.push(...entityPlaidItems);
      const entityStripeAccounts = await ctx.db
        .query("stripeAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(50);
      stripeAccounts.push(...entityStripeAccounts);
    }
    const credentialByConnection = new Map(credentials.map((credential) => [String(credential.connectionId), credential]));

    const entityById = new Map(entities.map((entity) => [String(entity._id), entity]));
    const plaidItemById = new Map(plaidItems.map((item) => [item.plaidItemId, item]));
    const rows = connections
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((connection) => {
        const entity = entityById.get(String(connection.entityId));
        const credential = credentialByConnection.get(String(connection._id));
        // E5-T9: resolve the stripeAccounts row backing a Stripe connection so the
        // UI can re-map which business it belongs to. Match by entity +
        // connectedAccountId (externalId carries the account id), else by entity.
        const stripeAccount =
          connection.provider === "stripe"
            ? stripeAccounts.find(
                (account) =>
                  String(account.entityId) === String(connection.entityId) &&
                  (connection.externalId?.includes(account.connectedAccountId ?? " ") ||
                    account.connectedAccountId === connection.externalId),
              ) ??
              stripeAccounts.find((account) => String(account.entityId) === String(connection.entityId))
            : null;
        return {
          id: connection._id,
          provider: connection.provider,
          mode: connection.mode,
          status: connection.status,
          webhookStatus: connection.webhookStatus ?? "unknown",
          displayName: connection.displayName,
          externalId: connection.externalId ?? null,
          entityId: connection.entityId,
          entityName: entity?.name ?? "Unknown business",
          stripeAccountId: stripeAccount?._id ?? null,
          lastSyncedAt: connection.lastSyncedAt ?? null,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
          isCredentialConnection: Boolean(credential),
          credential: credential
            ? {
                id: credential._id,
                status: credential.status,
                fingerprint: credential.fingerprint,
                keyPreview: credential.keyPreview ?? null,
                lastValidatedAt: credential.lastValidatedAt ?? null,
                updatedAt: credential.updatedAt,
              }
            : null,
        };
      });

    return {
      workspaceId: membership.workspaceId,
      businesses: entities
        .filter((entity) => entity.archived !== true)
        .map((entity) => ({
          id: entity._id,
          name: entity.name,
          currency: entity.currency,
          isDemo: entity.isDemo,
        })),
      bankAccounts: bankAccounts
        .filter((account) => account.plaidAccountId && account.plaidItemId && account.plaidItemId !== "openbooks-sandbox-fixture")
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map((account) => {
          const entity = entityById.get(String(account.entityId));
          const plaidItem = account.plaidItemId ? plaidItemById.get(account.plaidItemId) : null;
          return {
            id: account._id,
            entityId: account.entityId,
            entityName: entity?.name ?? "Unknown business",
            name: account.name,
            mask: account.mask,
            kind: account.kind,
            balanceMinor: account.balanceMinor,
            currency: entity?.currency ?? "USD",
            includeInSync: account.includeInSync,
            plaidAccountId: account.plaidAccountId ?? null,
            plaidItemId: account.plaidItemId ?? null,
            institutionName: plaidItem?.institutionName ?? null,
            itemStatus: plaidItem?.status ?? null,
            lastSyncedAt: account.lastSyncedAt ?? plaidItem?.lastSyncedAt ?? null,
            updatedAt: account.updatedAt,
          };
        }),
      connections: rows,
      stripe: {
        oauthConfigured: Boolean(
          process.env.STRIPE_CONNECT_CLIENT_ID ||
            process.env.STRIPE_CONNECT_CLIENT_ID_TEST ||
            process.env.STRIPE_CONNECT_CLIENT_ID_LIVE,
        ),
        liveEnabled: process.env.OPENBOOKS_REAL_TEST_LIVE_CONNECTORS === "1",
        redirectUri: process.env.STRIPE_CONNECT_REDIRECT_URI ? "configured" : "default",
      },
      plaid: {
        environment: plaidAppCredential?.mode ?? process.env.PLAID_ENV ?? "missing",
        liveEnabled: process.env.OPENBOOKS_REAL_TEST_LIVE_CONNECTORS === "1",
      },
      // The single workspace-level Plaid developer app. One app powers Plaid Link
      // for every business; individual bank accounts are attached per business.
      plaidApp: plaidAppCredential
        ? {
            configured: true as const,
            environment: plaidAppCredential.mode,
            keyPreview: plaidAppCredential.keyPreview ?? null,
            label: plaidAppCredential.label,
            lastValidatedAt: plaidAppCredential.lastValidatedAt ?? null,
            status: plaidAppCredential.status,
          }
        : { configured: false as const },
    };
  },
});

// Real, copyable endpoint URLs the owner must register in the Stripe and Plaid
// dashboards. The webhook routes are served from the Convex `*.convex.site`
// domain (see convex/http.ts); OAuth/redirect callbacks live on the web app.
export const webhookConfig = query({
  args: {},
  handler: async (ctx) => {
    await requireAnyWorkspacePermission(ctx, "connections.manage");
    return {
      stripeWebhookUrl: stripeWebhookUrlValue(),
      plaidWebhookUrl: plaidWebhookUrlValue(),
      plaidRedirectUri: plaidRedirectUriValue(),
      stripeRedirectUri: stripeRedirectUriValue(),
      siteUrl: siteUrl(),
    };
  },
});

// E3-T8: the normalized, server-derived health of one connection. `status` is a
// uniform four-state value across every provider so the UI never has to map
// provider-specific machine codes; `action` tells the UI which CTA to surface.
type ConnectionHealth = {
  kind: "ai" | "plaid" | "stripe" | "plunk";
  scope: "workspace" | "business";
  entityId: Id<"entities"> | null;
  entityName: string | null;
  label: string;
  status: "active" | "needs_attention" | "relink_required" | "not_configured";
  detail: string;
  lastValidatedAt: number | null;
  action: "validate" | "relink" | "configure" | null;
};

/**
 * E3-T8: one place that derives every connection's health from the server, so the
 * owner can self-diagnose a broken integration. Reads the unified `credentials`
 * rows (ai/plunk), the Plaid app + items (relink_required), and the Stripe
 * connections + webhook status — and NEVER returns a secret, only redacted
 * status + a CTA hint.
 */
export const health = query({
  args: {},
  handler: async (ctx): Promise<{ connections: ConnectionHealth[] }> => {
    const { membership } = await requireAnyWorkspacePermission(ctx, "connections.manage");
    const workspaceId = membership.workspaceId;
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(200);
    const entityById = new Map(entities.map((entity) => [String(entity._id), entity]));

    const out: ConnectionHealth[] = [];

    // --- AI (workspace-scoped, unified credentials kind:"ai") ---------------
    const aiConfig = await ctx.db
      .query("aiConfigs")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    const aiCredentials = await ctx.db
      .query("credentials")
      .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", workspaceId).eq("kind", "ai"))
      .take(200);
    const chosenProvider = aiConfig?.provider ?? null;
    const aiRow = chosenProvider
      ? aiCredentials.filter((row) => row.provider === chosenProvider).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
      : aiCredentials.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    if (aiRow) {
      const ok = aiRow.status === "active";
      out.push({
        kind: "ai",
        scope: "workspace",
        entityId: null,
        entityName: null,
        label: aiRow.provider ? `AI · ${aiRow.provider}` : "AI",
        status: ok ? "active" : "needs_attention",
        detail: ok ? "Key saved and ready." : "The saved AI key looks invalid — re-test or replace it.",
        lastValidatedAt: aiRow.lastValidatedAt ?? null,
        action: ok ? "validate" : "configure",
      });
    } else {
      out.push({
        kind: "ai",
        scope: "workspace",
        entityId: null,
        entityName: null,
        label: "AI",
        status: "not_configured",
        detail: "Add a provider key to turn on AI categorization and chat.",
        lastValidatedAt: null,
        action: "configure",
      });
    }

    // --- Plunk (workspace-scoped, unified credentials kind:"plunk") ---------
    const plunkRows = await ctx.db
      .query("credentials")
      .withIndex("by_workspace_and_kind", (q) => q.eq("workspaceId", workspaceId).eq("kind", "plunk"))
      .take(10);
    const plunkRow = plunkRows.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    if (plunkRow) {
      const ok = plunkRow.status === "active";
      out.push({
        kind: "plunk",
        scope: "workspace",
        entityId: null,
        entityName: null,
        label: "Email · Plunk",
        status: ok ? "active" : "needs_attention",
        detail: ok ? "Email key verified." : "Plunk rejected the saved key — verify or replace it.",
        lastValidatedAt: plunkRow.lastValidatedAt ?? null,
        action: "validate",
      });
    } else {
      const envConfigured = Boolean(process.env.PLUNK_SECRET_KEY);
      out.push({
        kind: "plunk",
        scope: "workspace",
        entityId: null,
        entityName: null,
        label: "Email · Plunk",
        status: envConfigured ? "active" : "not_configured",
        detail: envConfigured
          ? "Using the deployment's environment key."
          : "Add a Plunk key to send digests, invites, and resets.",
        lastValidatedAt: null,
        action: envConfigured ? null : "configure",
      });
    }

    // --- Plaid (workspace-anchored app + per-item relink state) -------------
    const connectionCredentials = await ctx.db
      .query("connectionCredentials")
      .withIndex("by_workspace_and_provider", (q) => q.eq("workspaceId", workspaceId))
      .take(500);
    const plaidApp =
      connectionCredentials
        .filter((credential) => credential.provider === "plaid" && credential.status === "active")
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    // Any item needing relink takes precedence over an otherwise-healthy app.
    const plaidItems: Doc<"plaidItems">[] = [];
    for (const entity of entities) {
      const items = await ctx.db
        .query("plaidItems")
        .withIndex("by_entity", (q) => q.eq("entityId", entity._id))
        .take(50);
      plaidItems.push(...items.filter((item) => item.status !== "disconnected"));
    }
    const relinkItem = plaidItems.find((item) => item.status === "relink_required") ?? null;
    if (plaidApp) {
      if (relinkItem) {
        const entity = entityById.get(String(relinkItem.entityId));
        out.push({
          kind: "plaid",
          scope: "workspace",
          entityId: relinkItem.entityId,
          entityName: entity?.name ?? null,
          label: relinkItem.institutionName ? `Bank · ${relinkItem.institutionName}` : "Banks · Plaid",
          status: "relink_required",
          detail: "A bank needs to be reconnected to keep syncing.",
          lastValidatedAt: plaidApp.lastValidatedAt ?? null,
          action: "relink",
        });
      } else {
        out.push({
          kind: "plaid",
          scope: "workspace",
          entityId: null,
          entityName: null,
          label: "Banks · Plaid",
          status: "active",
          detail: "Plaid app connected. Add or sync banks anytime.",
          lastValidatedAt: plaidApp.lastValidatedAt ?? null,
          action: "validate",
        });
      }
    } else {
      out.push({
        kind: "plaid",
        scope: "workspace",
        entityId: null,
        entityName: null,
        label: "Banks · Plaid",
        status: "not_configured",
        detail: "Add your Plaid app credentials to connect banks.",
        lastValidatedAt: null,
        action: "configure",
      });
    }

    // --- Stripe (per-business; webhook gates "active") ----------------------
    const stripeConnections = await ctx.db
      .query("financialConnections")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(500);
    const credentialByConnection = new Map(
      connectionCredentials.map((credential) => [String(credential.connectionId), credential]),
    );
    for (const connection of stripeConnections) {
      if (connection.provider !== "stripe" || connection.status === "disconnected") continue;
      const credential = credentialByConnection.get(String(connection._id));
      const entity = entityById.get(String(connection.entityId));
      const webhookStatus = connection.webhookStatus ?? "unknown";
      const keyInvalid = credential ? credential.status !== "active" : connection.status !== "active";
      let status: ConnectionHealth["status"];
      let detail: string;
      let action: ConnectionHealth["action"];
      if (keyInvalid) {
        status = "needs_attention";
        detail = "The saved Stripe key looks invalid — update it.";
        action = "configure";
      } else if (webhookStatus === "failing") {
        status = "needs_attention";
        detail = "Stripe sent an event we couldn't verify. Re-copy the signing secret and verify.";
        action = "validate";
      } else if (webhookStatus === "listening") {
        status = "active";
        detail = "Connected with live updates on.";
        action = "validate";
      } else {
        status = "needs_attention";
        detail = "Webhook not verified yet — live payout/refund/dispute updates stay off until it is.";
        action = "validate";
      }
      out.push({
        kind: "stripe",
        scope: "business",
        entityId: connection.entityId,
        entityName: entity?.name ?? null,
        label: connection.displayName,
        status,
        detail,
        lastValidatedAt: credential?.lastValidatedAt ?? null,
        action,
      });
    }

    return { connections: out };
  },
});

export const authorizeWorkspaceForConnections = internalQuery({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ userId: Id<"users">; workspaceId: Id<"workspaces">; anchorEntityId: Id<"entities"> | null }> => {
    const { userId, membership } = await requireAnyWorkspacePermission(ctx, "connections.manage");
    const entities = await ctx.db
      .query("entities")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", membership.workspaceId))
      .take(200);
    const anchor = entities.find((entity) => entity.archived !== true) ?? entities[0] ?? null;
    return { userId, workspaceId: membership.workspaceId, anchorEntityId: anchor?._id ?? null };
  },
});

export const authorizeEntityForConnections = internalQuery({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args): Promise<AuthorizedConnectionEntity> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) {
      throw new ConvexError("Business not found.");
    }
    const { userId, membership } = await requireWorkspacePermission(ctx, entity.workspaceId, "connections.manage");
    return {
      userId,
      workspaceId: membership.workspaceId,
      entity: {
        _id: entity._id,
        name: entity.name,
        currency: entity.currency,
        workspaceId: entity.workspaceId,
      },
    };
  },
});

// One Plaid developer app per workspace. The same Client ID/secret powers Plaid
// Link for every business in the workspace; bank accounts are attached to a
// specific business when Link completes. The credential is anchored to one
// entity row (Convex requires it) but resolved workspace-wide at link time.
export const saveWorkspacePlaidApp = action({
  args: {
    label: v.optional(v.string()),
    clientId: v.string(),
    secret: v.string(),
    environment: v.union(v.literal("sandbox"), v.literal("development"), v.literal("production")),
    redirectUri: v.optional(v.string()),
    webhookUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CredentialSaveResult> => {
    const authz: { userId: Id<"users">; workspaceId: Id<"workspaces">; anchorEntityId: Id<"entities"> | null } =
      await ctx.runQuery(internal.connections.authorizeWorkspaceForConnections, {});
    if (!authz.anchorEntityId) {
      throw new ConvexError("Create a business first so imported bank activity has somewhere to land.");
    }
    requireSecretVault();
    requireRealDataFlag("Plaid", args.environment);
    const clientId = args.clientId.trim();
    const secret = args.secret.trim();
    if (!clientId || !secret) {
      throw new ConvexError("Plaid Client ID and secret are required.");
    }
    const redirectUri = args.redirectUri?.trim();
    const webhookUrl = args.webhookUrl?.trim();
    if ((args.environment === "development" || args.environment === "production") && redirectUri && !redirectUri.startsWith("https://")) {
      throw new ConvexError("Plaid OAuth redirect URI must be HTTPS in development or production mode.");
    }
    if (webhookUrl && !webhookUrl.startsWith("https://")) {
      throw new ConvexError("Plaid webhook URL must be HTTPS.");
    }
    const payload: PlaidCredentialPayload = {
      clientId,
      secret,
      environment: args.environment,
      ...(redirectUri ? { redirectUri } : {}),
      ...(webhookUrl ? { webhookUrl } : {}),
      products: ["transactions"],
    };
    const encryptedPayload = await encryptSecret(JSON.stringify(payload));
    if (!encryptedPayload) {
      throw new ConvexError(`${secretEncryptionEnvLabel()} is required before saving Plaid credentials.`);
    }
    return await ctx.runMutation(internal.connections.upsertConnectionCredential, {
      workspaceId: authz.workspaceId,
      entityId: authz.anchorEntityId,
      createdByUserId: authz.userId,
      provider: "plaid",
      mode: args.environment,
      label: args.label?.trim() || "Plaid app",
      externalId: `credential:plaid:workspace:${authz.workspaceId}`,
      encryptedPayload,
      fingerprint: await secretFingerprint(`${clientId}:${secret}:${args.environment}`),
      keyPreview: `client...${last4(clientId)}`,
      webhookConfigured: Boolean(webhookUrl),
      lastValidatedAt: Date.now(),
      status: "active",
    });
  },
});

export const saveStripeCredential = action({
  args: {
    entityId: v.id("entities"),
    label: v.optional(v.string()),
    mode: v.union(v.literal("test"), v.literal("live")),
    restrictedKey: v.string(),
    webhookSecret: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CredentialSaveResult> => {
    const authz: AuthorizedConnectionEntity = await ctx.runQuery(internal.connections.authorizeEntityForConnections, {
      entityId: args.entityId,
    });
    requireSecretVault();
    requireRealDataFlag("Stripe", args.mode);
    const restrictedKey = args.restrictedKey.trim();
    if (!restrictedKey.startsWith(args.mode === "live" ? "rk_live_" : "rk_test_")) {
      throw new ConvexError(`Use a Stripe restricted ${args.mode} key that starts with ${args.mode === "live" ? "rk_live_" : "rk_test_"}.`);
    }
    // E3-T6: a webhook is a hard prerequisite for a Stripe connection — without it
    // payouts/refunds/disputes can't reconcile in real time. We require the
    // signing secret on save; it is stored "pending_verification" until a signed
    // delivery (or the verify action) confirms it.
    const webhookSecret = args.webhookSecret?.trim();
    if (!webhookSecret) {
      throw new ConvexError(
        "A Stripe webhook signing secret is required. Register the webhook endpoint in Stripe and paste its whsec_ secret.",
      );
    }
    if (!webhookSecret.startsWith("whsec_")) {
      throw new ConvexError("Stripe webhook signing secret should start with whsec_.");
    }
    const account = await stripeRequestWithKey<{
      id?: string;
      object?: string;
      business_profile?: { name?: string | null };
      settings?: { dashboard?: { display_name?: string | null } };
    }>(restrictedKey, "/account");
    const accountId = account.id;
    if (!accountId) {
      throw new ConvexError("Stripe accepted the key but did not return an account id.");
    }
    const displayLabel =
      args.label?.trim() ||
      account.settings?.dashboard?.display_name ||
      account.business_profile?.name ||
      `Stripe ${args.mode} account`;
    const payload: StripeCredentialPayload = {
      restrictedKey,
      ...(webhookSecret ? { webhookSecret } : {}),
      accountId,
    };
    const encryptedPayload = await encryptSecret(JSON.stringify(payload));
    if (!encryptedPayload) {
      throw new ConvexError(`${secretEncryptionEnvLabel()} is required before saving Stripe credentials.`);
    }
    return await ctx.runMutation(internal.connections.upsertConnectionCredential, {
      workspaceId: authz.workspaceId,
      entityId: args.entityId,
      createdByUserId: authz.userId,
      provider: "stripe",
      mode: args.mode,
      label: displayLabel,
      externalId: `credential:stripe:${args.mode}:${accountId}`,
      encryptedPayload,
      fingerprint: await secretFingerprint(`${restrictedKey}:${accountId}`),
      keyPreview: keyPreview(restrictedKey),
      webhookConfigured: Boolean(webhookSecret),
      lastValidatedAt: Date.now(),
      status: "active",
      stripeAccountId: accountId,
    });
  },
});

export const startStripeOAuth = action({
  args: {
    entityId: v.id("entities"),
    mode: v.union(v.literal("test"), v.literal("live")),
  },
  handler: async (ctx, args): Promise<StripeOAuthStartResult> => {
    const authz: AuthorizedConnectionEntity = await ctx.runQuery(internal.connections.authorizeEntityForConnections, {
      entityId: args.entityId,
    });
    const clientId = stripeClientIdForMode(args.mode);
    stripeSecretForMode(args.mode);
    const redirectUri = stripeRedirectUri();
    const state = randomState();
    await ctx.runMutation(internal.connections.createStripeOAuthState, {
      workspaceId: authz.workspaceId,
      entityId: args.entityId,
      state,
      mode: args.mode,
      redirectUri,
      createdByUserId: authz.userId,
    });

    const url = new URL("https://connect.stripe.com/oauth/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("scope", "read_write");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", redirectUri);

    return {
      authorizationUrl: url.toString(),
      state,
      mode: args.mode,
      redirectUri,
    };
  },
});

export const completeStripeOAuth = action({
  args: {
    state: v.string(),
    code: v.string(),
  },
  handler: async (ctx, args): Promise<{
    connectionId: Id<"financialConnections">;
    provider: "stripe";
    status: "active";
    connectedAccountId: string;
    entityId: Id<"entities">;
    entityName: string;
    mode: "test" | "live";
  }> => {
    const stateRow: {
      workspaceId: Id<"workspaces">;
      entityId: Id<"entities">;
      createdByUserId: Id<"users">;
      mode: "test" | "live";
    } = await ctx.runMutation(internal.connections.claimStripeOAuthState, {
      state: args.state,
    });
    const secret = stripeSecretForMode(stateRow.mode);
    const response = await fetch("https://connect.stripe.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${secret}:`)}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: args.code,
      }),
    });
    const payload = (await response.json()) as {
      stripe_user_id?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };
    if (!response.ok || !payload.stripe_user_id) {
      throw new ConvexError(payload.error_description || payload.error || "Stripe OAuth failed.");
    }

    return await ctx.runMutation(internal.connections.recordStripeConnection, {
      workspaceId: stateRow.workspaceId,
      entityId: stateRow.entityId,
      createdByUserId: stateRow.createdByUserId,
      connectedAccountId: payload.stripe_user_id,
      mode: stateRow.mode,
      scopes: payload.scope?.split(/\s+/).filter(Boolean) ?? [],
    });
  },
});

export const disconnect = mutation({
  args: { connectionId: v.id("financialConnections") },
  handler: async (ctx, args): Promise<{ connectionId: Id<"financialConnections">; status: "disconnected" }> => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) throw new ConvexError("Connection not found.");
    await requireWorkspacePermission(ctx, connection.workspaceId, "connections.manage");
    const credentials = await ctx.db
      .query("connectionCredentials")
      .withIndex("by_connection", (q) => q.eq("connectionId", connection._id))
      .take(10);
    const now = Date.now();
    await ctx.db.patch(connection._id, {
      status: "disconnected",
      updatedAt: now,
    });
    if (connection.provider === "plaid" && connection.externalId) {
      const plaidItem = await ctx.db
        .query("plaidItems")
        .withIndex("by_item", (q) => q.eq("plaidItemId", connection.externalId!))
        .unique();
      if (plaidItem) {
        await ctx.db.patch(plaidItem._id, { status: "disconnected", syncLockUntil: undefined, updatedAt: now });
      }
    }
    for (const credential of credentials) {
      await ctx.db.patch(credential._id, { status: "disconnected", updatedAt: now });
    }
    return { connectionId: connection._id, status: "disconnected" as const };
  },
});

// ---------------------------------------------------------------------------
// E5-T9 — First-class bank/Stripe → business re-association.
//
// Ansar's single Plaid login spans both LLCs and his two Stripe accounts map to
// different entities, but `entityId` was fixed at creation with no re-map path.
// These mutations let an owner change which business a connection belongs to.
//
// Immutability guardrail (decision Q26): posted journal lines are NEVER moved.
// Re-map is FUTURE-SYNCS-ONLY — we re-point the connection to a corresponding
// ledger account in the destination entity, so previously-posted history stays
// under the original entity (immutable) and only subsequently-synced
// transactions land under the new entity. Both source and destination MUST be in
// the SAME workspace (no cross-workspace move), and the caller must hold
// business.manage.
// ---------------------------------------------------------------------------

/** Next free CoA slot for a bank/credit ledger account in an entity. */
async function nextBankLedgerNumber(
  ctx: MutationCtx,
  entityId: Id<"entities">,
  kind: Doc<"bankAccounts">["kind"],
) {
  const accounts = await ctx.db
    .query("ledgerAccounts")
    .withIndex("by_entity", (q) => q.eq("entityId", entityId))
    .take(200);
  const used = new Set(accounts.map((account) => account.number));
  const start = kind === "credit" ? 2001 : 1030;
  const end = kind === "credit" ? 2099 : 1099;
  for (let candidate = start; candidate <= end; candidate += 1) {
    const number = String(candidate);
    if (!used.has(number)) return number;
  }
  throw new ConvexError("No chart-of-accounts slot is available in the destination business.");
}

/** Whether any posted journal line exists under a ledger account. */
async function ledgerAccountHasPostedLines(ctx: MutationCtx, ledgerAccountId: Id<"ledgerAccounts">) {
  const line = await ctx.db
    .query("journalLines")
    .withIndex("by_account", (q) => q.eq("accountId", ledgerAccountId))
    .first();
  return line != null;
}

export const reassignBankAccountEntity = mutation({
  args: {
    bankAccountId: v.id("bankAccounts"),
    entityId: v.id("entities"),
  },
  handler: async (ctx, args) => {
    const bankAccount = await ctx.db.get(args.bankAccountId);
    if (!bankAccount) throw new ConvexError("Bank account not found.");
    const [source, destination] = await Promise.all([
      ctx.db.get(bankAccount.entityId),
      ctx.db.get(args.entityId),
    ]);
    if (!source) throw new ConvexError("Source business not found.");
    if (!destination) throw new ConvexError("Destination business not found.");
    // Same-workspace only — no cross-workspace move.
    if (source.workspaceId !== destination.workspaceId) {
      throw new ConvexError("A connection can only be moved between businesses in the same workspace.");
    }
    const { userId } = await requireWorkspacePermission(ctx, destination.workspaceId, "business.manage");

    const now = Date.now();
    if (bankAccount.entityId === destination._id) {
      return { bankAccountId: bankAccount._id, entityId: destination._id, movedHistory: false };
    }

    // FUTURE-SYNCS-ONLY: posted lines stay under the original ledger account/
    // entity. Point the bank account at a corresponding ledger account in the
    // destination entity (create one if needed) so future syncs post there.
    const hadPostedLines = await ledgerAccountHasPostedLines(ctx, bankAccount.ledgerAccountId);
    const newLedgerAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId: destination._id,
      name: bankAccount.name,
      type: bankAccount.kind === "credit" ? "liability" : "asset",
      subtype: bankAccount.kind === "credit" ? "credit_card" : "bank",
      number: await nextBankLedgerNumber(ctx, destination._id, bankAccount.kind),
      currency: destination.currency,
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(bankAccount._id, {
      entityId: destination._id,
      ledgerAccountId: newLedgerAccountId,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      workspaceId: destination.workspaceId,
      actorUserId: userId,
      action: "connection.bank.reassigned",
      entityType: "bankAccount",
      entityId: bankAccount._id,
      summary: `Moved bank account "${bankAccount.name}" from ${source.name} to ${destination.name}${
        hadPostedLines ? " (existing posted history stays with " + source.name + "; future syncs only)" : ""
      }`,
      createdAt: now,
    });

    return {
      bankAccountId: bankAccount._id,
      entityId: destination._id,
      ledgerAccountId: newLedgerAccountId,
      movedHistory: false,
      hadPostedLines,
    };
  },
});

export const reassignStripeAccountEntity = mutation({
  args: {
    stripeAccountId: v.id("stripeAccounts"),
    entityId: v.id("entities"),
  },
  handler: async (ctx, args) => {
    const stripeAccount = await ctx.db.get(args.stripeAccountId);
    if (!stripeAccount) throw new ConvexError("Stripe account not found.");
    const [source, destination] = await Promise.all([
      ctx.db.get(stripeAccount.entityId),
      ctx.db.get(args.entityId),
    ]);
    if (!source) throw new ConvexError("Source business not found.");
    if (!destination) throw new ConvexError("Destination business not found.");
    if (source.workspaceId !== destination.workspaceId) {
      throw new ConvexError("A connection can only be moved between businesses in the same workspace.");
    }
    const { userId } = await requireWorkspacePermission(ctx, destination.workspaceId, "business.manage");

    const now = Date.now();
    if (stripeAccount.entityId === destination._id) {
      return { stripeAccountId: stripeAccount._id, entityId: destination._id, movedHistory: false };
    }

    // FUTURE-SYNCS-ONLY: posted clearing lines stay under the source entity.
    // Re-point the clearing account to a fresh asset (Stripe clearing) account in
    // the destination entity.
    const hadPostedLines = await ledgerAccountHasPostedLines(ctx, stripeAccount.clearingAccountId);
    const newClearingAccountId = await ctx.db.insert("ledgerAccounts", {
      entityId: destination._id,
      name: stripeAccount.label || "Stripe Clearing",
      type: "asset",
      subtype: "bank",
      number: await nextBankLedgerNumber(ctx, destination._id, "checking"),
      currency: destination.currency,
      isSystem: false,
      archived: false,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(stripeAccount._id, {
      entityId: destination._id,
      clearingAccountId: newClearingAccountId,
      updatedAt: now,
    });

    await ctx.db.insert("auditEvents", {
      workspaceId: destination.workspaceId,
      actorUserId: userId,
      action: "connection.stripe.reassigned",
      entityType: "stripeAccount",
      entityId: stripeAccount._id,
      summary: `Moved Stripe account "${stripeAccount.label}" from ${source.name} to ${destination.name}${
        hadPostedLines ? " (existing posted history stays with " + source.name + "; future syncs only)" : ""
      }`,
      createdAt: now,
    });

    return {
      stripeAccountId: stripeAccount._id,
      entityId: destination._id,
      clearingAccountId: newClearingAccountId,
      movedHistory: false,
      hadPostedLines,
    };
  },
});

// One-time migration: the previous UI saved the same Plaid app credential once
// per business. Collapse each workspace's duplicates down to the most recently
// updated active credential and disconnect the rest (plus their marker
// connections). Idempotent — safe to run repeatedly.
// Run with: npx convex run connections:collapseWorkspacePlaidCredentials
export const collapseWorkspacePlaidCredentials = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ workspacesProcessed: number; credentialsDisconnected: number }> => {
    const all = await ctx.db.query("connectionCredentials").take(2000);
    const activePlaid = all.filter((credential) => credential.provider === "plaid" && credential.status === "active");
    const byWorkspace = new Map<string, typeof activePlaid>();
    for (const credential of activePlaid) {
      const key = String(credential.workspaceId);
      const group = byWorkspace.get(key) ?? [];
      group.push(credential);
      byWorkspace.set(key, group);
    }
    const now = Date.now();
    let credentialsDisconnected = 0;
    for (const group of byWorkspace.values()) {
      if (group.length <= 1) continue;
      const [, ...stale] = group.slice().sort((a, b) => b.updatedAt - a.updatedAt);
      for (const credential of stale) {
        await ctx.db.patch(credential._id, { status: "disconnected", updatedAt: now });
        const connection = await ctx.db.get(credential.connectionId);
        if (connection && connection.provider === "plaid") {
          await ctx.db.patch(connection._id, { status: "disconnected", updatedAt: now });
        }
        credentialsDisconnected += 1;
      }
    }
    return { workspacesProcessed: byWorkspace.size, credentialsDisconnected };
  },
});

export const upsertConnectionCredential = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    entityId: v.id("entities"),
    createdByUserId: v.id("users"),
    provider: v.union(v.literal("plaid"), v.literal("stripe")),
    mode: v.union(
      v.literal("sandbox"),
      v.literal("development"),
      v.literal("production"),
      v.literal("test"),
      v.literal("live"),
    ),
    label: v.string(),
    externalId: v.string(),
    encryptedPayload: v.string(),
    fingerprint: v.string(),
    keyPreview: v.optional(v.string()),
    webhookConfigured: v.boolean(),
    lastValidatedAt: v.optional(v.number()),
    status: v.union(v.literal("active"), v.literal("invalid"), v.literal("disconnected")),
    stripeAccountId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CredentialSaveResult> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("Business not found.");
    const now = Date.now();
    const existingConnection = await ctx.db
      .query("financialConnections")
      .withIndex("by_external", (q) => q.eq("provider", args.provider).eq("externalId", args.externalId))
      .first();
    const connectionPatch = {
      workspaceId: args.workspaceId,
      entityId: args.entityId,
      provider: args.provider,
      mode: args.mode,
      displayName: args.label,
      externalId: args.externalId,
      status: args.status === "active" ? ("active" as const) : ("configuration_required" as const),
      // E3-T6: saving a webhook secret is NOT proof the webhook works. We keep an
      // already-verified ("listening") status sticky, but a freshly saved secret
      // only earns "pending_verification" until a signed delivery (or the explicit
      // verify action) confirms it. Never auto-report "listening" on save.
      webhookStatus: webhookStatusOnCredentialSave(
        args.webhookConfigured,
        existingConnection?.webhookStatus,
      ),
      createdByUserId: args.createdByUserId,
      updatedAt: now,
    };
    const connectionId = existingConnection
      ? (await ctx.db.patch(existingConnection._id, connectionPatch), existingConnection._id)
      : await ctx.db.insert("financialConnections", {
          ...connectionPatch,
          createdAt: now,
        });

    const existingCredential = await ctx.db
      .query("connectionCredentials")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .first();
    const credentialPatch = {
      workspaceId: args.workspaceId,
      entityId: args.entityId,
      connectionId,
      provider: args.provider,
      mode: args.mode,
      label: args.label,
      encryptedPayload: args.encryptedPayload,
      fingerprint: args.fingerprint,
      keyPreview: args.keyPreview,
      status: args.status,
      lastValidatedAt: args.lastValidatedAt,
      createdByUserId: args.createdByUserId,
      updatedAt: now,
    };
    const credentialId = existingCredential
      ? (await ctx.db.patch(existingCredential._id, credentialPatch), existingCredential._id)
      : await ctx.db.insert("connectionCredentials", {
          ...credentialPatch,
          createdAt: now,
        });

    if (args.provider === "stripe") {
      const clearingAccount = await ensureStripeClearingAccount(ctx, entity);
      const stripeAccounts = await ctx.db
        .query("stripeAccounts")
        .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
        .take(100);
      const existingStripeAccount = stripeAccounts.find(
        (account) => account.connectedAccountId === args.stripeAccountId || account.label === args.label,
      );
      const stripeAccountPatch = {
        entityId: args.entityId,
        clearingAccountId: clearingAccount._id,
        label: args.label,
        connectedAccountId: args.stripeAccountId,
        mode: args.mode === "live" ? ("live" as const) : ("test" as const),
        status: "active" as const,
        scopes: ["restricted_key_read"],
        webhookStatus: webhookStatusOnCredentialSave(
          args.webhookConfigured,
          existingStripeAccount?.webhookStatus,
        ),
        updatedAt: now,
      };
      if (existingStripeAccount) {
        await ctx.db.patch(existingStripeAccount._id, stripeAccountPatch);
      } else {
        await ctx.db.insert("stripeAccounts", {
          ...stripeAccountPatch,
          createdAt: now,
        });
      }
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: args.workspaceId,
      actorUserId: args.createdByUserId,
      action: `connection.${args.provider}.credential.saved`,
      entityType: "connectionCredential",
      entityId: credentialId,
      summary: `Saved ${args.provider} credentials for ${entity.name}`,
      createdAt: now,
    });

    return {
      connectionId,
      credentialId,
      provider: args.provider,
      mode: args.mode,
      status: args.status,
      fingerprint: args.fingerprint,
      keyPreview: args.keyPreview ?? null,
      lastValidatedAt: args.lastValidatedAt ?? null,
    };
  },
});

// Resolve the workspace's single active Plaid app credential, given any entity
// in that workspace. This is what makes "one Plaid app per workspace" work: a
// bank linked under business B uses the app saved anywhere in the workspace.
export const getWorkspacePlaidCredentialByEntity = internalQuery({
  args: { entityId: v.id("entities") },
  handler: async (ctx, args): Promise<Doc<"connectionCredentials"> | null> => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) return null;
    const rows = await ctx.db
      .query("connectionCredentials")
      .withIndex("by_workspace_and_provider", (q) => q.eq("workspaceId", entity.workspaceId).eq("provider", "plaid"))
      .take(100);
    return rows.filter((row) => row.status === "active").sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  },
});

export const getActiveCredentialForEntity = internalQuery({
  args: {
    entityId: v.id("entities"),
    provider: v.union(v.literal("plaid"), v.literal("stripe")),
    connectionId: v.optional(v.id("financialConnections")),
  },
  handler: async (ctx, args): Promise<Doc<"connectionCredentials"> | null> => {
    const rows = await ctx.db
      .query("connectionCredentials")
      .withIndex("by_entity_and_provider", (q) => q.eq("entityId", args.entityId).eq("provider", args.provider))
      .take(100);
    return (
      rows
        .filter((row) => row.status === "active")
        .filter((row) => !args.connectionId || row.connectionId === args.connectionId)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
    );
  },
});

export const listStripeWebhookCredentialCandidates = internalQuery({
  args: {},
  handler: async (ctx): Promise<Array<Doc<"connectionCredentials">>> => {
    const rows = await ctx.db.query("connectionCredentials").take(200);
    return rows.filter((row) => row.provider === "stripe" && row.status === "active");
  },
});

export const resolvePlaidCredentialForEntity = internalAction({
  args: {
    entityId: v.id("entities"),
  },
  handler: async (ctx, args): Promise<ResolvedPlaidCredential | null> => {
    const credential: Doc<"connectionCredentials"> | null = await ctx.runQuery(
      internal.connections.getWorkspacePlaidCredentialByEntity,
      { entityId: args.entityId },
    );
    if (!credential) return null;
    const payload = parsePlaidPayload(await decryptSecret(credential.encryptedPayload, "Plaid credentials"));
    if (credential.mode !== "sandbox" && credential.mode !== "development" && credential.mode !== "production") {
      throw new Error("Saved Plaid credential has an invalid mode.");
    }
    return {
      connectionId: credential.connectionId,
      credentialId: credential._id,
      workspaceId: credential.workspaceId,
      entityId: credential.entityId,
      label: credential.label,
      mode: credential.mode,
      clientId: payload.clientId,
      secret: payload.secret,
      environment: payload.environment,
      redirectUri: payload.redirectUri,
      webhookUrl: payload.webhookUrl,
      products: payload.products,
    };
  },
});

export const resolveStripeCredentialForEntity = internalAction({
  args: {
    entityId: v.id("entities"),
    connectionId: v.optional(v.id("financialConnections")),
  },
  handler: async (ctx, args): Promise<ResolvedStripeCredential | null> => {
    const credential: Doc<"connectionCredentials"> | null = await ctx.runQuery(internal.connections.getActiveCredentialForEntity, {
      entityId: args.entityId,
      provider: "stripe",
      ...(args.connectionId ? { connectionId: args.connectionId } : {}),
    });
    if (!credential) return null;
    const payload = parseStripePayload(await decryptSecret(credential.encryptedPayload, "Stripe credentials"));
    if (credential.mode !== "test" && credential.mode !== "live") {
      throw new Error("Saved Stripe credential has an invalid mode.");
    }
    return {
      connectionId: credential.connectionId,
      credentialId: credential._id,
      workspaceId: credential.workspaceId,
      entityId: credential.entityId,
      label: credential.label,
      mode: credential.mode,
      restrictedKey: payload.restrictedKey,
      webhookSecret: payload.webhookSecret,
      accountId: payload.accountId,
    };
  },
});

export const verifyStripeWebhookCredential = internalAction({
  args: {
    payload: v.string(),
    signatureHeader: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<StripeWebhookCredentialMatch | null> => {
    const candidates: Array<Doc<"connectionCredentials">> = await ctx.runQuery(internal.connections.listStripeWebhookCredentialCandidates, {});
    for (const credential of candidates) {
      let payload: StripeCredentialPayload;
      try {
        payload = parseStripePayload(await decryptSecret(credential.encryptedPayload, "Stripe webhook credentials"));
      } catch {
        continue;
      }
      if (!payload.webhookSecret) continue;
      const verified = await verifyStripeWebhookSignature({
        payload: args.payload,
        signatureHeader: args.signatureHeader ?? null,
        secret: payload.webhookSecret,
      });
      if (verified) {
        return {
          connectionId: credential.connectionId,
          credentialId: credential._id,
          workspaceId: credential.workspaceId,
          entityId: credential.entityId,
          mode: credential.mode,
          accountId: payload.accountId,
        };
      }
    }
    return null;
  },
});

/**
 * E3-T6: a signed delivery arrived that we could NOT verify against any saved
 * secret. If the event names a connected account we recognize, flag that
 * connection's webhook as "failing" so the owner sees a distinct broken state
 * (vs. an unrelated event we simply ignore). Never throws — best effort.
 */
export const markStripeWebhookSignatureFailure = internalMutation({
  args: {
    connectedAccountId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ flagged: boolean }> => {
    if (!args.connectedAccountId) return { flagged: false };
    const accounts = await ctx.db
      .query("stripeAccounts")
      .take(500);
    const match = accounts.find((account) => account.connectedAccountId === args.connectedAccountId);
    if (!match) return { flagged: false };
    const now = Date.now();
    await ctx.db.patch(match._id, { webhookStatus: "failing", updatedAt: now });
    // The stripe financialConnection's externalId is the credential key
    // (`credential:stripe:<mode>:<acct>`), so resolve it via the owning entity.
    const connections = await ctx.db
      .query("financialConnections")
      .withIndex("by_entity_and_provider", (q) => q.eq("entityId", match.entityId).eq("provider", "stripe"))
      .take(50);
    for (const connection of connections) {
      await ctx.db.patch(connection._id, { webhookStatus: "failing", updatedAt: now });
    }
    return { flagged: true };
  },
});

/**
 * E3-T6: record the outcome of a real Stripe webhook delivery on the connection +
 * its stripeAccount. A verified signed delivery flips webhookStatus to
 * "listening" (the only thing that earns it); a delivery whose signature failed
 * for a known account sets "failing". Stamps lastValidatedAt on success.
 */
export const markStripeWebhookDelivery = internalMutation({
  args: {
    connectionId: v.id("financialConnections"),
    entityId: v.id("entities"),
    outcome: v.union(v.literal("verified"), v.literal("failed")),
  },
  handler: async (ctx, args): Promise<{ webhookStatus: WebhookStatus }> => {
    const now = Date.now();
    const webhookStatus: WebhookStatus = args.outcome === "verified" ? "listening" : "failing";
    const connection = await ctx.db.get(args.connectionId);
    if (connection && connection.provider === "stripe") {
      // financialConnections tracks webhookStatus only; lastValidatedAt lives on
      // the stripeAccount + the credential row.
      await ctx.db.patch(connection._id, { webhookStatus, updatedAt: now });
    }
    const stripeAccounts = await ctx.db
      .query("stripeAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .take(100);
    for (const account of stripeAccounts) {
      await ctx.db.patch(account._id, {
        webhookStatus,
        ...(args.outcome === "verified" ? { lastValidatedAt: now } : {}),
        updatedAt: now,
      });
    }
    return { webhookStatus };
  },
});

/**
 * E3-T8: stamp the outcome of a Stripe key re-probe onto the credential row +
 * its financialConnection so connections.health can read a server-derived
 * status. `active` re-stamps lastValidatedAt; `invalid` flags the credential
 * (and surfaces the "Update key" CTA) without touching the webhook status.
 */
export const markStripeCredentialValidated = internalMutation({
  args: {
    connectionId: v.id("financialConnections"),
    outcome: v.union(v.literal("active"), v.literal("invalid")),
  },
  handler: async (ctx, args): Promise<{ status: "active" | "invalid" }> => {
    const now = Date.now();
    const credential = await ctx.db
      .query("connectionCredentials")
      .withIndex("by_connection", (q) => q.eq("connectionId", args.connectionId))
      .first();
    if (credential) {
      await ctx.db.patch(credential._id, {
        status: args.outcome,
        ...(args.outcome === "active" ? { lastValidatedAt: now } : {}),
        updatedAt: now,
      });
    }
    const connection = await ctx.db.get(args.connectionId);
    if (connection && connection.provider === "stripe") {
      await ctx.db.patch(connection._id, {
        status: args.outcome === "active" ? ("active" as const) : ("configuration_required" as const),
        updatedAt: now,
      });
    }
    return { status: args.outcome };
  },
});

/**
 * E3-T8: owner-triggered "validate" for a saved Stripe connection. Re-calls
 * Stripe `/account` with the stored restricted key, stamps lastValidatedAt on
 * success or flips the credential to `invalid` on an auth failure. Returns a
 * redacted result — never the restricted key.
 */
export const validateStripeCredential = action({
  args: {
    entityId: v.id("entities"),
    connectionId: v.optional(v.id("financialConnections")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; status: "active" | "invalid" | "not_configured"; message: string }> => {
    await ctx.runQuery(internal.connections.authorizeEntityForConnections, { entityId: args.entityId });
    const resolved: ResolvedStripeCredential | null = await ctx.runAction(
      internal.connections.resolveStripeCredentialForEntity,
      { entityId: args.entityId, ...(args.connectionId ? { connectionId: args.connectionId } : {}) },
    );
    if (!resolved) {
      return { ok: false, status: "not_configured", message: "Connect Stripe for this business first." };
    }
    try {
      await stripeRequestWithKey<{ id?: string }>(resolved.restrictedKey, "/account");
      await ctx.runMutation(internal.connections.markStripeCredentialValidated, {
        connectionId: resolved.connectionId,
        outcome: "active",
      });
      return { ok: true, status: "active", message: "Stripe key is valid." };
    } catch (error) {
      await ctx.runMutation(internal.connections.markStripeCredentialValidated, {
        connectionId: resolved.connectionId,
        outcome: "invalid",
      });
      // Redact the resolved key + webhook secret from any surfaced message (T10).
      const detail = safeErrorMessage(
        error,
        [resolved.restrictedKey, resolved.webhookSecret],
        "Stripe rejected the saved key.",
      );
      return { ok: false, status: "invalid", message: detail };
    }
  },
});

/**
 * E3-T6: owner-triggered "verify webhook" action. Sends a Stripe test event to a
 * registered endpoint (or, when test dispatch is unavailable, confirms the saved
 * webhook secret is well-formed) and flips the connection to "listening" only on
 * a real confirmation. Returns a redacted result — never the webhook secret.
 */
export const verifyStripeWebhook = action({
  args: {
    entityId: v.id("entities"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; webhookStatus: WebhookStatus; message: string }> => {
    await ctx.runQuery(internal.connections.authorizeEntityForConnections, {
      entityId: args.entityId,
    });
    const resolved: ResolvedStripeCredential | null = await ctx.runAction(
      internal.connections.resolveStripeCredentialForEntity,
      { entityId: args.entityId },
    );
    if (!resolved) {
      return {
        ok: false,
        webhookStatus: "not_configured",
        message: "Connect Stripe first, then add a webhook signing secret.",
      };
    }
    if (!resolved.webhookSecret) {
      return {
        ok: false,
        webhookStatus: "not_configured",
        message: "Add the webhook signing secret from Stripe before verifying.",
      };
    }
    if (!resolved.webhookSecret.startsWith("whsec_")) {
      const result = await ctx.runMutation(internal.connections.markStripeWebhookDelivery, {
        connectionId: resolved.connectionId,
        entityId: args.entityId,
        outcome: "failed",
      });
      return {
        ok: false,
        webhookStatus: result.webhookStatus,
        message: "The saved webhook signing secret is malformed. Re-copy it from Stripe.",
      };
    }
    // Ask Stripe whether a usable webhook endpoint is registered for this key.
    // Restricted keys with read-only webhook scope can list endpoints; the
    // presence of an enabled endpoint pointing at our route confirms setup.
    const expectedUrl = stripeWebhookUrlValue();
    try {
      const endpoints = await stripeRequestWithKey<{
        data?: Array<{ url?: string; status?: string }>;
      }>(resolved.restrictedKey, "/webhook_endpoints?limit=100");
      const enabled = (endpoints.data ?? []).filter(
        (endpoint) => (endpoint.status ?? "enabled") === "enabled",
      );
      const matchesOurUrl = expectedUrl
        ? enabled.some((endpoint) => (endpoint.url ?? "") === expectedUrl)
        : enabled.length > 0;
      if (matchesOurUrl) {
        const result = await ctx.runMutation(internal.connections.markStripeWebhookDelivery, {
          connectionId: resolved.connectionId,
          entityId: args.entityId,
          outcome: "verified",
        });
        return {
          ok: true,
          webhookStatus: result.webhookStatus,
          message: "Webhook endpoint is registered and enabled. Live updates are on.",
        };
      }
      return {
        ok: false,
        webhookStatus: "pending_verification",
        message: expectedUrl
          ? `No enabled webhook endpoint points to ${expectedUrl} yet. Register it in Stripe, then verify again.`
          : "No enabled webhook endpoint was found yet. Register the endpoint in Stripe, then verify again.",
      };
    } catch (error) {
      // The key may lack webhook read scope; we cannot positively confirm setup,
      // so we stay pending rather than falsely report "listening".
      return {
        ok: false,
        webhookStatus: "pending_verification",
        message:
          error instanceof Error && /permission|scope|api key/i.test(error.message)
            ? "This restricted key can't read webhook endpoints. Stripe will confirm automatically on the first signed delivery."
            : "Could not confirm the webhook with Stripe yet. It will confirm on the first signed delivery.",
      };
    }
  },
});

export const createStripeOAuthState = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    entityId: v.id("entities"),
    state: v.string(),
    mode: v.union(v.literal("test"), v.literal("live")),
    redirectUri: v.string(),
    createdByUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("stripeOAuthStates", {
      workspaceId: args.workspaceId,
      entityId: args.entityId,
      state: args.state,
      mode: args.mode,
      redirectUri: args.redirectUri,
      createdByUserId: args.createdByUserId,
      expiresAt: now + STRIPE_OAUTH_TTL_MS,
      createdAt: now,
    });
  },
});

export const claimStripeOAuthState = internalMutation({
  args: { state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("stripeOAuthStates")
      .withIndex("by_state", (q) => q.eq("state", args.state))
      .unique();
    if (!row) {
      throw new ConvexError("Stripe OAuth state was not found.");
    }
    if (row.expiresAt < Date.now()) {
      await ctx.db.delete(row._id);
      throw new ConvexError("Stripe OAuth state expired. Start the connection again.");
    }
    await ctx.db.delete(row._id);
    return row;
  },
});

export const recordStripeConnection = internalMutation({
  args: {
    workspaceId: v.id("workspaces"),
    entityId: v.id("entities"),
    createdByUserId: v.id("users"),
    connectedAccountId: v.string(),
    mode: v.union(v.literal("test"), v.literal("live")),
    scopes: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const entity = await ctx.db.get(args.entityId);
    if (!entity) throw new ConvexError("Business not found.");
    const now = Date.now();
    const displayName = `Stripe ${args.mode === "live" ? "live" : "test"} account ${args.connectedAccountId}`;
    const existingConnection = await ctx.db
      .query("financialConnections")
      .withIndex("by_external", (q) => q.eq("provider", "stripe").eq("externalId", args.connectedAccountId))
      .first();
    const connectionPatch = {
      workspaceId: args.workspaceId,
      entityId: args.entityId,
      provider: "stripe" as const,
      mode: args.mode,
      displayName,
      externalId: args.connectedAccountId,
      status: "active" as const,
      webhookStatus: "unknown" as const,
      createdByUserId: args.createdByUserId,
      updatedAt: now,
    };
    const connectionId = existingConnection
      ? (await ctx.db.patch(existingConnection._id, connectionPatch), existingConnection._id)
      : await ctx.db.insert("financialConnections", {
          ...connectionPatch,
          createdAt: now,
        });

    const clearingAccount = await ensureStripeClearingAccount(ctx, entity);
    const existingStripeAccount = await ctx.db
      .query("stripeAccounts")
      .withIndex("by_entity", (q) => q.eq("entityId", args.entityId))
      .first();
    if (existingStripeAccount) {
      await ctx.db.patch(existingStripeAccount._id, {
        clearingAccountId: clearingAccount._id,
        label: displayName,
        connectedAccountId: args.connectedAccountId,
        mode: args.mode,
        status: "active",
        scopes: args.scopes,
        webhookStatus: "unknown",
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("stripeAccounts", {
        entityId: args.entityId,
        clearingAccountId: clearingAccount._id,
        label: displayName,
        connectedAccountId: args.connectedAccountId,
        mode: args.mode,
        status: "active",
        scopes: args.scopes,
        webhookStatus: "unknown",
        createdAt: now,
        updatedAt: now,
      });
    }

    await ctx.db.insert("auditEvents", {
      workspaceId: args.workspaceId,
      actorUserId: args.createdByUserId,
      action: "connection.stripe.connected",
      entityType: "financialConnection",
      entityId: connectionId,
      summary: `Connected Stripe ${args.mode} account to ${entity.name}`,
      createdAt: now,
    });

    return {
      connectionId,
      provider: "stripe" as const,
      status: "active" as const,
      connectedAccountId: args.connectedAccountId,
      entityId: args.entityId,
      entityName: entity.name,
      mode: args.mode,
    };
  },
});
