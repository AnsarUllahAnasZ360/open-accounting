/* eslint-disable react/no-unescaped-entities, @next/next/no-img-element */
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Code2,
  Heart,
  Inbox,
  LineChart,
  Mail,
  PanelRight,
  UsersRound,
} from "lucide-react";

import { RequestAccessForm } from "@/components/openbooks/RequestAccessForm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const shot = (name: string) => `/prototype-assets/shots/${name}.png`;

const loopSteps = [
  {
    number: "01",
    title: "Connect your accounts",
    body: "Banks via Plaid, payments via Stripe, or a plain CSV. Every transaction syncs in on its own - up to 24 months of history.",
  },
  {
    number: "02",
    title: "AI categorizes everything",
    body: "Rules, memory of your corrections, then your own AI model - cheapest signal first. Confident calls post automatically. Uncertain ones wait in your Inbox.",
  },
  {
    number: "03",
    title: "Real statements fall out",
    body: "A true double-entry ledger underneath means the Profit & Loss, Balance Sheet and Cash Flow are correct - the kind your CPA accepts.",
  },
];

const tourTabs = [
  {
    label: "Transactions",
    image: "app-transactions",
    body: "Every account in one register. Rules, matches and high-confidence AI post automatically; the rest wait for one-click approval - with the AI's confidence shown on every line.",
  },
  {
    label: "Income",
    image: "app-income",
    body: "Payments, invoices and receivables in one place. Stripe payouts arrive as one deposit - OpenBooks splits them back into gross revenue by customer, minus fees, reconciled to the penny.",
  },
  {
    label: "Expenses",
    image: "app-expenses",
    body: "Where money goes, by category and vendor - with recurring spend detected from history and the biggest movement flagged. Anthropic usage 3x usual? It's already in your Inbox.",
  },
  {
    label: "Bills",
    image: "app-bills",
    body: "What you owe and when it's due. Amounts extracted from PDF invoices, recurring charges found automatically and offered as bills - nothing sneaks up on you.",
  },
  {
    label: "Payroll",
    image: "app-payroll",
    body: "A register, not a processor - for teams paid in USD, PKR, INR, any currency. Run, review, approve; FX differences post themselves.",
  },
];

const roadmap = [
  {
    icon: LineChart,
    title: "13-week cash forecast",
    body: "A look ahead built from your recurring bills, payroll dates and invoice due dates - so you see the dip before it happens.",
  },
  {
    icon: Heart,
    title: "Quarterly tax set-asides",
    body: "An estimated-tax line computed from real profit, with a suggested amount to move to savings each month. No April surprises.",
  },
  {
    icon: AlertTriangle,
    title: "Anomaly alerts",
    body: "Duplicate charges, silent price hikes, a vendor billing twice in a month - flagged in your Inbox before they compound.",
  },
  {
    icon: UsersRound,
    title: "Accountant seat",
    body: "A read-only login for your CPA plus a year-end pack - statements, general ledger and journal - exported in one click.",
  },
  {
    icon: Mail,
    title: "Invoice nudges",
    body: "Polite, automatic reminders for overdue invoices - drafted by the AI, sent only with your approval, escalating on your schedule.",
  },
  {
    icon: Building2,
    title: "Multi-entity consolidation",
    body: "Run several businesses from one login today; consolidated statements with inter-company eliminations are next.",
  },
];

const compareRows = [
  ["Real double-entry ledger", "yes", "yes", "yes", "yes"],
  ["Bank sync", "BYO Plaid", "yes", "yes", "no"],
  ["AI categorization + inbox", "BYO model", "yes", "yes", "no"],
  ["Stripe payout reconciliation", "yes", "partial", "yes", "no"],
  ["Open source", "AGPL", "no", "no", "AGPL"],
  ["Self-hosted, you own the data", "yes", "no", "no", "yes"],
  ["Price per month", "$0", "$38-275", "$0-200", "$0"],
];

