import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  KeyRound,
  Lock,
  ShieldCheck,
  EyeOff,
  GitBranch,
  Globe,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { GITHUB_SELF_HOST_DOCS, GITHUB_URL } from "@/lib/openbooks/brand-links";

// E13-T5: public, no-login security-posture page. Static server component —
// renders the same five code-cited claims as docs/security/security-posture.md
// so a prospect or security-minded owner can read how their bank tokens and
// keys are protected before pasting a secret. Design-system compliant: white
// surfaces, Geist, lucide icons, single brand green, no gradients/emoji/purple.

export const metadata: Metadata = {
  title: "Security posture — OpenBooks",
  description:
    "How OpenBooks protects your bank tokens and API keys: encryption at rest, secrets never returned, server-side authorization, the live-key HTTPS requirement, and a no-PII-commit posture.",
};

type Claim = {
  icon: typeof Lock;
  title: string;
  body: string;
  cite: string;
  verify: string;
};

const claims: Claim[] = [
  {
    icon: Lock,
    title: "Credentials are encrypted at rest",
    body: "Plaid access tokens, Stripe restricted keys, Plunk keys and your AI provider key are encrypted with AES-GCM before they touch the database. The key is derived per-ciphertext via HKDF-SHA-256 from a deployment secret and is never written to the database — no key, no stored credential.",
    cite: "convex/secretBox.ts · encryptSecret() / deriveHkdfKey()",
    verify: 'grep -n "AES-GCM\\|deriveHkdfKey" convex/secretBox.ts',
  },
  {
    icon: EyeOff,
    title: "Secrets are never returned to the client",
    body: "Saving or listing a credential returns only redacted metadata — a one-way fingerprint, a short key preview (sk_live_…1234) and a status. The plaintext key or token never leaves the server. Resolved plaintext exists only inside server-side actions.",
    cite: "convex/credentials.ts · saveCredential() return shape, credentialStatus(), maskKeyPreview()",
    verify: 'grep -n "keyPreview\\|fingerprint\\|maskKeyPreview\\|credentialStatus" convex/credentials.ts',
  },
  {
    icon: Globe,
    title: "Live connectors — with a required HTTPS redirect",
    body: "Live Plaid (development/production) and live Stripe keys are supported locally and in self-host; there is no sandbox/test-only ban. The retained guarantee is that live connectors need a stable HTTPS origin for OAuth redirects and webhooks — an http:// origin cannot safely receive a live bank or payment callback.",
    cite: "convex/connections.ts · stripeRedirectUri() HTTPS guard (~line 264)",
    verify: 'grep -an "requires an HTTPS\\|sk_live_" convex/connections.ts',
  },
  {
    icon: ShieldCheck,
    title: "Authorization is re-checked server-side",
    body: "Authorization is never trusted from the client. Every query, mutation and action re-checks the caller's workspace/entity permission on the server before reading or writing — dozens of backend modules call a shared authz helper.",
    cite: "convex/authz.ts · requireWorkspacePermission / requireAnyWorkspacePermission",
    verify: 'grep -rl "requireWorkspacePermission\\|requireUserId" convex/*.ts | grep -v test | wc -l',
  },
  {
    icon: GitBranch,
    title: "No secret or PII is committed to git",
    body: "The repository never contains a real secret or private financial record. .gitignore ignores .env and .env.* and allowlists only .env.example (placeholders). A secret-scan gate (planned, E13-T8) fails the build on any real key shape in tracked docs or pages.",
    cite: ".gitignore · docs/security/secrets.md · pnpm scan:secrets (planned)",
    verify: "git ls-files | grep -E '^\\.env'  # prints only .env.example",
  },
];

function MarketingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95">
      <div className="mx-auto flex h-[60px] max-w-[1080px] items-center gap-6 px-4 lg:px-6">
        <Link className="flex items-center gap-2.5" href="/">
          <span className="flex size-7 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
            ob
          </span>
          <span className="text-[15px] font-semibold">open books</span>
        </Link>
        <div className="flex-1" />
        <nav className="hidden items-center gap-6 md:flex">
          <Link className="text-[13.5px] text-muted-foreground hover:text-foreground" href="/setup">
            Set up
          </Link>
          <Link className="text-[13.5px] font-medium text-foreground" href="/security">
            Security
          </Link>
        </nav>
        <Button asChild className="h-9 rounded-[10px] px-4 text-[13.5px]">
          <Link href="/demo">Try the demo</Link>
        </Button>
      </div>
    </header>
  );
}

