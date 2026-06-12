/// <reference types="vite/client" />
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizePlaidWebhookEvent, verifyPlaidWebhookSignature } from "./plaidWebhook";

function hex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Plaid webhook verification", () => {
  it("normalizes Transactions sync webhooks", () => {
    expect(
      normalizePlaidWebhookEvent({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "item-1",
      }),
    ).toEqual({
      kind: "sync_updates_available",
      itemId: "item-1",
      webhookCode: "SYNC_UPDATES_AVAILABLE",
    });
  });

  it("verifies Plaid's signed webhook body hash with the fetched JWK", async () => {
    vi.stubEnv("PLAID_CLIENT_ID", "client-id-test");
    vi.stubEnv("PLAID_SECRET", "sandbox-secret-test");
    vi.stubEnv("PLAID_ENV", "sandbox");

    const payload = JSON.stringify({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: "item-1",
    });
    const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
    const jwk = await exportJWK(publicKey);
    jwk.kid = "plaid-key-test";
    const verificationHeader = await new SignJWT({
      request_body_sha256: await sha256Hex(payload),
    })
      .setProtectedHeader({ alg: "ES256", kid: "plaid-key-test" })
      .setIssuedAt(Math.floor(Date.now() / 1000))
      .sign(privateKey);

    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      expect(String(url)).toContain("/webhook_verification_key/get");
      expect(body).toMatchObject({
        client_id: "client-id-test",
        secret: "sandbox-secret-test",
        key_id: "plaid-key-test",
      });
      return new Response(JSON.stringify({ key: jwk }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      verifyPlaidWebhookSignature({
        payload,
        verificationHeader,
      }),
    ).resolves.toMatchObject({
      ok: true,
      keyId: "plaid-key-test",
    });
  });
});
