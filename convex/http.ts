import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";
import { normalizeStripeWebhookEvent, verifyStripeWebhookSignature } from "./stripeWebhook";

const http = httpRouter();

auth.addHttpRoutes(http);

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.text();
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
    if (!secret) {
      return jsonResponse(
        { ok: false, error: "stripe_webhook_secret_missing" },
        { status: 503 },
      );
    }

    const verified = await verifyStripeWebhookSignature({
      payload,
      signatureHeader: request.headers.get("stripe-signature"),
      secret,
    });
    if (!verified) {
      return jsonResponse({ ok: false, error: "invalid_signature" }, { status: 400 });
    }

    let event;
    try {
      event = normalizeStripeWebhookEvent(JSON.parse(payload));
    } catch (error) {
      return jsonResponse(
        { ok: false, error: error instanceof Error ? error.message : "invalid_payload" },
        { status: 400 },
      );
    }

    const result: { status: "received" | "ignored" | "duplicate"; eventId: string } = await ctx.runMutation(
      internal.stripeWebhook.recordEvent,
      event,
    );
    return jsonResponse({
      ok: true,
      status: result.status,
      event: {
        id: event.stripeEventId,
        type: event.type,
        livemode: event.livemode,
      },
    });
  }),
});

export default http;
