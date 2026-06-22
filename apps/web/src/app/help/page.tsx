import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  BookOpen,
  Bot,
  Building2,
  Check,
  Inbox,
  KeyRound,
  Layers,
  ListChecks,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";

// E15-T3: in-app conceptual Help Center for non-accountant owners. Plain English
// only — no debits/credits on the surface (the one place "double-entry" appears,
// it is defined inline). Sourced + condensed from docs/finishing/how-openbooks-works.md
// and the vision doc. Design-system compliant: white surfaces, Geist, lucide,
// single brand green (#1d6b12 / primary), no gradients/emoji/purple AI styling,
// mirroring the /setup and /security marketing pages.

const BRAND = "#1d6b12";

export const metadata: Metadata = {
  title: "How OpenBooks works — the owner's guide",
  description:
    "A plain-English guide to OpenBooks for business owners: how the AI proposes and the ledger posts, what double-entry buys you, how money flows through the Inbox, what each screen does, the portfolio view across your businesses, and bring-your-own-keys.",
};

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
          <Link className="text-[13.5px] font-medium text-foreground" href="/help">
            Guide
          </Link>
          <Link className="text-[13.5px] text-muted-foreground hover:text-foreground" href="/setup">
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

type Section = {
  id: string;
  label: string;
};

const NAV: Section[] = [
  { id: "ai-proposes", label: "AI proposes, the books post" },
  { id: "double-entry", label: "Why the books always add up" },
  { id: "money-lifecycle", label: "How money flows in" },
  { id: "autonomy", label: "How much you let the AI do" },
  { id: "screens", label: "What each screen does" },
  { id: "portfolio", label: "Running more than one business" },
  { id: "byo-keys", label: "Your keys, your data" },
  { id: "faq", label: "Owner FAQ" },
];

function SectionHeading({ id, eyebrow, title }: { id: string; eyebrow: string; title: string }) {
  return (
    <div id={id} className="scroll-mt-24">
      <div className="text-xs font-semibold uppercase tracking-[0.06em]" style={{ color: BRAND }}>
        {eyebrow}
      </div>
      <h2 className="mt-2 text-[24px] font-semibold leading-tight tracking-normal md:text-[28px]">
        {title}
      </h2>
    </div>
  );
}

const screens: { icon: typeof BookOpen; name: string; body: string }[] = [
  {
    icon: Layers,
    name: "Dashboard",
    body: "Your business at a glance: cash on hand, profit so far, who owes you and who you owe, where the money went, and the few Inbox items that need you. Every number clicks through to the transactions behind it.",
  },
  {
    icon: ListChecks,
    name: "Transactions",
    body: "The full list of money in and out. Search, filter, split one charge into parts, or change a category. Changing history never erases anything — the old entry is reversed and a corrected one is added, so your audit trail stays clean.",
  },
  {
    icon: Banknote,
    name: "Income",
    body: "Money coming in: payments received, the invoices you've sent, and who still owes you, sorted by how overdue they are.",
  },
  {
    icon: Banknote,
    name: "Expenses",
    body: "Where money goes, grouped by category and vendor, with the change from last month and the subscriptions you pay on repeat.",
  },
  {
    icon: Inbox,
    name: "Bills",
    body: "Money you owe. Add a bill by hand or drop in a receipt photo or PDF; mark it paid when the money leaves your account.",
  },
  {
    icon: Building2,
    name: "Contacts",
    body: "Your customers and vendors — created automatically as money moves — each with their full history and balance.",
  },
  {
    icon: ListChecks,
    name: "Payroll",
    body: "Pay your team in any currency. Open a run, set the amounts, approve it (which records the cost), and mark it paid. You get a printable statement. OpenBooks tracks pay; it does not file taxes or move the money for you.",
  },
  {
    icon: BookOpen,
    name: "Reports",
    body: "Plain-English reports for any date range: a one-page Monthly Review, Profit & Loss, what you're owed and what you owe, cash flow, and the formal statements your accountant expects. Export any of them; the file matches the screen.",
  },
  {
    icon: Bot,
    name: "Ask AI",
    body: "Ask your books a question in plain words — \"How did last month compare?\", \"Who owes me money?\" — and get an answer drawn from the same records the reports use. If you ask it to do something, it shows a card and waits for your OK first.",
  },
  {
    icon: KeyRound,
    name: "Settings",
    body: "Your businesses, your keys and connections, the AI provider and how much freedom it has, your categories and rules, your team, and a full export of your data whenever you want it.",
  },
];

