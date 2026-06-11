import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const ENABLED_EVENTS = [
  "payment_intent.succeeded",
  "invoice.finalized",
  "invoice.paid",
  "payout.paid",
  "payout.failed",
];

function readEnvFile(path) {
  const env = {};
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const index = trimmed.indexOf("=");
      env[trimmed.slice(0, index).trim()] = trimmed
        .slice(index + 1)
        .trim()
        .replace(/\s+#.*$/, "")
        .replace(/^['"]|['"]$/g, "");
    }
  } catch {
    return env;
  }
  return env;
}

function stripeKeyState(secretKey) {
  if (!secretKey) return { ok: false, reason: "STRIPE_SECRET_KEY is missing." };
  if (secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_")) {
    return { ok: false, reason: "Live Stripe keys are not allowed for this goal." };
  }
  if (!secretKey.startsWith("sk_test_") && !secretKey.startsWith("rk_test_")) {
    return { ok: false, reason: "STRIPE_SECRET_KEY is not a Stripe test-mode key." };
  }
  return { ok: true, reason: "Stripe test-mode key available." };
}

async function stripeRequest(secretKey, path, init = {}) {
  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${secretKey}`,
      "stripe-version": "2026-02-25.clover",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const message = payload?.error?.message ?? `Stripe HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload;
}

function formBody(fields) {
  const body = new URLSearchParams();
  for (const [key, value] of fields) {
    body.append(key, value);
  }
  return body;
}

function setConvexProdWebhookSecret(secret) {
  const result = spawnSync("npx", ["convex", "env", "set", "--prod", "STRIPE_WEBHOOK_SECRET"], {
    input: secret,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error("Convex prod env set failed.");
  }
}

function signStripePayload(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function main() {
  const env = { ...readEnvFile(".env.local"), ...process.env };
  const keyState = stripeKeyState(env.STRIPE_SECRET_KEY);
  if (!keyState.ok) {
    console.log(JSON.stringify({ ok: false, step: "preflight", reason: keyState.reason }, null, 2));
    process.exitCode = 1;
    return;
  }

  const endpointUrl =
    env.STRIPE_WEBHOOK_URL ??
    (env.CONVEX_SITE_URL ? `${env.CONVEX_SITE_URL.replace(/\/$/, "")}/stripe/webhook` : null);
  if (!endpointUrl || endpointUrl.includes("localhost")) {
    console.log(JSON.stringify({
      ok: false,
      step: "endpoint_url",
      reason: "Set STRIPE_WEBHOOK_URL to the production Convex site webhook URL.",
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const list = await stripeRequest(env.STRIPE_SECRET_KEY, "/webhook_endpoints?limit=100");
  let endpoint = list.data?.find((item) => item.url === endpointUrl && item.status !== "deleted") ?? null;
  let signingSecret = env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_") ? env.STRIPE_WEBHOOK_SECRET : null;
  let created = false;

  if (!endpoint) {
    const fields = [
      ["url", endpointUrl],
      ["description", "OpenBooks production Convex webhook endpoint"],
      ...ENABLED_EVENTS.map((event) => ["enabled_events[]", event]),
    ];
    endpoint = await stripeRequest(env.STRIPE_SECRET_KEY, "/webhook_endpoints", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: formBody(fields),
    });
    signingSecret = endpoint.secret ?? signingSecret;
    created = true;
  }

  if (!signingSecret) {
    console.log(JSON.stringify({
      ok: false,
      step: "signing_secret",
      endpointId: endpoint.id,
      endpointUrl,
      created,
      reason: "Existing Stripe webhook endpoint found, but Stripe does not reveal its secret. Set STRIPE_WEBHOOK_SECRET from Stripe Workbench and rerun.",
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  setConvexProdWebhookSecret(signingSecret);

  const eventId = `evt_openbooks_evidence_${Date.now()}`;
  const payload = JSON.stringify({
    id: eventId,
    object: "event",
    api_version: "2026-02-25.clover",
    type: "payment_intent.succeeded",
    livemode: false,
    data: { object: { id: `pi_openbooks_evidence_${Date.now()}` } },
  });
  const delivery = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signStripePayload(payload, signingSecret),
    },
    body: payload,
  });
  const deliveryText = await delivery.text();
  let deliveryBody = null;
  try {
    deliveryBody = deliveryText ? JSON.parse(deliveryText) : null;
  } catch {
    deliveryBody = { raw: deliveryText.slice(0, 120) };
  }

  console.log(JSON.stringify({
    ok: delivery.ok,
    created,
    endpointId: endpoint.id,
    endpointUrl,
    enabledEvents: ENABLED_EVENTS,
    convexProdSecretSet: true,
    signedDeliveryStatus: delivery.status,
    signedDeliveryBody: deliveryBody,
  }, null, 2));
}

main().catch((error) => {
  console.log(JSON.stringify({
    ok: false,
    step: "exception",
    reason: error instanceof Error ? error.message : "Unknown registration error.",
  }, null, 2));
  process.exitCode = 1;
});
