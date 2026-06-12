import { httpRouter, makeFunctionReference } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { auth } from "./auth";
import { isDevAuthBypassEnabled } from "./authz";
import { normalizePlaidWebhookEvent, verifyPlaidWebhookSignature } from "./plaidWebhook";
import { normalizeStripeWebhookEvent, verifyStripeWebhookSignature } from "./stripeWebhook";

const http = httpRouter();

auth.addHttpRoutes(http);

type AIChatRuntimeResult = {
  ok: boolean;
  mode: "active" | "degraded";
  runtime: "ai_sdk_tools" | "degraded" | "validation";
  text: string;
  toolsUsed: string[];
};
type StripeWebhookSyncResult = {
  status: "synced" | "ignored" | "skipped" | "error";
  reason: string;
};
const aiChatAnswerRef = makeFunctionReference<
  "action",
  {
    workspaceId: Id<"workspaces">;
    entityId?: Id<"entities">;
    question: string;
  },
  AIChatRuntimeResult
>("aiChatRuntime:answer");
const stripeWebhookSyncRef = makeFunctionReference<
  "action",
  {
    stripeEventId: string;
    type: string;
    objectId?: string;
    relatedPaymentIntentId?: string;
  },
  StripeWebhookSyncResult
>("stripe:syncFromWebhookEvent");

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

function allowedOrigin(origin: string | null) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.hostname === "openbooks.ansarullahanas.com") return origin;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
  } catch {
    return null;
  }
  return null;
}

function corsHeaders(request: Request) {
  const origin = allowedOrigin(request.headers.get("origin"));
  return {
    ...(origin ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    vary: "origin",
  };
}

function chunkedText(text: string) {
  const encoder = new TextEncoder();
  const words = text.split(/(\s+)/);
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const word of words) {
        controller.enqueue(encoder.encode(word));
        await new Promise((resolve) => setTimeout(resolve, 12));
      }
      controller.close();
    },
  });
}

http.route({
  path: "/ai/chat",
  method: "OPTIONS",
  handler: httpAction(async (_ctx, request) => {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request),
    });
  }),
});

http.route({
  path: "/ai/chat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const headers = corsHeaders(request);
    const identity = await ctx.auth.getUserIdentity();
    if (!identity && !isDevAuthBypassEnabled()) {
      return jsonResponse({ ok: false, error: "unauthenticated" }, { status: 401, headers });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "invalid_json" }, { status: 400, headers });
    }

    if (!body || typeof body !== "object" || typeof body.workspaceId !== "string" || typeof body.question !== "string") {
      return jsonResponse({ ok: false, error: "invalid_request" }, { status: 400, headers });
    }

    const result = await ctx.runAction(aiChatAnswerRef, {
      workspaceId: body.workspaceId as Id<"workspaces">,
      entityId: typeof body.entityId === "string" ? body.entityId as Id<"entities"> : undefined,
      question: body.question,
    });

    return new Response(chunkedText(result.text), {
      status: result.ok ? 200 : 202,
      headers: {
        ...headers,
        "content-type": "text/plain; charset=utf-8",
        "x-openbooks-ai-runtime": result.runtime,
        "x-openbooks-ai-mode": result.mode,
        "x-openbooks-ai-tools": result.toolsUsed.join(","),
      },
    });
  }),
});

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
	    const sync =
	      result.status === "received"
	        ? await ctx.runAction(stripeWebhookSyncRef, {
	            stripeEventId: event.stripeEventId,
	            type: event.type,
	            objectId: event.objectId,
	            relatedPaymentIntentId: event.relatedPaymentIntentId,
	          })
	        : { status: "skipped" as const, reason: `Stripe event was ${result.status}; no sync run needed.` };
	    return jsonResponse({
	      ok: true,
	      status: result.status,
	      sync,
	      event: {
	        id: event.stripeEventId,
	        type: event.type,
        livemode: event.livemode,
      },
    });
  }),
});

http.route({
  path: "/plaid/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.text();
    const verified = await verifyPlaidWebhookSignature({
      payload,
      verificationHeader: request.headers.get("Plaid-Verification"),
    });
    if (!verified.ok) {
      return jsonResponse({ ok: false, error: verified.error }, { status: 400 });
    }

    let event;
    try {
      event = normalizePlaidWebhookEvent(JSON.parse(payload));
    } catch {
      return jsonResponse({ ok: false, error: "invalid_plaid_payload" }, { status: 400 });
    }

    if (event.kind !== "sync_updates_available") {
      return jsonResponse({
        ok: true,
        status: "ignored",
        event,
      });
    }

    const result = await ctx.runAction(internal.plaid.syncItemByPlaidItemId, {
      plaidItemId: event.itemId,
      trigger: "webhook",
      webhookCode: event.webhookCode,
    });

    return jsonResponse({
      ok: true,
      status: result.status,
      event,
    });
  }),
});

export default http;
