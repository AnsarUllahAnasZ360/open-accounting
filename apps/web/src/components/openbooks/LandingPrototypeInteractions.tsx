"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

const shot = (name: string) => `/prototype-assets/shots/${name}.png`;

const tourTabs = [
  {
    id: "transactions",
    label: "Transactions",
    image: "app-transactions",
    alt: "Transactions — every account in one register with AI categories and approval queue",
    body: "Every account in one register. Rules, matches and high-confidence AI post automatically; the rest wait for one-click approval — with the AI's confidence shown on every line.",
  },
  {
    id: "income",
    label: "Income",
    image: "app-income",
    alt: "Income — payments, invoices and receivables with Stripe payouts reconciled",
    body: "Payments, invoices and receivables in one place. Stripe payouts arrive as one deposit — OpenBooks splits them back into gross revenue by customer, minus fees, reconciled to the penny.",
  },
  {
    id: "expenses",
    label: "Expenses",
    image: "app-expenses",
    alt: "Expenses — spend by category with share bars, recurring spend detection and biggest movement",
    body: "Where money goes, by category and vendor — with recurring spend detected from history and the biggest movement flagged. Anthropic usage 3× usual? It's already in your Inbox.",
  },
  {
    id: "bills",
    label: "Bills",
    image: "app-bills",
    alt: "Bills — what you owe and when it's due, with amounts extracted from PDF invoices",
    body: "What you owe and when it's due. Amounts extracted from PDF invoices, recurring charges found automatically and offered as bills — nothing sneaks up on you.",
  },
  {
    id: "payroll",
    label: "Payroll",
    image: "app-payroll",
    alt: "Payroll — a multi-currency register with runs by month and per-currency totals",
    body: "A register, not a processor — for teams paid in USD, PKR, INR, any currency. Run, review, approve; FX differences post themselves.",
  },
] as const;

const faqs = [
  {
    question: "Is it really free? What's the catch?",
    answer:
      "The software is free and MIT-licensed, forever. Your only costs are the keys you bring: AI usage (typically a few dollars a month for categorization) and Plaid if you outgrow its free tier — CSV import always works without it. There's no hosted tier to upsell you to yet, and the anti-scope list in the README rules out ads and payment-processing funnels permanently.",
  },
  {
    question: "What do I need to run it?",
    answer:
      "Node and pnpm, plus a free Convex deployment for the backend (Convex runs in the cloud, never on localhost). Clone the repo, run `pnpm setup` and `npx convex dev --once` to link your own deployment, then `pnpm dev:full` — or deploy the front end to Vercel. There is no Docker step. Connect a bank or upload a CSV, paste your AI key (or skip it — rules and manual categorization still work), and the dashboard lights up in about 15 minutes. The /setup page walks through it.",
  },
  {
    question: "Will my accountant accept the books?",
    answer:
      "That's the design test. Underneath the plain-English UI is a strict double-entry ledger: every transaction posts balanced journal entries, posted entries are immutable, and there are General Ledger, Trial Balance and Journal exports plus a month-end close. Your CPA gets accountant-grade records, not a spreadsheet export.",
  },
  {
    question: "What happens if the project dies?",
    answer:
      "Nothing happens to your books. They live in your own database, with full CSV, JSON and general-ledger export at all times — that's a hard product principle, learned from watching hosted bookkeeping services shut down overnight. The code is MIT-licensed, so anyone is free to fork it, self-host it, and keep running it on their own terms.",
  },
] as const;

function PrototypeScreenshot({
  src,
  alt,
}: {
  src: string;
  alt: string;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-[0_16px_36px_-16px_rgba(0,0,0,0.18)]">
      <img alt={alt} className="block h-auto w-full" src={src} />
    </div>
  );
}

export function LandingPrototypeTour() {
  const [active, setActive] = useState<(typeof tourTabs)[number]["id"]>("transactions");
  const selected = tourTabs.find((tab) => tab.id === active) ?? tourTabs[0];

  return (
    <>
      <div className="mt-7 flex flex-wrap gap-2">
        {tourTabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <button
              key={tab.id}
              className={cn(
                "inline-flex h-[34px] items-center rounded-full border px-4 text-[13.5px] font-medium transition active:translate-y-px",
                isActive
                  ? "border-primary bg-primary text-primary-foreground hover:bg-[#248716]"
                  : "border-border bg-background text-muted-foreground hover:bg-muted",
              )}
              onClick={() => setActive(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div className="mt-5">
        <PrototypeScreenshot alt={selected.alt} src={shot(selected.image)} />
        <p className="mt-4 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">{selected.label}.</span> {selected.body}
        </p>
      </div>
    </>
  );
}

export function LandingPrototypeFaq() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="flex flex-col gap-2.5">
      {faqs.map((faq, index) => {
        const isOpen = openIndex === index;
        return (
          <div key={faq.question} className="overflow-hidden rounded-xl border bg-background">
            <button
              className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-5 py-4 text-left text-[14.5px] font-semibold text-foreground"
              onClick={() => setOpenIndex(isOpen ? -1 : index)}
              type="button"
            >
              <span className="flex-1">{faq.question}</span>
              <ChevronDown className={cn("size-3.5 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
            </button>
            {isOpen ? <div className="px-5 pb-4 text-[13.5px] leading-relaxed text-muted-foreground">{faq.answer}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