const faqs: { q: string; a: string }[] = [
  {
    q: "Is my financial data private?",
    a: "Yes. OpenBooks runs on your own deployment with your own database. The keys you connect — bank, payments, AI — are encrypted before they are stored and are never shown back to you or sent to anyone else. There are no ads and no tracking funnel.",
  },
  {
    q: "What happens if the project stops being maintained?",
    a: "Your books are a file you own. You can export everything (a spreadsheet, a data file, or an accountant-grade ledger export) at any time. Because OpenBooks is open-source under the permissive MIT license, anyone — including you — is free to keep running it. There is no company that can switch it off and take your data with it.",
  },
  {
    q: "Will my accountant accept these books?",
    a: "That's the whole point of keeping real double-entry books underneath the plain-English surface. You can hand your accountant the General Ledger, Trial Balance, and Journal exports they already know how to read.",
  },
  {
    q: "Do I still need an accountant?",
    a: "OpenBooks keeps your day-to-day books correct and ready. Many owners still want an accountant for taxes and year-end advice — OpenBooks gives that accountant clean, exportable books to work from instead of a shoebox of receipts.",
  },
  {
    q: "What if the AI gets a category wrong?",
    a: "Correct it once, and OpenBooks remembers — the next similar charge follows your correction, and after a few identical fixes it offers to make a rule for you. Nothing is ever stuck: every change can be undone, because corrections are added as new entries rather than edits.",
  },
  {
    q: "Can I use OpenBooks without connecting a bank?",
    a: "Yes. If you don't want to connect a bank through Plaid, you can import a CSV or OFX file from your bank instead — it runs through the exact same pipeline.",
  },
];

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <MarketingHeader />

      <section className="mx-auto max-w-[820px] px-4 pb-6 pt-12 lg:px-6 lg:pt-16">
        <Link
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          href="/"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.8} />
          Back to home
        </Link>
        <div className="mt-6 text-xs font-semibold uppercase tracking-[0.06em]" style={{ color: BRAND }}>
          The owner&rsquo;s guide
        </div>
        <h1 className="mt-2 text-[34px] font-semibold leading-[1.1] tracking-normal md:text-[42px]">
          How OpenBooks works, in plain English.
        </h1>
        <p className="mt-4 max-w-[640px] text-[15px] leading-relaxed text-muted-foreground">
          You don&rsquo;t need to be an accountant to keep accountant-grade books. This guide explains how
          OpenBooks thinks, what it does on its own, and the small amount it needs from you — without
          any bookkeeping jargon on the surface.
        </p>
      </section>

      {/* On-page nav */}
      <section className="mx-auto max-w-[820px] px-4 pb-4 lg:px-6">
        <nav aria-label="On this page" className="rounded-[14px] border bg-muted/30 p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
            On this page
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {NAV.map((s) => (
              <li key={s.id}>
                <a
                  className="inline-flex items-center gap-1.5 text-[13.5px] text-muted-foreground hover:text-foreground"
                  href={`#${s.id}`}
                >
                  <span className="size-1 rounded-full" style={{ backgroundColor: BRAND }} />
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </section>

      <div className="mx-auto flex max-w-[820px] flex-col gap-14 px-4 pb-16 pt-8 lg:px-6">
        {/* AI proposes */}
        <section className="flex flex-col gap-4">
          <SectionHeading
            id="ai-proposes"
            eyebrow="The one rule"
            title="AI proposes. The books post."
          />
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            The AI reads each transaction and suggests where it belongs — but it never writes the
            final record by itself. A separate, careful accounting engine is the only thing that
            actually posts to your books, and it refuses to post anything that doesn&rsquo;t balance. The
            AI is the smart assistant; the engine is the careful bookkeeper that signs off. That
            split is why an AI mistake can never quietly corrupt your numbers: at worst it suggests
            the wrong category, you fix it in one click, and the engine re-posts it correctly.
          </p>
        </section>

        {/* Double entry */}
        <section className="flex flex-col gap-4">
          <SectionHeading
            id="double-entry"
            eyebrow="Why the totals always reconcile"
            title="Your books always add up — and you never have to think about why."
          />
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Under the surface, OpenBooks keeps <strong className="font-medium text-foreground">double-entry
            books</strong> — an accounting method where every transaction is recorded in two places
            at once (where the money came from and where it went) so the two sides must always match.
            It is the same method every serious accounting system uses, and it&rsquo;s why your Profit &
            Loss, Balance Sheet, and Cash Flow always agree with each other instead of drifting
            apart.
          </p>
          <div className="rounded-[14px] border p-5" style={{ backgroundColor: "#f6faf4" }}>
            <p className="text-[14px] leading-relaxed text-foreground">
              <strong className="font-semibold">You will never see the words &ldquo;debit&rdquo; or
              &ldquo;credit&rdquo;</strong> while running your business. You see income, expenses, and
              categories. The double-entry machinery runs entirely out of sight — unless you (or your
              accountant) deliberately open the optional accountant view to inspect it.
            </p>
          </div>
        </section>

        {/* Money lifecycle */}
        <section className="flex flex-col gap-4">
          <SectionHeading
            id="money-lifecycle"
            eyebrow="What happens without you"
            title="How money flows in — and where the Inbox fits."
          />
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Every transaction that arrives — from a connected bank, from Stripe, or from a file you
            import — runs through a quick set of checks, cheapest and most certain first:
          </p>
          <ol className="flex flex-col gap-3">
            {[
              ["Is it a transfer?", "Money moving between your own accounts isn't income or an expense — it's recognized as a transfer and left out of your profit."],
              ["Does it match something you're expecting?", "An invoice you sent, a bill you entered, a payroll payment, or an expected payout gets linked to it automatically."],
              ["Does one of your rules claim it?", "If you've told OpenBooks \"anything from this vendor is software,\" it follows that."],
              ["Has it seen this before?", "OpenBooks remembers every correction you've made and applies what it learned."],
              ["Otherwise, the AI categorizes it", "with a confidence score and a short reason you can read."],
            ].map(([title, body], i) => (
              <li key={title} className="flex items-start gap-3.5 rounded-[12px] border bg-background p-4">
                <span
                  className="money-figures mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                  style={{ backgroundColor: "#f1f8ee", color: BRAND }}
                >
                  {i + 1}
                </span>
                <div>
                  <div className="text-[14.5px] font-medium">{title}</div>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            When OpenBooks is confident, the item posts to your books on its own. When it isn&rsquo;t, the
            item lands in your <strong className="font-medium text-foreground">Inbox</strong> — the
            only part of OpenBooks that genuinely needs you. Most weeks that&rsquo;s a handful of cards:
            confirm a category, correct one (which teaches it), match a receipt, or approve a
            transfer. Inbox empty means your books are done.
          </p>
        </section>

        {/* Autonomy */}
        <section className="flex flex-col gap-4">
          <SectionHeading
            id="autonomy"
            eyebrow="You set the dial"
            title="How much you let the AI do on its own."
          />
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            You choose how confident the AI has to be before it posts something without asking. You
            can change this any time in Settings.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Suggest", "The AI never posts on its own. Everything it categorizes waits for your one-click confirm. Maximum control."],
              ["Balanced", "The AI posts when it's highly confident and sends only the genuinely uncertain items to your Inbox. The recommended setting for most owners."],
              ["Autopilot", "The AI posts more freely and reserves your Inbox for the trickiest items. The most hands-off setting."],
            ].map(([title, body]) => (
              <div key={title} className="flex flex-col rounded-[12px] border bg-background p-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-4" strokeWidth={1.8} style={{ color: BRAND }} />
                  <span className="text-[14.5px] font-semibold">{title}</span>
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            Whatever you choose, every posted item is labeled with how it got there (&ldquo;Categorized
            by AI &middot; 96%&rdquo;), and nothing is ever permanent — any item can be corrected, and
            the books re-post cleanly.
          </p>
        </section>

        {/* Screens */}
        <section className="flex flex-col gap-4">
          <SectionHeading
            id="screens"
            eyebrow="A quick tour"
            title="What each screen does."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            {screens.map((s) => (
              <div key={s.name} className="flex flex-col rounded-[12px] border bg-background p-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-[9px] bg-[#f1f8ee]">
                    <s.icon className="size-[16px]" strokeWidth={1.8} style={{ color: BRAND }} />
                  </span>
                  <span className="text-[14.5px] font-semibold">{s.name}</span>
                </div>
                <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Portfolio */}
        <section className="flex flex-col gap-4">
          <SectionHeading
            id="portfolio"
            eyebrow="More than one business"
            title="Running a portfolio of businesses."
          />
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            If you run more than one company, OpenBooks gives you two ways to look at your money, and
            you can switch between them instantly.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col rounded-[12px] border bg-background p-5">
              <div className="flex items-center gap-2.5">
                <Building2 className="size-[18px]" strokeWidth={1.8} style={{ color: BRAND }} />
                <span className="text-[15px] font-semibold">One business at a time</span>
              </div>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
                Each company keeps its own complete, legally-separate books. If you move money from
                one of your businesses to another, OpenBooks shows it as a{" "}
                <strong className="font-medium text-foreground">transfer between your businesses</strong>{" "}
                — never as income or an expense — so neither company&rsquo;s profit is overstated.
              </p>
            </div>
            <div className="flex flex-col rounded-[12px] border bg-background p-5">
              <div className="flex items-center gap-2.5">
                <Layers className="size-[18px]" strokeWidth={1.8} style={{ color: BRAND }} />
                <span className="text-[15px] font-semibold">All businesses together</span>
              </div>
              <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted-foreground">
                The portfolio view rolls every business into one combined picture and{" "}
                <strong className="font-medium text-foreground">cancels out the money you moved
                between them</strong>, so you see the true total — what you actually earned and spent
                across everything, with no double-counting.
              </p>
            </div>
          </div>
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            Underneath, each company stays its own separate legal entity with its own books — which is
            exactly what your accountant and the tax authorities expect. The portfolio view is a lens
            on top of those separate books, not a merge.
          </p>
        </section>

        {/* BYO keys */}
        <section className="flex flex-col gap-4">
          <SectionHeading
            id="byo-keys"
            eyebrow="You own the connections"
            title="Your keys, your data."
          />
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            OpenBooks is <strong className="font-medium text-foreground">bring-your-own-keys</strong>:
            you connect your own AI provider, your own bank link, and your own payments account. You
            are never billed by OpenBooks for any of it — your only costs are your own usage of those
            services (often just a few dollars a month).
          </p>
          <div className="flex items-start gap-3 rounded-[12px] border p-5" style={{ backgroundColor: "#f6faf4" }}>
            <ShieldCheck className="mt-0.5 size-5 shrink-0" strokeWidth={1.8} style={{ color: BRAND }} />
            <p className="text-[14px] leading-relaxed text-foreground">
              Every key you connect is <strong className="font-semibold">encrypted before it is
              stored</strong> and is <strong className="font-semibold">never shown back to you</strong>{" "}
              — the app only ever displays a masked hint like the last four characters so you can tell
              which key is which. For the full technical posture, see the{" "}
              <Link className="font-medium underline underline-offset-2" href="/security">
                security page
              </Link>
              .
            </p>
          </div>
        </section>

        {/* FAQ */}
        <section className="flex flex-col gap-4">
          <SectionHeading id="faq" eyebrow="Common questions" title="Owner FAQ." />
          <div className="flex flex-col gap-3">
            {faqs.map((f) => (
              <div key={f.q} className="rounded-[12px] border bg-background p-5">
                <div className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-[18px] shrink-0" strokeWidth={2} style={{ color: BRAND }} />
                  <div>
                    <h3 className="text-[15px] font-semibold">{f.q}</h3>
                    <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{f.a}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="rounded-[16px] border bg-muted/35 p-6 sm:p-8">
          <h2 className="text-[19px] font-semibold">See it with real data — no login.</h2>
          <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-muted-foreground">
            The fastest way to understand OpenBooks is to open the live demo: a fully seeded set of
            books you can click through end-to-end. Nothing you do there is saved, and it resets
            daily.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button asChild className="h-10 rounded-[10px] px-4 text-[13.5px]">
              <Link href="/demo">Try the live demo</Link>
            </Button>
            <Button asChild className="h-10 rounded-[10px] px-4 text-[13.5px]" variant="outline">
              <Link href="/setup">Set up your own</Link>
            </Button>
          </div>
        </section>
      </div>

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
        <Link className="hover:text-foreground" href="/setup">
          Set up
        </Link>
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
