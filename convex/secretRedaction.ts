/**
 * Shared secret-redaction helper (E3-T10).
 *
 * Every integration action that can throw an error built from a provider's
 * response — AI, Plaid, Stripe, Plunk — routes its error message through here so
 * a raw key can never echo back to the client or land in an audit summary. The
 * rule this enforces: a thrown ConvexError/Error message never contains a
 * secret substring (api key, AWS secret-access-key, Stripe restricted key,
 * webhook signing secret, Plunk key, access token).
 *
 * It is provider-agnostic and has no Node dependency, so it can be imported by
 * both `"use node"` runtimes (aiSdkRuntime) and plain Convex actions.
 */

const REDACTED = "[redacted]";

// Env-sourced secrets that may appear verbatim in an SDK error. Resolved
// credentials are passed via `extra` at the call site (we never read BYO secrets
// from env here).
const ENV_SECRET_NAMES = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "PLAID_SECRET",
  "PLAID_CLIENT_ID",
  "STRIPE_SECRET_KEY",
  "STRIPE_LIVE_SECRET_KEY",
  "STRIPE_TEST_SECRET_KEY",
  "PLUNK_SECRET_KEY",
];

function envSecrets(): string[] {
  const out: string[] = [];
  for (const name of ENV_SECRET_NAMES) {
    const value = process.env[name]?.trim();
    if (value) out.push(value);
  }
  return out;
}

/**
 * Replace every known secret substring in `message` with `[redacted]`. `extra`
 * holds runtime-resolved secrets (a decrypted BYO apiKey, a Stripe restricted
 * key, a webhook secret) that are not in env. Only values >= 4 chars are masked
 * so we never blank out an empty string into the whole message.
 */
export function redactSecrets(message: string, extra: Array<string | null | undefined> = []): string {
  const secrets = [...envSecrets(), ...extra];
  return secrets.reduce<string>((current, value) => {
    return value && value.length >= 4 ? current.split(value).join(REDACTED) : current;
  }, message);
}

/**
 * Turn any thrown value into a safe, single-line, length-capped, secret-free
 * message suitable for returning to the client.
 */
export function safeErrorMessage(
  error: unknown,
  extra: Array<string | null | undefined> = [],
  fallback = "Request failed.",
): string {
  const raw = error instanceof Error ? error.message : fallback;
  return redactSecrets(raw, extra).replace(/\s+/g, " ").slice(0, 300);
}
