/**
 * Shared symmetric secret encryption for OpenBooks.
 *
 * Runs in the default Convex runtime via Web Crypto (no `"use node"`). Used to
 * encrypt-at-rest any sensitive credential we must store in the database:
 * Plaid access tokens, Stripe restricted keys, Plunk keys, and bring-your-own
 * AI provider keys.
 *
 * Keyed by a single deployment secret, OPENBOOKS_SECRET_ENCRYPTION_KEY. The
 * older OPENBOOKS_TOKEN_ENCRYPTION_KEY remains a compatibility fallback so
 * existing Plaid ciphertext continues to decrypt during self-host upgrades.
 *
 * Ciphertext format is versioned:
 *   - `v1:base64(iv):base64(ciphertext)` — legacy, AES key = bare SHA-256(env).
 *   - `v2:base64(salt):base64(iv):base64(ciphertext)` — AES key derived via
 *     HKDF-SHA-256 from the env value with a per-ciphertext random salt. New
 *     encryptions always use v2; v1 stays decryptable for upgrades.
 */

const ENCRYPTION_ENVS = ["OPENBOOKS_SECRET_ENCRYPTION_KEY", "OPENBOOKS_TOKEN_ENCRYPTION_KEY"] as const;

// Domain-separation context for HKDF so the same env value can never collide
// with a key derived for a different OpenBooks purpose. Copied into a fresh
// ArrayBuffer-backed view so it satisfies the strict BufferSource lib types.
const HKDF_INFO = toBufferSource(new TextEncoder().encode("openbooks/secretBox/v2"));

/** Copy bytes into a fresh, non-shared ArrayBuffer-backed Uint8Array. */
function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy as Uint8Array<ArrayBuffer>;
}

function configuredSecret() {
  for (const name of ENCRYPTION_ENVS) {
    const value = process.env[name]?.trim();
    if (value) return { name, value };
  }
  return null;
}

function base64FromBytes(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesFromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** One HMAC-SHA-256 over Web Crypto (the HKDF primitive). */
async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    "raw",
    toBufferSource(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, toBufferSource(data));
  return new Uint8Array(signature);
}

/**
 * RFC 5869 HKDF-SHA-256 implemented over Web Crypto HMAC. Some Convex runtimes
 * do not implement crypto.subtle's NATIVE "HKDF" (importKey/deriveKey throws
 * "Not implemented … for HKDF"), but they do support HMAC + AES-GCM. This output
 * is byte-identical to native WebCrypto HKDF for the same (ikm, salt, info,
 * length), so v2 ciphertext stays portable across runtimes and deployments.
 */
async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const effectiveSalt = salt.byteLength > 0 ? salt : new Uint8Array(32);
  const prk = await hmacSha256(effectiveSalt, ikm); // extract
  const okm = new Uint8Array(length);
  let previous: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  let offset = 0;
  for (let counter = 1; offset < length; counter += 1) {
    const input = new Uint8Array(previous.byteLength + info.byteLength + 1);
    input.set(previous, 0);
    input.set(info, previous.byteLength);
    input[input.byteLength - 1] = counter;
    previous = await hmacSha256(prk, input); // expand
    const take = Math.min(previous.byteLength, length - offset);
    okm.set(previous.subarray(0, take), offset);
    offset += take;
  }
  return okm;
}

/**
 * Derive a 32-byte AES-GCM key from the configured env secret via HKDF-SHA-256.
 * HKDF (RFC 5869) extracts uniform key material from the (possibly low-entropy)
 * env string and expands it to exactly 32 raw bytes, unlike a bare SHA-256
 * digest which performs no salting and no expansion. Computed over HMAC (above)
 * so it works in the default Convex runtime where native HKDF is unavailable.
 */
async function deriveHkdfKey(secretValue: string, salt: Uint8Array): Promise<CryptoKey> {
  const ikm = new TextEncoder().encode(secretValue);
  const rawKey = await hkdfSha256(ikm, salt, HKDF_INFO, 32);
  return await crypto.subtle.importKey(
    "raw",
    toBufferSource(rawKey),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

/** Legacy v1 key derivation: bare SHA-256 of the env value (decrypt-only). */
async function deriveLegacyKey(secretValue: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secretValue));
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** True when a supported OpenBooks secret encryption key is present. */
export function isSecretEncryptionConfigured() {
  return Boolean(configuredSecret());
}

export function secretEncryptionEnvLabel() {
  return configuredSecret()?.name ?? "OPENBOOKS_SECRET_ENCRYPTION_KEY";
}

/**
 * Encrypt a plaintext secret. Returns `null` when no encryption key is
 * configured so callers can decide how to handle an unconfigured deployment
 * (e.g. allow sandbox-only flows but block storing real credentials).
 *
 * New ciphertext is always emitted in the v2 format (HKDF-derived AES key).
 */
export async function encryptSecret(plaintext: string): Promise<string | null> {
  const secret = configuredSecret();
  if (!secret) return null;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveHkdfKey(secret.value, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `v2:${base64FromBytes(salt)}:${base64FromBytes(iv)}:${base64FromBytes(new Uint8Array(encrypted))}`;
}

/**
 * Decrypt a ciphertext produced by {@link encryptSecret}. Handles both the
 * legacy v1 (bare SHA-256 key) and the current v2 (HKDF key) formats so a
 * deployment can be upgraded without rotating existing stored secrets. Throws
 * when the encryption key is missing or the ciphertext is malformed. `subject`
 * is used only to make the error message legible (e.g. "Plaid access tokens").
 */
export async function decryptSecret(ciphertext: string, subject = "secret"): Promise<string> {
  const secret = configuredSecret();
  if (!secret) {
    throw new Error("OPENBOOKS_SECRET_ENCRYPTION_KEY is required to decrypt " + subject + ".");
  }
  const parts = ciphertext.split(":");
  const version = parts[0];

  if (version === "v2") {
    const [, salt, iv, encrypted] = parts;
    if (!salt || !iv || !encrypted) {
      throw new Error(`Unsupported ${subject} ciphertext.`);
    }
    const key = await deriveHkdfKey(secret.value, bytesFromBase64(salt));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytesFromBase64(iv) },
      key,
      bytesFromBase64(encrypted),
    );
    return new TextDecoder().decode(decrypted);
  }

  if (version === "v1") {
    const [, iv, encrypted] = parts;
    if (!iv || !encrypted) {
      throw new Error(`Unsupported ${subject} ciphertext.`);
    }
    const key = await deriveLegacyKey(secret.value);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytesFromBase64(iv) },
      key,
      bytesFromBase64(encrypted),
    );
    return new TextDecoder().decode(decrypted);
  }

  throw new Error(`Unsupported ${subject} ciphertext.`);
}
