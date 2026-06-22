"use client";

import { useQuery } from "convex/react";
import { ArrowRight, Lock } from "lucide-react";
import Link from "next/link";
import type React from "react";

import { api } from "../../../../../convex/_generated/api";
import { Amount } from "@/components/openbooks/primitives";
import { Button } from "@/components/ui/button";

/**
 * Public, no-login demo (Epic E4-T10 / E11-T5). Renders the single shared,
 * server-slug-resolved public demo workspace READ-ONLY for truly unauthenticated
 * visitors (no anonymous Convex Auth identity is minted — the workspace is
 * resolved on the server via the demo registry). It shows a persistent
 * read-only banner, ledger-derived dashboard headlines, the recent register, and
 * a "Clone this to your own account" CTA. There is no mutation here — nothing on
 * this page can change any workspace. The demo backend + daily reset cron are
 * owned by E11 (`publicDemo.ts` + `crons.ts`).
 */
export function DemoScreen() {
  const demo = useQuery(api.demo.demoView, { limit: 50 });
  const dashboard = useQuery(api.demo.demoDashboard, {});

  if (demo === undefined) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading the OpenBooks demo…
      </main>
    );
  }

  if (!demo.available) {
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground"
        data-testid="demo-unavailable"
      >
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-xs">
          <h1 className="text-xl font-semibold">The demo isn&apos;t ready yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The public demo workspace hasn&apos;t been provisioned. You can still create your own free
            books in a couple of minutes.
          </p>
          <Button asChild className="mt-5 w-full" data-testid="demo-clone-cta">
            <Link href="/sign-in?demo=1">
              Create your own account
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </main>
    );
  }

  const currency = demo.entity.currency ?? "USD";

  const summary = dashboard && dashboard.available ? dashboard.summary : null;

  return (
    <main className="min-h-screen bg-background text-foreground" data-testid="demo-screen">
      {/* Persistent read-only banner (E11-T5). Always visible while browsing the
          demo so the visitor knows nothing they do here persists. */}
      <div
        className="flex items-center justify-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-2 text-center text-[13px] font-medium text-primary"
        data-testid="demo-readonly-banner"
        role="status"
      >
        <Lock className="size-3.5" />
        You&apos;re viewing a live demo — read only. Sign in to make changes in your own books.
      </div>
      <div className="mx-auto w-full max-w-[1000px] px-4 py-6 lg:px-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              ob
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{demo.entity.name}</span>
                <span
                  className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
                  data-testid="demo-indicator"
                >
                  Demo · read-only
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                A populated example so you can see OpenBooks before you sign up. Nothing here can be edited.
              </div>
            </div>
          </div>
          <Button asChild data-testid="demo-clone-cta">
            <Link href="/sign-in?demo=1">
              Clone this to your own account
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </header>

        {summary ? (
          <section
            className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4"
            data-testid="demo-dashboard"
          >
            <DemoStat label="Money in" value={<Amount amountMinor={summary.moneyInMinor} currency={currency} />} />
            <DemoStat label="Money out" value={<Amount amountMinor={summary.moneyOutMinor} currency={currency} />} />
            <DemoStat label="Net" value={<Amount amountMinor={summary.netMinor} currency={currency} signed />} />
            <DemoStat label="Needs review" value={String(summary.openInboxCount)} />
          </section>
        ) : null}

        <section className="mt-6 rounded-lg border bg-card shadow-xs" data-testid="demo-transactions">
          <div className="border-b px-4 py-3 text-sm font-medium">
            Recent transactions
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {demo.transactionCount} shown
            </span>
          </div>
          {demo.transactions.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No transactions in the demo yet.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 font-medium">Merchant</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {demo.transactions.map((txn) => (
                  <tr key={txn.id} className="border-b last:border-b-0" data-testid="demo-transaction-row">
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">{txn.date}</td>
                    <td className="px-4 py-2">{txn.merchant}</td>
                    <td className="px-4 py-2 text-muted-foreground">{txn.category ?? txn.contact ?? "—"}</td>
                    <td className="px-4 py-2 text-right">
                      <Amount amountMinor={txn.amountMinor} currency={currency} signed />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <footer className="mt-6 flex flex-col items-center gap-3 rounded-lg border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Like what you see? Start your own free, AI-assisted books — your data, your file.
          </p>
          <Button asChild>
            <Link href="/sign-in?demo=1">
              Clone this to your own account
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </footer>
      </div>
    </main>
  );
}

function DemoStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}
