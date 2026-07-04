"use client";

import { useAction, useMutation } from "convex/react";
import { AlertTriangle, Banknote, CheckCircle2, ExternalLink, Landmark, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { storePlaidOAuthSession } from "@/lib/openbooks/plaid-oauth";

// Message shape sent from the /plaid/link tab back to this window.
type PlaidLinkMessage =
  | { type: "plaid-link-success"; accounts: PreviewAccount[]; institutionName: string | null; plaidItemId: string | null }
  | { type: "plaid-link-error"; message: string }
  | { type: "plaid-link-exit" };

import { BusinessSelect, FieldLabel, readableError, type ConnectionBusiness } from "./shared";

type Phase = "idle" | "preparing" | "ready" | "linking" | "assigning" | "saving" | "error";

// One previewed Plaid account plus the owner's per-account routing choice. A
// single Plaid login can span multiple LLCs (E3-T5), so each account carries its
// own owning business and an include toggle — nothing is silently dropped.
type PreviewAccount = {
  plaidAccountId: string;
  name: string;
  mask: string;
  subtype: string;
  balanceMinor: number;
  currency: string;
  plaidItemId?: string;
  entityId: string;
  include: boolean;
};

function formatBalance(balanceMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(balanceMinor / 100);
  } catch {
    return `${(balanceMinor / 100).toFixed(2)} ${currency}`;
  }
}

// Minimal shape of an already-connected bank account, used to detect when a
// business is already linked so we can skip Plaid Link (the owner asked for
// "pick the existing connection first, only open Plaid when there's none").
type ExistingBankAccount = {
  entityId: string;
  name: string;
  mask: string;
  kind?: string;
  plaidItemId?: string | null;
  itemStatus?: string | null;
  institutionName?: string | null;
};