export default function SecurityPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <section className="mx-auto max-w-[760px] px-4 pb-6 pt-12 lg:px-6 lg:pt-16">
        <Link
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          href="/"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.8} />
          Back to home
        </Link>
        <div className="mt-6 text-xs font-semibold uppercase tracking-[0.06em] text-[#1d6b12]">
          Security posture
        </div>
        <h1 className="mt-2 text-[34px] font-semibold leading-[1.1] tracking-normal md:text-[40px]">
          Where your keys live — and how they&apos;re protected.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          OpenBooks is bring-your-own-keys and self-hosted. Before you paste a Plaid secret, a
          Stripe restricted key, or an AI provider key into your own deployment, here is exactly
          how that secret is handled — with file citations you can check yourself. This is a lean,
          honest, code-cited statement, not a marketing trust page.
        </p>
      </section>

      <section className="mx-auto max-w-[760px] px-4 pb-12 lg:px-6">
        <div className="flex flex-col gap-4">
          {claims.map((claim, index) => (
            <article key={claim.title} className="rounded-[14px] border bg-background p-5 sm:p-6">
              <div className="flex items-start gap-3.5">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#f1f8ee]">
                  <claim.icon className="size-[18px] text-[#1d6b12]" strokeWidth={1.8} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="money-figures text-xs text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h2 className="text-[16px] font-semibold leading-snug">{claim.title}</h2>
                  </div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
                    {claim.body}
                  </p>
                  <div className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
                    <KeyRound className="size-3.5 shrink-0 text-[#1d6b12]" strokeWidth={1.8} />
                    <span className="font-medium text-foreground">{claim.cite}</span>
                  </div>
                  <pre className="money-figures mt-2 overflow-x-auto rounded-[8px] border bg-muted/40 px-3 py-2 text-[11.5px] leading-relaxed text-foreground">
                    <code>{claim.verify}</code>
                  </pre>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[760px] px-4 pb-16 lg:px-6">
        <div className="rounded-[14px] border bg-muted/35 p-5 sm:p-6">
          <h2 className="text-[15px] font-semibold">What this does not claim</h2>
          <ul className="mt-3 flex flex-col gap-2 text-[13.5px] leading-relaxed text-muted-foreground">
            <li className="flex gap-2">
              <span className="font-semibold text-[#248716]">→</span>
              <span>No third-party security audit has been performed yet.</span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-[#248716]">→</span>
              <span>
                Anyone with read access to your deployment&apos;s environment variables can read the
                encryption key and decrypt stored credentials — protect your Convex/Vercel
                deployment env like the secret it is.
              </span>
            </li>
            <li className="flex gap-2">
              <span className="font-semibold text-[#248716]">→</span>
              <span>This is a v1 honest statement, not a full threat model.</span>
            </li>
          </ul>
          <div className="mt-5 border-t pt-4 text-[13px] text-muted-foreground">
            Found a security issue? Email{" "}
            <a className="font-medium text-foreground underline" href="mailto:security@openbooks.dev">
              security@openbooks.dev
            </a>{" "}
            and give us a reasonable window to fix before public disclosure.
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild className="h-10 rounded-[10px] px-4 text-[13.5px]" variant="outline">
            <a href={/* REPO-URL */ GITHUB_SELF_HOST_DOCS} rel="noreferrer" target="_blank">
              Set up your own →
            </a>
          </Button>
          <Button asChild className="h-10 rounded-[10px] px-4 text-[13.5px]" variant="ghost">
            <a
              href={/* REPO-URL */ `${GITHUB_URL}/blob/main/docs/security/security-posture.md`}
              rel="noreferrer"
              target="_blank"
            >
              Read the full posture doc
            </a>
          </Button>
        </div>
      </section>

      <footer className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-center gap-4 border-t px-4 py-8 text-[12.5px] text-muted-foreground lg:px-6">
        <span className="inline-flex items-center gap-2">
          <span className="flex size-[18px] items-center justify-center rounded-full bg-primary text-[7.5px] font-bold text-primary-foreground">
            ob
          </span>
          open books
        </span>
        <span>·</span>
        <span>MIT licensed</span>
        <span>·</span>
        <a
          className="hover:text-foreground"
          href={/* REPO-URL */ GITHUB_SELF_HOST_DOCS}
          rel="noreferrer"
          target="_blank"
        >
          Self-host docs
        </a>
        <span>·</span>
        <Link className="hover:text-foreground" href="/demo">
          Live demo
        </Link>
      </footer>
    </main>
  );
}
