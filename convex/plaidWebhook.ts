import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from "jose";

import { callPlaid } from "./plaid";

type PlaidWebhookBody = {
  webhook_type?: unknown;
  webhook_code?: unknown;
  item_id?: unknown;
  error?: unknown;
};

export type PlaidWebhookEvent =
  | {
      kind: "sync_updates_available";
      itemId: string;
      webhookCode: "SYNC_UPDATES_AVAILABLE";
    }
  | {
      kind: "item_error";
      itemId: string;
      webhookCode: string;
      errorCode: string | null;
    }
  | {
      kind: "ignored";
      itemId: string | null;
      webhookCode: string | null;
    };

function base64UrlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

export function normalizePlaidWebhookEvent(body: PlaidWebhookBody): PlaidWebhookEvent {
  const webhookType = stringOrNull(body.webhook_type);
  const webhookCode = stringOrNull(body.webhook_code);
  const itemId = stringOrNull(body.item_id);
  if (!itemId || !webhookCode) {
    return { kind: "ignored", itemId, webhookCode };
  }

  if (webhookType === "TRANSACTIONS" && webhookCode === "SYNC_UPDATES_AVAILABLE") {
    return { kind: "sync_updates_available", itemId, webhookCode };
  }

  if (webhookType === "ITEM" && webhookCode === "ERROR") {
    const error = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
    return {
      kind: "item_error",
      itemId,
      webhookCode,
      errorCode: stringOrNull(error.error_code),
    };
  }

  return { kind: "ignored", itemId, webhookCode };
}

export async function verifyPlaidWebhookSignature({
  payload,
  verificationHeader,
  maxAgeMs = 5 * 60_000,
}: {
  payload: string;
  verificationHeader: string | null;
  maxAgeMs?: number;
}) {
  if (!verificationHeader) {
    return { ok: false as const, error: "missing_plaid_verification_header" };
  }

  const parts = verificationHeader.split(".");
  if (parts.length !== 3) {
    return { ok: false as const, error: "malformed_plaid_verification_header" };
  }

  let keyId: string | undefined;
  try {
    const protectedHeader = decodeProtectedHeader(verificationHeader);
    if (protectedHeader.alg !== "ES256") {
      return { ok: false as const, error: "unsupported_plaid_webhook_algorithm" };
    }
    keyId = protectedHeader.kid;
  } catch {
    return { ok: false as const, error: "malformed_plaid_verification_header" };
  }
  if (!keyId) {
    return { ok: false as const, error: "missing_plaid_webhook_key_id" };
  }

  const keyResponse = await callPlaid("/webhook_verification_key/get", { key_id: keyId });
  const key = keyResponse.key && typeof keyResponse.key === "object" ? keyResponse.key as JWK : null;
  if (!key) {
    return { ok: false as const, error: "plaid_webhook_key_missing" };
  }

  const cryptoKey = await importJWK(key, "ES256");
  const verified = await jwtVerify(verificationHeader, cryptoKey, {
    algorithms: ["ES256"],
  });

  const requestBodyHash = typeof verified.payload.request_body_sha256 === "string"
    ? verified.payload.request_body_sha256
    : null;
  if (!requestBodyHash || requestBodyHash !== await sha256Hex(payload)) {
    return { ok: false as const, error: "plaid_webhook_body_hash_mismatch" };
  }

  if (typeof verified.payload.iat === "number") {
    const ageMs = Math.abs(Date.now() - verified.payload.iat * 1000);
    if (ageMs > maxAgeMs) {
      return { ok: false as const, error: "plaid_webhook_signature_stale" };
    }
  }

  return {
    ok: true as const,
    keyId,
    signatureBytes: base64UrlBytes(parts[2]).length,
  };
}
