import { describe, expect, it } from "vitest";

import {
  normalizeStripeWebhookEvent,
  stripeWebhookSignature,
  verifyStripeWebhookSignature,
} from "./stripeWebhook";

describe("Stripe webhook helpers", () => {
  it("verifies a valid Stripe-Signature header against the raw payload", async () => {
    const secret = ["whsec", "test", "secret"].join("_");
    const payload = JSON.stringify({
      id: "evt_test_webhook",
      type: "payment_intent.succeeded",
      livemode: false,
      api_version: "2026-02-25.clover",
      data: { object: { id: "pi_test_webhook" } },
    });
    const timestamp = 1_780_000_000;
    const signature = await stripeWebhookSignature({
      payload,
      timestamp,
      secret,
    });

    await expect(
      verifyStripeWebhookSignature({
        payload,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        secret,
        nowMs: timestamp * 1000,
      }),
    ).resolves.toBe(true);
  });

  it("rejects changed payloads and stale timestamps", async () => {
    const secret = ["whsec", "test", "secret"].join("_");
    const payload = "{\"id\":\"evt_test_webhook\"}";
    const timestamp = 1_780_000_000;
    const signature = await stripeWebhookSignature({
      payload,
      timestamp,
      secret,
    });

    await expect(
      verifyStripeWebhookSignature({
        payload: `${payload} `,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        secret,
        nowMs: timestamp * 1000,
      }),
    ).resolves.toBe(false);

    await expect(
      verifyStripeWebhookSignature({
        payload,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        secret,
        nowMs: (timestamp + 301) * 1000,
      }),
    ).resolves.toBe(false);
  });

  it("normalizes event metadata without storing the raw Stripe payload", () => {
    expect(
      normalizeStripeWebhookEvent({
        id: "evt_test_webhook",
        type: "invoice.paid",
        livemode: false,
        api_version: "2026-02-25.clover",
        data: { object: { id: "in_test_webhook" } },
      }),
    ).toEqual({
      stripeEventId: "evt_test_webhook",
      type: "invoice.paid",
      objectId: "in_test_webhook",
      livemode: false,
      apiVersion: "2026-02-25.clover",
    });
  });
});
