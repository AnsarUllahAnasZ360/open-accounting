import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  GitFork,
  KeyRound,
  Link2,
  PlayCircle,
  Scale,
  Terminal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  GITHUB_REPO,
  GITHUB_SELF_HOST_DOCS,
  GITHUB_SELF_HOST_SKILL,
} from "@/lib/openbooks/brand-links";

import { SetupEndpoints } from "./SetupEndpoints";

// E13-T7: public/owner-facing setup guide. Puts the irreducible manual steps and
// the exact copyable redirect/webhook URLs in front of the owner inside the
// product, so they don't hunt through docs. Design-system compliant: white
// surfaces, Geist, lucide, single brand green, no gradients/emoji/purple. The
// "Deploy your own" path is the fork + `pnpm setup` quickstart (the agent-skill
// path); a one-click Vercel button is deferred (decisions.md Q70).

// E15-T2: GitHub links target the renamed `openbooks` repo (Q80) via the shared
// brand-links constants so every public surface stays consistent.
const DOCS_SELF_HOST = GITHUB_SELF_HOST_DOCS;
const SKILL = GITHUB_SELF_HOST_SKILL;

export const metadata: Metadata = {
  title: "Set up OpenBooks — self-host & connect",
  description:
    "Run your own OpenBooks: fork and deploy, set your keys in Settings, register the redirect and webhook URLs, set opening balances, and run the first AI review.",
};

type Step = {
  icon: typeof Terminal;
  title: string;
  body: string;
  code?: string;
};

const steps: Step[] = [
  {
    icon: GitFork,
    title: "Clone & deploy your own",
    body: "Fork the repo, install, and bootstrap. `pnpm setup` mints your auth keypair and encryption key and writes .env.local; `npx convex dev --once` links your own Convex deployment. The openbooks-self-host skill walks an AI agent through the whole flow, pausing before any account-touching or production step.",
    code: `gh repo fork <owner>/${GITHUB_REPO} --clone\npnpm install\npnpm setup\nnpx convex dev --once\npnpm dev:full`,
  },
  {
    icon: KeyRound,
    title: "Set your keys in Settings → Connections",
    body: "OpenBooks is bring-your-own-keys. Paste your AI provider key (required), and optionally your Plaid and Stripe keys. Sandbox or live keys both work — live connectors are supported; they just need a stable HTTPS origin. Every key is encrypted at rest before it touches the database.",
  },
  {
    icon: Link2,
    title: "Register the redirect & webhook URLs",
    body: "Copy the endpoints below into your Plaid and Stripe dashboards. Registering the Stripe webhook is REQUIRED for a live Stripe connection — a connection does not report \"listening\" until the webhook is verified, so capture its whsec_… signing secret when you create it.",
  },
  {
    icon: Scale,
    title: "Set your opening balances",
    body: "Enter each account's starting balance so the books begin in balance (equity is no longer zero). This posts an opening journal entry through the same ledger every other entry uses.",
  },
  {
    icon: PlayCircle,
    title: "Run the first AI review",
    body: "Let the AI bookkeeper categorize your imported activity. Confident items post automatically (at your chosen autonomy level); anything uncertain lands in the Inbox for a one-click confirm.",
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
          <Link className="text-[13.5px] font-medium text-foreground" href="/setup">
            Set up
          </Link>
          <Link className="text-[13.5px] text-muted-foreground hover:text-foreground" href="/security">
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

export default function SetupPage() {
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
          Self-host / Run your own
        </div>
        <h1 className="mt-2 text-[34px] font-semibold leading-[1.1] tracking-normal md:text-[40px]">
          Set up OpenBooks in about 20 minutes.
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
          OpenBooks is free, open-source, and self-hosted: your bank tokens and API keys live in
          your own deployment, encrypted at rest. Most of the install is two commands — the steps
          below are the handful that genuinely need you.
        </p>
      </section>

      <section className="mx-auto max-w-[760px] px-4 pb-10 lg:px-6">
        <ol className="flex flex-col gap-4">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-[14px] border bg-background p-5 sm:p-6">
              <div className="flex items-start gap-3.5">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#f1f8ee]">
                  <step.icon className="size-[18px] text-[#1d6b12]" strokeWidth={1.8} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="money-figures text-xs text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h2 className="text-[16px] font-semibold leading-snug">{step.title}</h2>
                  </div>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{step.body}</p>
                  {step.code ? (
                    <pre className="money-figures mt-3 overflow-x-auto rounded-[8px] border bg-muted/40 px-3 py-2.5 text-[11.5px] leading-relaxed text-foreground">
                      <code>{step.code}</code>
                    </pre>
                  ) : null}
                  {index === 2 ? (
                    <div className="mt-4 rounded-[10px] border bg-muted/25 p-3.5">
                      <SetupEndpoints />
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-[760px] px-4 pb-16 lg:px-6">
        <div className="rounded-[14px] border bg-muted/35 p-5 sm:p-6">
          <h2 className="text-[15px] font-semibold">Deploy your own</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">
            The fastest path is the fork + <span className="font-mono text-foreground">pnpm setup</span>{" "}
            quickstart, optionally driven end-to-end by the openbooks-self-host agent skill. It
            orchestrates the commands and pauses for your confirmation before any production deploy —
            it never auto-provisions accounts on your behalf.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild className="h-10 rounded-[10px] px-4 text-[13.5px]" variant="outline">
              <a href={DOCS_SELF_HOST} rel="noreferrer" target="_blank">
                Self-host docs →
              </a>
            </Button>
            <Button asChild className="h-10 rounded-[10px] px-4 text-[13.5px]" variant="ghost">
              <a href={SKILL} rel="noreferrer" target="_blank">
                The setup skill
              </a>
            </Button>
            <Button asChild className="h-10 rounded-[10px] px-4 text-[13.5px]" variant="ghost">
              <Link href="/security">How your keys are protected</Link>
            </Button>
          </div>
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
        <a className="hover:text-foreground" href={DOCS_SELF_HOST} rel="noreferrer" target="_blank">
          Self-host docs
        </a>
        <span>·</span>
        <Link className="hover:text-foreground" href="/security">
          Security
        </Link>
        <span>·</span>
        <Link className="hover:text-foreground" href="/demo">
          Live demo
        </Link>
      </footer>
    </main>
  );
}
