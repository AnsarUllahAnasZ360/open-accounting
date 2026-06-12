import { v } from "convex/values";

import { internalMutation } from "./_generated/server";

const DEFAULT_TOLERANCE_SECONDS = 300;

type StripeWebhookEvent = {
  id?: unknown;
  type?: unknown;
  livemode?: unknown;
  api_version?: unknown;
	  data?: {
	    object?: {
	      id?: unknown;
	      payment_intent?: unknown;
	    };
	  };
	};

function utf8(value: string) {
  return new TextEncoder().encode(value);
}

function hex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

function parseStripeSignatureHeader(header: string) {
  const parts = header.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const timestamp = timestampPart ? Number(timestampPart.slice(2)) : NaN;
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter(Boolean);
  return { timestamp, signatures };
}

export async function stripeWebhookSignature(args: {
  payload: string;
  timestamp: number;
  secret: string;
}) {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(args.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedPayload = `${args.timestamp}.${args.payload}`;
  return hex(await crypto.subtle.sign("HMAC", key, utf8(signedPayload)));
}

export async function verifyStripeWebhookSignature(args: {
  payload: string;
  signatureHeader: string | null;
  secret: string;
  nowMs?: number;
  toleranceSeconds?: number;
}) {
  if (!args.signatureHeader || !args.secret.trim()) return false;
  const { timestamp, signatures } = parseStripeSignatureHeader(args.signatureHeader);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;

  const nowSeconds = Math.floor((args.nowMs ?? Date.now()) / 1000);
  const tolerance = args.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - timestamp) > tolerance) return false;

  const expected = await stripeWebhookSignature({
    payload: args.payload,
    timestamp,
    secret: args.secret,
  });
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

export function normalizeStripeWebhookEvent(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Stripe webhook payload must be an event object.");
  }
  const event = raw as StripeWebhookEvent;
  if (typeof event.id !== "string" || typeof event.type !== "string") {
    throw new Error("Stripe webhook payload is missing id or type.");
  }
	  const objectId = event.data?.object && typeof event.data.object.id === "string"
	    ? event.data.object.id
	    : undefined;
	  const relatedPaymentIntentId =
	    event.data?.object && typeof event.data.object.payment_intent === "string"
	      ? event.data.object.payment_intent
	      : undefined;
	  const apiVersion = typeof event.api_version === "string" ? event.api_version : undefined;
	  const livemode = event.livemode === true;
	  return {
	    stripeEventId: event.id,
	    type: event.type,
	    objectId,
	    relatedPaymentIntentId,
	    apiVersion,
	    livemode,
	  };
	}

export const recordEvent = internalMutation({
  args: {
    stripeEventId: v.string(),
	    type: v.string(),
	    objectId: v.optional(v.string()),
	    relatedPaymentIntentId: v.optional(v.string()),
	    livemode: v.boolean(),
	    apiVersion: v.optional(v.string()),
	  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("stripeWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("stripeEventId", args.stripeEventId))
      .unique();
    if (existing) {
      return { status: "duplicate" as const, eventId: existing._id };
    }

    const status = args.livemode ? "ignored" as const : "received" as const;
    const summary = args.livemode
      ? `Ignored live-mode Stripe event ${args.type}.`
      : `Received Stripe test-mode event ${args.type}${args.objectId ? ` for ${args.objectId}` : ""}.`;
    const eventId = await ctx.db.insert("stripeWebhookEvents", {
	      stripeEventId: args.stripeEventId,
	      type: args.type,
	      objectId: args.objectId,
	      relatedPaymentIntentId: args.relatedPaymentIntentId,
	      livemode: args.livemode,
      apiVersion: args.apiVersion,
      status,
      summary,
      receivedAt: Date.now(),
    });
    return { status, eventId };
  },
});