export function AddBankSheet({
  open,
  onOpenChange,
  businesses,
  defaultEntityId,
  existingBankAccounts = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businesses: ConnectionBusiness[];
  defaultEntityId: string;
  existingBankAccounts?: ExistingBankAccount[];
}) {
  const createLinkToken = useAction(api.plaid.createLinkToken);
  const assignAccounts = useMutation(api.plaid.assignPlaidAccountsToBusinesses);

  const [entityId, setEntityId] = useState(defaultEntityId);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  // Set when the owner explicitly chooses to add ANOTHER bank even though this
  // business is already connected — reveals the normal Plaid Link flow.
  const [connectAnother, setConnectAnother] = useState(false);
  // Preview-then-assign state (E3-T5): the accounts Plaid returned and the
  // Item we already persisted, awaiting the owner's per-account routing.
  const [previewAccounts, setPreviewAccounts] = useState<PreviewAccount[]>([]);
  const [plaidItemId, setPlaidItemId] = useState<string | null>(null);
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  // Reference to the /plaid/link tab so we can re-focus it if still open.
  const plaidTabRef = useRef<Window | null>(null);

  useEffect(() => {
    if (!open) return;
    // Reset the form each time the sheet opens — a deliberate sync to an external
    // trigger (the sheet's open state), not a render-driven cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntityId(defaultEntityId);
    setPhase("idle");
    setMessage("");
    setPreviewAccounts([]);
    setPlaidItemId(null);
    setInstitutionName(null);
    setConnectAnother(false);
    plaidTabRef.current = null;
  }, [open, defaultEntityId]);

  // Listen for messages posted from the /plaid/link tab.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as PlaidLinkMessage;
      if (data.type === "plaid-link-success") {
        if (data.accounts.length === 0) {
          setPhase("error");
          setMessage("Plaid returned no accounts for this login.");
          return;
        }
        setInstitutionName(data.institutionName);
        setPlaidItemId(data.plaidItemId);
        setPreviewAccounts(data.accounts);
        setPhase("assigning");
        setMessage("");
      } else if (data.type === "plaid-link-error") {
        setPhase("error");
        setMessage(data.message || "Plaid Link failed.");
      } else if (data.type === "plaid-link-exit") {
        setPhase("idle");
        setMessage("Plaid Link was closed before a bank was connected.");
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const businessName = businesses.find((business) => business.id === entityId)?.name ?? "this business";

  // Banks already linked to the currently-selected business (active items only).
  const existingForBusiness = existingBankAccounts.filter(
    (account) =>
      String(account.entityId) === entityId &&
      account.plaidItemId &&
      account.itemStatus !== "disconnected",
  );
  // Show the "already connected" view until the owner opts to add another, and
  // only while idle (never mid-Plaid-flow or during assignment).
  const showExisting = existingForBusiness.length > 0 && !connectAnother && phase === "idle";

  function openPlaidTab() {
    const tab = window.open("/plaid/link", "_blank");
    plaidTabRef.current = tab;
  }

  async function onPrepare() {
    if (!entityId) return;
    setPhase("preparing");
    setMessage("");
    try {
      const result = await createLinkToken({ entityId: entityId as Id<"entities">, clientName: "OpenBooks" });
      if (result.mode === "fixture") {
        setPhase("error");
        setMessage(`Plaid is not ready yet. Save a valid Plaid app in Settings > Connections first.`);
        return;
      }
      // Store the token in localStorage so the /plaid/link tab can read it.
      storePlaidOAuthSession({ linkToken: result.linkToken, entityId });
      openPlaidTab();
      setPhase("ready");
      setMessage(`Plaid Link opened in a new tab. Complete the flow there to connect a bank to ${businessName}.`);
    } catch (error) {
      setPhase("error");
      setMessage(readableError(error, "Could not start Plaid Link."));
    }
  }

  const reopenTab = useCallback(() => {
    if (plaidTabRef.current && !plaidTabRef.current.closed) {
      plaidTabRef.current.focus();
    } else {
      openPlaidTab();
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  function updateAccount(plaidAccountId: string, patch: Partial<PreviewAccount>) {
    setPreviewAccounts((accounts) =>
      accounts.map((account) =>
        account.plaidAccountId === plaidAccountId ? { ...account, ...patch } : account,
      ),
    );
  }

  const includedCount = previewAccounts.filter((account) => account.include).length;

  async function onConfirmAssignments() {
    if (!entityId || includedCount === 0) return;
    setPhase("saving");
    try {
      // Every previewed account is sent — included ones carry their chosen
      // business, excluded ones carry include:false (explicit, never dropped).
      const result = await assignAccounts({
        entityId: entityId as Id<"entities">,
        ...(plaidItemId ? { plaidItemId } : {}),
        accounts: previewAccounts.map((account) => ({
          plaidAccountId: account.plaidAccountId,
          name: account.name,
          mask: account.mask,
          subtype: account.subtype,
          balanceMinor: account.balanceMinor,
          currency: account.currency,
          include: account.include,
          ...(account.plaidItemId ? { plaidItemId: account.plaidItemId } : {}),
          entityId: account.entityId as Id<"entities">,
        })),
      });
      const touched = (result.createdCount ?? 0) + (result.updatedCount ?? 0);
      toast.success(
        `${institutionName ?? "Bank"} connected — ${touched} account${touched === 1 ? "" : "s"} added.`,
      );
      onOpenChange(false);
    } catch (error) {
      setPhase("assigning");
      toast.error(readableError(error, "Could not save the account assignments."));
    }
  }

  const assigning = phase === "assigning" || phase === "saving";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-x-hidden overflow-y-auto sm:max-w-md" data-testid="add-bank-sheet">
        <SheetHeader className="border-b">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-[8px] bg-ob-green-50 text-ob-green-800">
              <Landmark className="size-4" />
            </span>
            <SheetTitle>Add a bank account</SheetTitle>
          </div>
          <SheetDescription>
            {assigning
              ? "Choose which business owns each account. One login can serve several businesses."
              : "Choose the business to start from, then connect through Plaid Link."}
          </SheetDescription>
        </SheetHeader>

        {assigning ? (
          <div className="flex flex-col gap-4 p-4" data-testid="plaid-account-assignment">
            <p className="text-[12.5px] leading-5 text-muted-foreground">
              {institutionName ? `${institutionName}: ` : ""}
              assign each account to the business it belongs to. Turn one off to skip it for now.
            </p>
            <div className="flex flex-col gap-3">
              {previewAccounts.map((account) => (
                <div
                  key={account.plaidAccountId}
                  className="grid gap-2 rounded-[10px] border bg-card p-3"
                  data-testid="plaid-account-row"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{account.name}</div>
                      <div className="text-[11.5px] text-muted-foreground">
                        ••{account.mask} · {account.subtype} · {formatBalance(account.balanceMinor, account.currency)}
                      </div>
                    </div>
                    <Switch
                      checked={account.include}
                      onCheckedChange={(checked) => updateAccount(account.plaidAccountId, { include: checked })}
                      aria-label={`Include ${account.name}`}
                      data-testid="plaid-account-include"
                    />
                  </div>
                  {account.include ? (
                    <div className="grid gap-1.5">
                      <FieldLabel>Business</FieldLabel>
                      <BusinessSelect
                        businesses={businesses}
                        value={account.entityId}
                        onChange={(value) => updateAccount(account.plaidAccountId, { entityId: value })}
                        testId="plaid-account-business"
                      />
                    </div>
                  ) : (
                    <p className="text-[11.5px] text-muted-foreground">Skipped — not imported.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-5 p-4">
            <div className="grid gap-1.5">
              <FieldLabel>Business</FieldLabel>
              <BusinessSelect
                businesses={businesses}
                value={entityId}
                onChange={(value) => {
                  setEntityId(value);
                  setPhase("idle");
                  setMessage("");
                  setConnectAnother(false);
                }}
                testId="add-bank-business"
              />
              {!showExisting ? (
                <p className="text-[11.5px] leading-5 text-muted-foreground">
                  You'll map each connected account to a business after Plaid returns them.
                </p>
              ) : null}
            </div>

            {showExisting ? (
              <div
                className="grid min-w-0 gap-2 rounded-[10px] border border-primary/20 bg-primary/5 p-3"
                data-testid="add-bank-already-connected"
              >
                <div className="flex items-center gap-2 text-[12.5px] font-medium text-primary">
                  <CheckCircle2 className="size-4 shrink-0" />
                  {businessName} is already connected
                </div>
                <p className="text-[12px] leading-5 text-muted-foreground">
                  No need to reconnect — transactions are already syncing for{" "}
                  {existingForBusiness.length === 1 ? "this account" : "these accounts"}:
                </p>
                <ul className="grid gap-1">
                  {existingForBusiness.map((account, index) => (
                    <li
                      key={`${account.plaidItemId}:${account.mask}:${index}`}
                      className="truncate rounded-[8px] border bg-card px-2.5 py-1.5 text-[12px]"
                    >
                      <span className="font-medium">{account.institutionName ?? account.name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        ••{account.mask}
                        {account.kind ? ` · ${account.kind}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {message ? (
              <div
                className={
                  phase === "error"
                    ? "flex items-start gap-2 rounded-[10px] border border-negative/30 bg-negative-surface px-3 py-2 text-[12.5px] text-negative"
                    : "rounded-[10px] border border-primary/20 bg-primary/5 px-3 py-2 text-[12.5px] text-primary"
                }
                data-testid="add-bank-message"
              >
                {phase === "error" ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : null}
                <span>{message}</span>
              </div>
            ) : null}
          </div>
        )}

        <SheetFooter className="border-t sm:flex-row sm:justify-end">
          {assigning ? (
            <Button
              type="button"
              onClick={onConfirmAssignments}
              disabled={phase === "saving" || includedCount === 0}
              data-testid="plaid-assign-confirm"
            >
              {phase === "saving" ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {includedCount === 0 ? "Select at least one account" : `Add ${includedCount} account${includedCount === 1 ? "" : "s"}`}
            </Button>
          ) : showExisting ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setConnectAnother(true);
                  setMessage("");
                }}
                data-testid="add-bank-connect-another"
              >
                <Banknote className="size-4" />
                Connect another bank
              </Button>
              <Button type="button" onClick={() => onOpenChange(false)} data-testid="add-bank-done">
                <CheckCircle2 className="size-4" />
                Done
              </Button>
            </>
          ) : phase === "ready" ? (
            <Button type="button" variant="outline" onClick={reopenTab} data-testid="plaid-open-link">
              <ExternalLink className="size-4" />
              Open Plaid Link tab
            </Button>
          ) : (
            <Button type="button" onClick={onPrepare} disabled={!entityId || phase === "preparing"}>
              {phase === "preparing" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Banknote className="size-4" />
              )}
              {phase === "error" ? "Try again" : "Continue to Plaid"}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
