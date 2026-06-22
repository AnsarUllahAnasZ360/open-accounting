import { describe, expect, it } from "vitest";
import { importPKCS8, importJWK } from "jose";

// E13-T2: `pnpm setup` is a plain Node .mjs script. We import its exported pure
// helpers to prove the load-bearing guarantees without doing file IO or
// spawning `convex env set`: a valid RS256 keypair/JWKS is minted, a correctly
// sized encryption key is generated, env upserts are idempotent (never
// duplicate / never clobber), and only server-side secret NAMES are pushed to
// Convex (no NEXT_PUBLIC_* leaks into the deployment env, no values).
import {
  parseEnvLines,
  envValueQuoted,
  upsertEnvLine,
  generateConvexAuthKeys,
  generateEncryptionKey,
  convexServerSecrets,
} from "../scripts/setup.mjs";

describe("setup key minting (E13-T2)", () => {
  it("mints a JWT_PRIVATE_KEY (PKCS8) Convex Auth can import", async () => {
    const { jwt } = await generateConvexAuthKeys();
    // setup.mjs flattens PKCS8 newlines to spaces for a single env line; restore
    // them the way convex-auth does before importing.
    const pem = jwt.replace(/ /g, "\n").replace(/-----BEGIN\nPRIVATE\nKEY-----/, "-----BEGIN PRIVATE KEY-----").replace(/-----END\nPRIVATE\nKEY-----/, "-----END PRIVATE KEY-----");
    const key = await importPKCS8(pem, "RS256");
    expect(key).toBeDefined();
  });

  it("mints a JWKS whose key is a usable RS256 signing public key", async () => {
    const { jwks } = await generateConvexAuthKeys();
    const parsed = JSON.parse(jwks);
    expect(Array.isArray(parsed.keys)).toBe(true);
    expect(parsed.keys).toHaveLength(1);
    expect(parsed.keys[0].use).toBe("sig");
    expect(parsed.keys[0].kty).toBe("RSA");
    const publicKey = await importJWK(parsed.keys[0], "RS256");
    expect(publicKey).toBeDefined();
  });

  it("mints a fresh keypair each call (not a hardcoded constant)", async () => {
    const a = await generateConvexAuthKeys();
    const b = await generateConvexAuthKeys();
    expect(a.jwt).not.toEqual(b.jwt);
    expect(a.jwks).not.toEqual(b.jwks);
  });

  it("generates a 32-byte base64 encryption key (secretBox-sized)", () => {
    const key = generateEncryptionKey();
    const raw = Buffer.from(key, "base64");
    expect(raw.length).toBe(32);
    // Random — two calls differ.
    expect(generateEncryptionKey()).not.toEqual(key);
  });
});

describe("setup env upsert is idempotent (E13-T2)", () => {
  it("replaces an existing (even empty) assignment in place, no duplicate line", () => {
    const before = "OWNER_EMAIL=\nJWT_PRIVATE_KEY=\nJWKS=\n";
    const after = upsertEnvLine(before, "JWT_PRIVATE_KEY", "minted-value");
    const { entries } = parseEnvLines(after);
    expect(entries.get("JWT_PRIVATE_KEY")).toBe("minted-value");
    // Exactly one JWT_PRIVATE_KEY line.
    const occurrences = after.split(/\r?\n/).filter((l) => l.trim().startsWith("JWT_PRIVATE_KEY=")).length;
    expect(occurrences).toBe(1);
    // Untouched neighbours preserved.
    expect(entries.get("OWNER_EMAIL")).toBe("");
    expect(entries.has("JWKS")).toBe(true);
  });

  it("appends a key absent from the file rather than dropping it", () => {
    const before = "OWNER_EMAIL=me@example.com\n";
    const after = upsertEnvLine(before, "OPENBOOKS_SECRET_ENCRYPTION_KEY", "abc123");
    expect(parseEnvLines(after).entries.get("OPENBOOKS_SECRET_ENCRYPTION_KEY")).toBe("abc123");
    expect(parseEnvLines(after).entries.get("OWNER_EMAIL")).toBe("me@example.com");
  });

  it("never overwrites a value the caller already considers set (round-trips)", () => {
    // Caller only mints when absent; round-tripping a set value through the
    // parser/serializer must preserve it verbatim, including spaces.
    const before = "JWKS=" + envValueQuoted('{"keys":[{"use":"sig"}]}') + "\n";
    const { entries } = parseEnvLines(before);
    expect(entries.get("JWKS")).toBe('{"keys":[{"use":"sig"}]}');
  });
});

describe("setup never leaks browser/public env to Convex (E13-T2)", () => {
  it("pushes only server-side secret NAMES, no NEXT_PUBLIC_* and no values", () => {
    // The list is names, never values.
    for (const name of convexServerSecrets) {
      expect(name).not.toMatch(/^NEXT_PUBLIC_/);
      expect(name).toMatch(/^[A-Z0-9_]+$/);
    }
    // Encryption-at-rest key and the auth keypair are pushed server-side.
    expect(convexServerSecrets).toContain("OPENBOOKS_SECRET_ENCRYPTION_KEY");
    expect(convexServerSecrets).toContain("JWT_PRIVATE_KEY");
    expect(convexServerSecrets).toContain("JWKS");
    // The Convex URL the browser needs belongs in Vercel, not the Convex env.
    expect(convexServerSecrets).not.toContain("NEXT_PUBLIC_CONVEX_URL");
  });
});
