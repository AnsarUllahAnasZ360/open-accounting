"use client";
import Link from "next/link";

import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, FileUp, Plus } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { PlaidConnectionPanel } from "@/components/openbooks/PlaidConnectionPanel";
import { StripeConnectionPanel } from "@/components/openbooks/StripeConnectionPanel";
import { Button } from "@/components/ui/button";

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[12px] font-semibold uppercase tracking-[0.04em] text-muted-foreground/80">{children}</div>
  );
}

/**
 * Connections (Epic E3): banks via Plaid, Stripe, and CSV/OFX import — each
 * framed per the prototype. Sandbox connections attach to a dedicated "Live
 * Sandbox" business so test data never pollutes the demo books; the section
 * offers to create it when absent. The existing Plaid/Stripe panels carry the
 * real sandbox/fixture wiring (key state shown by name only, never values).
 */
export function ConnectionsSection() {
  const target = useQuery(api.moduleViews.connectionsTarget, {});
  const ensureLiveSandbox = useMutation(api.ledger.ensureLiveSandboxEntity);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const sandboxEntityId = (target?.liveSandboxEntityId ?? null) as Id<"entities"> | null;

  async function createLiveSandbox() {
    setBusy(true);
    setMessage("");
    try {
      const result = await ensureLiveSandbox({});
      setMessage(
        result.created
          ? `Live Sandbox created with ${result.accountsCreated} chart accounts.`
          : `Live Sandbox refreshed; ${result.accountsCreated} accounts checked.`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not create the Live Sandbox.");
    } finally {
      setBusy(false);
    }
  }

  if (target === undefined) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Loading connections…</div>;
  }

  if (!sandboxEntityId) {
    return (
      <div className="flex flex-col gap-3" data-testid="connections-section">
        <div className="rounded-[14px] border border-dashed bg-card p-5 shadow-xs">
          <div className="text-[13.5px] font-semibold">Connect sandbox services</div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Sandbox banks (Plaid) and Stripe test mode attach to a dedicated Live Sandbox business so they never touch
            your demo books. Create it to start connecting.
          </p>
          <Button className="mt-3" size="sm" data-testid="live-sandbox-create" disabled={busy} onClick={createLiveSandbox}>
            <Plus className="size-4" /> {busy ? "Creating…" : "Create Live Sandbox"}
          </Button>
          {message ? (
            <div className="mt-3 flex items-start gap-2 rounded-[10px] bg-primary/5 p-3 text-sm text-primary" data-testid="live-sandbox-message">
              <CheckCircle2 className="mt-0.5 size-4" />
              <span>{message}</span>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="connections-section">
      {message ? (
        <div className="flex items-start gap-2 rounded-[10px] bg-primary/5 p-3 text-sm text-primary" data-testid="live-sandbox-message">
          <CheckCircle2 className="mt-0.5 size-4" />
          <span>{message}</span>
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <SectionEyebrow>Banks · via your Plaid keys</SectionEyebrow>
        <Button size="sm" variant="ghost" data-testid="live-sandbox-create" disabled={busy} onClick={createLiveSandbox}>
          Refresh Live Sandbox
        </Button>
      </div>
      <PlaidConnectionPanel entityId={sandboxEntityId} />

      <SectionEyebrow>Stripe · restricted keys</SectionEyebrow>
      <StripeConnectionPanel entityId={sandboxEntityId} />

      <SectionEyebrow>Import · CSV / OFX</SectionEyebrow>
      <div className="flex flex-col gap-3 rounded-[14px] border bg-card p-5 shadow-xs" data-testid="connections-import">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex size-[34px] items-center justify-center rounded-[10px] bg-muted">
            <FileUp className="size-4 text-muted-foreground" />
          </span>
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold">Import a statement</div>
            <p className="mt-1 text-[12.5px] text-muted-foreground">
              No bank link? Drop a CSV or OFX export and map the columns — the same pipeline categorizes and posts it.
            </p>
          </div>
        </div>
        <div>
          <Button asChild variant="outline" size="sm" data-testid="connections-import-link">
            <Link href="/transactions">Open the importer</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