const faqs = [
  {
    question: "Is it really free? What's the catch?",
    answer:
      "The software is free and AGPL-licensed, forever. Your only costs are the keys you bring: AI usage, typically a few dollars a month for categorization, and Plaid if you outgrow its free tier. CSV import always works without it.",
  },
  {
    question: "What do I need to run it?",
    answer:
      "A machine that runs Docker - a $5 VPS, a home server, or your laptop. One docker compose up starts the app and the database. Connect a bank or upload a CSV, paste an AI key or skip it, and the dashboard lights up in about 15 minutes.",
  },
  {
    question: "Will my accountant accept the books?",
    answer:
      "That's the design test. Underneath the plain-English UI is a strict double-entry ledger: every transaction posts balanced journal entries, posted entries are immutable, and there are General Ledger, Trial Balance and Journal exports plus a month-end close.",
  },
  {
    question: "What happens if the project dies?",
    answer:
      "Nothing happens to your books. They live in your own database, with full CSV, JSON and general-ledger export at all times. The code is AGPL-licensed in the prototype copy, so anyone can fork it and keep it alive.",
  },
];

function SectionLabel({ children, dark = false }: { children: string; dark?: boolean }) {
  return (
    <div
      className={cn(
        "text-xs font-semibold uppercase tracking-[0.06em]",
        dark ? "text-[#63b347]" : "text-[#1d6b12]",
      )}
    >
      {children}
    </div>
  );
}

function Screenshot({
  src,
  alt,
  className,
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-xl border bg-background shadow-[0_16px_36px_-16px_rgba(0,0,0,0.2)]", className)}>
      <img alt={alt} className="block h-auto w-full" src={src} />
    </div>
  );
}

function ProductCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Inbox;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-[14px] border p-5">
      <Icon className="size-5 text-[#1d6b12]" strokeWidth={1.8} />
      <div className="mt-3 text-[15px] font-semibold">{title}</div>
      <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen bg-background text-foreground">
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
            <a className="text-[13.5px] text-muted-foreground hover:text-foreground" href="#features">
              Features
            </a>
            <a className="text-[13.5px] text-muted-foreground hover:text-foreground" href="#mobile">
              Mobile
            </a>
            <a className="text-[13.5px] text-muted-foreground hover:text-foreground" href="#free">
              Why it's free
            </a>
            <a className="text-[13.5px] text-muted-foreground hover:text-foreground" href="#compare">
              Compare
            </a>
            <a className="text-[13.5px] text-muted-foreground hover:text-foreground" href="#faq">
              FAQ
            </a>
          </nav>
          <Button asChild className="h-9 rounded-[10px] px-4 text-[13.5px]">
            <Link href="/dashboard">Open the app</Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-[1080px] px-4 pb-0 pt-16 text-center lg:px-6 lg:pt-20">
        <div className="inline-flex h-7 items-center rounded-full bg-[#f1f8ee] px-3 text-[12.5px] font-medium text-[#17540f]">
          Free · open source · self-hosted
        </div>
        <h1 className="mx-auto mt-6 max-w-[680px] text-[44px] font-semibold leading-[1.06] tracking-normal md:text-[56px]">
          Your books, always done.
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          OpenBooks connects your banks and Stripe, and an AI bookkeeper running on your own model key keeps a real
          double-entry ledger - asking you only when it isn't sure.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-2 sm:flex-row">
          <Button asChild className="h-[46px] rounded-xl px-6 text-[15px]">
            <Link href="/dashboard">Try the live demo</Link>
          </Button>
          <Button asChild className="h-[46px] rounded-xl px-6 text-[15px]" variant="outline">
            <a href="https://github.com/AnsarUllahAnasZ360/open-accounting" rel="noreferrer" target="_blank">
              <Code2 className="size-4" />
              Star on GitHub
            </a>
          </Button>
        </div>
        <div className="mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[12.5px] text-muted-foreground">
          <span>
            <span className="money-figures font-semibold text-foreground">$0</span>/month, forever
          </span>
          <span>
            <span className="money-figures font-semibold text-foreground">15 min</span> to first dashboard
          </span>
          <span>
            <span className="money-figures font-semibold text-foreground">AGPL</span> licensed
          </span>
        </div>

        <div className="mx-auto mt-12 max-w-[960px] overflow-hidden rounded-t-[14px] bg-background shadow-[0_0_0_1px_rgba(10,10,10,0.09),0_24px_48px_-20px_rgba(0,0,0,0.22)]">
          <div className="flex h-9 items-center gap-1.5 border-b bg-muted/40 px-3.5">
            <span className="size-2.5 rounded-full bg-muted-foreground/25" />
            <span className="size-2.5 rounded-full bg-muted-foreground/25" />
            <span className="size-2.5 rounded-full bg-muted-foreground/25" />
            <span className="flex-1" />
            <span className="money-figures hidden h-[22px] items-center gap-1.5 rounded-md border bg-background px-3 text-[11px] text-muted-foreground sm:inline-flex">
              app.openbooks.dev
            </span>
            <span className="flex-1" />
          </div>
          <img
            alt="OpenBooks dashboard - cash position, P&L, where money went, inbox, aging and payroll at a glance"
            className="block h-auto w-full"
            src={shot("app-dashboard")}
          />
        </div>
      </section>

      <section className="border-t bg-muted/35">
        <div className="mx-auto max-w-[1080px] px-4 py-16 lg:px-6">
          <SectionLabel>The whole loop</SectionLabel>
          <h2 className="mt-2 max-w-xl text-3xl font-semibold tracking-normal">
            Money moves. The ledger posts. You answer a question now and then.
          </h2>
          <div className="mt-9 grid gap-4 md:grid-cols-3">
            {loopSteps.map((step) => (
              <div key={step.number} className="rounded-[14px] border bg-background p-6 shadow-xs">
                <div className="money-figures text-xs text-muted-foreground">{step.number}</div>
                <div className="mt-2 text-base font-semibold">{step.title}</div>
                <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-col gap-2 rounded-xl border bg-background px-4 py-3 text-[13px] md:flex-row md:items-center">
            <span className="money-figures font-semibold text-[#17540f]">"AI proposes. The ledger engine posts."</span>
            <span className="text-muted-foreground">
              - accounting correctness comes before automation. Posted entries are never edited; corrections are new,
              linked entries.
            </span>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto grid max-w-[1080px] gap-12 px-4 py-20 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:px-6">
        <div>
          <SectionLabel>The inbox</SectionLabel>
          <h2 className="mt-2 text-[28px] font-semibold tracking-normal">Five minutes, not five hours.</h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
            The only mandatory workflow in OpenBooks. The AI posts everything it's sure about; the handful of calls it
            won't make alone queue here - categories, receipt matches, transfers, payout mismatches, even its own
            questions.
          </p>
          <div className="mt-5 flex flex-col gap-2 text-[13.5px] text-[#3d3d3d]">
            <div className="flex gap-2">
              <span className="font-semibold text-[#248716]">→</span>
              <span>Confirm, change, split or exclude - one keystroke each</span>
            </div>
            <div className="flex gap-2">
              <span className="font-semibold text-[#248716]">→</span>
              <span>"Why this suggestion" shows the evidence behind every call</span>
            </div>
            <div className="flex gap-2">
              <span className="font-semibold text-[#248716]">→</span>
              <span>Every answer becomes memory - the same question never comes back</span>
            </div>
          </div>
        </div>
        <Screenshot
          alt="OpenBooks Inbox - AI suggestion with confidence, confirm, split, and exclude actions"
          src={shot("app-inbox")}
        />
      </section>

      <section className="mx-auto grid max-w-[1080px] gap-12 px-4 py-12 lg:grid-cols-[1.15fr_0.85fr] lg:items-center lg:px-6">
        <Screenshot
          alt="Ask AI panel answering questions from the ledger and proposing a rule"
          src={shot("app-askai")}
        />
        <div>
          <SectionLabel>Ask AI</SectionLabel>
          <h2 className="mt-2 text-[28px] font-semibold tracking-normal">Ask your books anything.</h2>
          <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
            A side panel that lives next to every screen. Answers come straight from the ledger - and when the AI wants
            to act, it proposes first and posts only after you say yes.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {[
              "Who owes me money right now?",
              "How did May compare to April?",
              "What did Stripe take in fees?",
              "Just handle Uber rides for me",
            ].map((chip) => (
              <span key={chip} className="inline-flex h-7 items-center rounded-full border px-3 text-[12.5px] text-muted-foreground">
                "{chip}"
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t bg-muted/35">
        <div className="mx-auto max-w-[1080px] px-4 py-16 lg:px-6">
          <SectionLabel>The tour</SectionLabel>
          <h2 className="mt-2 text-3xl font-semibold tracking-normal">Every screen money touches.</h2>
          <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">
            Two transaction concepts instead of five. About 30 categories instead of 154. No payments upsell anywhere.
          </p>
          <div className="mt-7 flex flex-wrap gap-2">
            {tourTabs.map((tab, index) => (
              <span
                key={tab.label}
                className={cn(
                  "inline-flex h-[34px] items-center rounded-full border px-4 text-[13.5px] font-medium",
                  index === 0 ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
                )}
              >
                {tab.label}
              </span>
            ))}
          </div>
          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            {tourTabs.map((tab) => (
              <div key={tab.label}>
                <Screenshot alt={`OpenBooks ${tab.label}`} src={shot(tab.image)} />
                <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
                  <span className="font-semibold text-foreground">{tab.label}.</span> {tab.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1080px] px-4 py-20 text-center lg:px-6">
        <SectionLabel>Reports</SectionLabel>
        <h2 className="mt-2 text-3xl font-semibold tracking-normal">Statements your CPA accepts.</h2>
        <p className="mx-auto mt-2 max-w-xl text-[15px] text-muted-foreground">
          Every number comes straight from the ledger. Any date range, cash or accrual, with a month-end close that
          locks the books.
        </p>
        <Screenshot
          alt="Reports - Monthly Review, statements, money owed and insights, with month-end close"
          className="mx-auto mt-9 max-w-[880px]"
          src={shot("app-reports")}
        />
        <div className="mx-auto mt-7 flex max-w-3xl flex-wrap justify-center gap-2">
          {[
            "Monthly Review",
            "Profit & Loss",
            "Balance Sheet",
            "Cash Flow Statement",
            "A/R Aging",
            "A/P Aging",
            "Expenses",
            "Income by Customer",
            "Payroll Summary",
            "Trial Balance · General Ledger · Journal exports",
          ].map((report, index) => (
            <span
              key={report}
              className={cn(
                "inline-flex h-[30px] items-center rounded-full px-3 text-[12.5px]",
                index === 0 ? "bg-[#f1f8ee] font-medium text-[#17540f]" : "border text-[#3d3d3d]",
              )}
            >
              {report}
            </span>
          ))}
        </div>
      </section>

      <section id="mobile" className="border-t bg-muted/35">
        <div className="mx-auto grid max-w-[1080px] gap-12 px-4 py-16 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-6">
          <div>
            <SectionLabel>On your phone</SectionLabel>
            <h2 className="mt-2 text-[28px] font-semibold tracking-normal">The whole business, in your pocket.</h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-muted-foreground">
              Every metric from the desktop dashboard lives on the mobile home - cash with trend, in/out by month,
              aging, cushion, top expenses and what's coming up. Clear your inbox from the couch; the AI does the
              filing.
            </p>
            <div className="mt-5 flex flex-col gap-2 text-[13.5px] text-[#3d3d3d]">
              <div className="flex gap-2">
                <span className="font-semibold text-[#248716]">→</span>
                <span>Confirm AI suggestions with one thumb</span>
              </div>
              <div className="flex gap-2">
                <span className="font-semibold text-[#248716]">→</span>
                <span>Ask AI anywhere - answers from the same ledger</span>
              </div>
              <div className="flex gap-2">
                <span className="font-semibold text-[#248716]">→</span>
                <span>A web app - nothing to install, works on any phone</span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:gap-5">
            {[
              ["mobile-home", "Home · every metric"],
              ["mobile-inbox", "Inbox · one-tap confirm"],
              ["mobile-askai", "Ask AI · on the go"],
            ].map(([image, label], index) => (
              <div key={image} className={cn("text-center", index === 1 && "pt-7")}>
                <div className="overflow-hidden rounded-[22px] border-[6px] border-[#0f0f0f] shadow-[0_16px_36px_-16px_rgba(0,0,0,0.28)]">
                  <img alt={label} className="block h-auto w-full" src={shot(image)} />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1080px] px-4 py-20 lg:px-6">
        <SectionLabel>Where it's going</SectionLabel>
        <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-normal">The ledger makes harder things possible.</h2>
        <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">
          Because every number is a balanced journal entry, these aren't guesses - they're arithmetic. On the roadmap,
          shaped by GitHub votes.
        </p>
        <div className="mt-9 grid gap-4 md:grid-cols-3">
          {roadmap.map((item) => (
            <ProductCard key={item.title} {...item} />
          ))}
        </div>
      </section>

      <section id="free" className="border-t bg-[#0f1410] text-white">
        <div className="mx-auto max-w-[1080px] px-4 py-20 lg:px-6">
          <SectionLabel dark>Why it's free</SectionLabel>
          <h2 className="mt-2 max-w-xl text-3xl font-semibold tracking-normal">
            Because you bring the keys, there's nothing to charge you for.
          </h2>
          <div className="mt-11 grid gap-12 lg:grid-cols-2">
            <div className="flex flex-col gap-5">
              {[
                [
                  "Your own Plaid, Stripe and AI keys",
                  "Intelligence costs API pennies when it runs on your model key - Anthropic, OpenAI, Google or local Ollama. No $500/month bookkeeping service in the middle.",
                ],
                [
                  "Self-hosted, one Docker command",
                  "Your books live on your machine as data you can always export. No vendor can shut down overnight and take your records with it.",
                ],
                [
                  "Open source, AGPL licensed",
                  "The ledger engine is public, auditable, and free to use anywhere - even inside your own products. No ads, no upsells, no payments funnel disguised as bookkeeping software.",
                ],
              ].map(([title, body]) => (
                <div key={title} className="flex gap-3.5">
                  <span className="money-figures mt-0.5 text-[13px] text-[#63b347]">→</span>
                  <div>
                    <div className="text-[15px] font-semibold">{title}</div>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-[#9aa59b]">{body}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-2xl border border-[#243126] bg-[#161d17] p-7">
              <div className="text-[12.5px] font-medium text-[#9aa59b]">What a year of books costs</div>
              <div className="mt-5 flex flex-col gap-3.5">
                <div className="flex justify-between gap-4 text-[13.5px] text-[#cdd5ce]">
                  <span>QuickBooks + a bookkeeper</span>
                  <span className="money-figures">$4,000-7,200</span>
                </div>
                <div className="flex justify-between gap-4 text-[13.5px] text-[#cdd5ce]">
                  <span>Zeni, Digits, Puzzle tiers</span>
                  <span className="money-figures">$1,200-6,000</span>
                </div>
                <div className="h-px bg-[#243126]" />
                <div className="flex justify-between gap-4">
                  <span className="text-sm font-semibold">OpenBooks + your API keys</span>
                  <span className="money-figures text-xl font-semibold text-[#63b347]">~$30 /yr</span>
                </div>
                <div className="text-xs text-[#9aa59b]">
                  Mostly your AI provider's usage. Plaid has free and low-cost tiers; CSV import is always free.
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="compare" className="mx-auto max-w-[1080px] px-4 py-16 lg:px-6">
        <h2 className="text-3xl font-semibold tracking-normal">Nobody else combines all five.</h2>
        <p className="mt-2 text-[15px] text-muted-foreground">
          A real ledger, bank sync, an AI inbox, open source, and self-hosting - pick any four elsewhere.
        </p>
        <div className="mt-8 overflow-hidden rounded-[14px] border">
          <div className="grid grid-cols-[1.6fr_repeat(4,1fr)] bg-muted/55 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
            <span />
            <span className="text-center text-[#17540f]">OpenBooks</span>
            <span className="text-center">QuickBooks</span>
            <span className="text-center">Puzzle / Digits</span>
            <span className="text-center">Bigcapital</span>
          </div>
          {compareRows.map((row, index) => (
            <div
              key={row[0]}
              className={cn(
                "grid grid-cols-[1.6fr_repeat(4,1fr)] border-t px-5 py-3 text-[13.5px]",
                index === compareRows.length - 1 && "bg-[#f1f8ee]",
              )}
            >
              <span className="font-medium">{row[0]}</span>
              {row.slice(1).map((cell, cellIndex) => (
                <span
                  key={`${row[0]}-${cellIndex}`}
                  className={cn("money-figures text-center text-[12.5px]", cellIndex === 0 ? "font-semibold text-[#17540f]" : "text-muted-foreground")}
                >
                  {cell}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="border-t bg-muted/35">
        <div className="mx-auto max-w-[760px] px-4 py-16 lg:px-6">
          <h2 className="mb-7 text-[26px] font-semibold tracking-normal">Honest answers</h2>
          <div className="flex flex-col gap-2.5">
            {faqs.map((faq, index) => (
              <details key={faq.question} className="rounded-xl border bg-background p-5" open={index === 0}>
                <summary className="cursor-pointer list-none text-[14.5px] font-semibold">{faq.question}</summary>
                <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1080px] gap-8 px-4 py-20 lg:grid-cols-[1fr_380px] lg:px-6">
        <div className="text-center lg:text-left">
          <h2 className="text-[34px] font-semibold tracking-normal">
            Connect your accounts. Answer a few questions a week.
          </h2>
          <p className="mt-3 text-base text-muted-foreground">Your books are always done - and they're yours.</p>
          <div className="mt-7 flex flex-col gap-2 sm:flex-row lg:justify-start">
            <Button asChild className="h-[46px] rounded-xl px-6 text-[15px]">
              <Link href="/dashboard">
                Try the live demo
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild className="h-[46px] rounded-xl px-6 text-[15px]" variant="outline">
              <a href="#mobile">
                See it on mobile
                <PanelRight className="size-4" />
              </a>
            </Button>
          </div>
        </div>
        <RequestAccessForm />
      </section>

      <footer className="mx-auto flex max-w-[1080px] flex-wrap items-center justify-center gap-4 border-t px-4 py-8 text-[12.5px] text-muted-foreground lg:px-6">
        <span className="inline-flex items-center gap-2">
          <span className="flex size-[18px] items-center justify-center rounded-full bg-primary text-[7.5px] font-bold text-primary-foreground">
            ob
          </span>
          open books
        </span>
        <span>·</span>
        <span>AGPL licensed</span>
        <span>·</span>
        <a className="hover:text-foreground" href="https://github.com/AnsarUllahAnasZ360/open-accounting" rel="noreferrer" target="_blank">
          GitHub
        </a>
        <span>·</span>
        <span>No tracking, no account required</span>
      </footer>
    </main>
  );
}
