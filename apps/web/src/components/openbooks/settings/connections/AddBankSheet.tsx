"use client";

import { useAction, useMutation } from "convex/react";
import { AlertTriangle, Banknote, CheckCircle2, Landmark, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  usePlaidLink,
  type PlaidLinkError,
  type PlaidLinkOnSuccessMetadata,
} from "react-plaid-link";
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
import { clearPlaidOAuthSession, storePlaidOAuthSession } from "@/lib/openbooks/plaid-oauth";

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

function PlaidLinkButton({
  token,
  disabled,
  onSuccess,
  onExit,
  onLoadError,
}: {
  token: string;
  disabled?: boolean;
  onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => void;
  onExit: (error: PlaidLinkError | null) => void;
  onLoadError: () => void;
}) {
  const { open, ready, error } = usePlaidLink({ token, onSuccess, onExit });
  useEffect(() => {
    if (error) onLoadError();
  }, [error, onLoadError]);
  return (
    <Button type="button" disabled={disabled || !ready} onClick={() => open()} data-testid="plaid-open-link">
      <Banknote className="size-4" />
      Open Plaid Link
    </Button>
  );
}

export function AddBankSheet({
  open,
  onOpenChange,
  businesses,
  defaultEntityId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businesses: ConnectionBusiness[];
  defaultEntityId: string;
}) {
  const createLinkToken = useAction(api.plaid.createLinkToken);
  const exchangePublicToken = useAction(api.plaid.exchangePublicTokenAndPreviewAccounts);
  const assignAccounts = useMutation(api.plaid.assignPlaidAccountsToBusinesses);

  const [entityId, setEntityId] = useState(defaultEntityId);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  // Preview-then-assign state (E3-T5): the accounts Plaid returned and the
  // Item we already persisted, awaiting the owner's per-account routing.
  const [previewAccounts, setPreviewAccounts] = useState<PreviewAccount[]>([]);
  const [plaidItemId, setPlaidItemId] = useState<string | null>(null);
  const [institutionName, setInstitutionName] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Reset the form each time the sheet opens — a deliberate sync to an external
    // trigger (the sheet's open state), not a render-driven cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntityId(defaultEntityId);
    setPhase("idle");
    setMessage("");
    setLinkToken(null);
    setPreviewAccounts([]);
    setPlaidItemId(null);
    setInstitutionName(null);
  }, [open, defaultEntityId]);

  const businessName = businesses.find((business) => business.id === entityId)?.name ?? "this business";

  async function onPrepare() {
    if (!entityId) return;
    setPhase("preparing");
    setMessage("");
    setLinkToken(null);
    try {
      const result = await createLinkToken({ entityId: entityId as Id<"entities">, clientName: "OpenBooks" });
      if (result.mode === "fixture") {
        setPhase("error");
        setMessage("Plaid isn’t ready yet. Open “Bank connections” and save a valid Plaid app first.");
        return;
      }
      storePlaidOAuthSession({ linkToken: result.linkToken, entityId });
      setLinkToken(result.linkToken);
      setPhase("ready");
      setMessage(`Plaid is ready. Open Link to connect a bank to ${businessName}.`);
    } catch (error) {
      setPhase("error");
      setMessage(readableError(error, "Could not start Plaid Link."));
    }
  }

  const handleSuccess = useCallback(
    (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      if (!entityId) return;
      setPhase("linking");
      setMessage("Bank authorized. Reading accounts…");
      // E3-T5: preview the accounts WITHOUT creating bank accounts yet, so the
      // owner can route each one to the right business before we persist them.
      void exchangePublicToken({
        entityId: entityId as Id<"entities">,
        publicToken,
        previewOnly: true,
      })
        .then((result) => {
          clearPlaidOAuthSession();
          setLinkToken(null);
          if (result.mode === "fixture" || !result.accessTokenPersisted) {
            setPhase("error");
            setMessage(
              result.persistenceBlocker ??
                "Plaid finished but no bank token was stored. Check the Plaid app setup.",
            );
            return;
          }
          const accounts = (result.accounts ?? []).map((account) => ({
            plaidAccountId: account.plaidAccountId,
            name: account.name,
            mask: account.mask,
            subtype: account.subtype,
            balanceMinor: account.balanceMinor,
            currency: account.currency,
            plaidItemId: account.plaidItemId,
            // Default each account to the business the owner started from
            // (back-compat: a single-business link stays unchanged).
            entityId,
            include: true,
          }));
          if (accounts.length === 0) {
            setPhase("error");
            setMessage("Plaid returned no accounts for this login.");
            return;
          }
          setInstitutionName(result.institutionName ?? metadata.institution?.name ?? "Your bank");
          setPlaidItemId(("plaidItemId" in result ? result.plaidItemId : null) ?? null);
          setPreviewAccounts(accounts);
          setPhase("assigning");
          setMessage("");
        })
        .catch((error) => {
          setPhase("error");
          setMessage(readableError(error, "Plaid Link completed, but reading accounts failed."));
        });
    },
    [entityId, exchangePublicToken],
  );

  const handleExit = useCallback((error: PlaidLinkError | null) => {
    setLinkToken(null);
    if (!error) {
      setPhase("idle");
      setMessage("Plaid Link closed before a bank was connected.");
      return;
    }
    setPhase("error");
    setMessage(error.display_message || error.error_message || error.error_code || "Plaid Link exited with an error.");
  }, []);

  const handleLoadError = useCallback(() => {
    setPhase("error");
    setMessage("Plaid Link could not load in this browser session. Try again.");
  }, []);

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
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md" data-testid="add-bank-sheet">
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
          <div className="flex flex-col gap-5 p-4">
            <div className="grid gap-1.5">
              <FieldLabel>Business</FieldLabel>
              <BusinessSelect
                businesses={businesses}
                value={entityId}
                onChange={(value) => {
                  setEntityId(value);
                  setLinkToken(null);
                  setPhase("idle");
                  setMessage("");
                }}
                testId="add-bank-business"
              />
              <p className="text-[11.5px] leading-5 text-muted-foreground">
                You’ll map each connected account to a business after Plaid returns them.
              </p>
            </div>

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

        <SheetFooter className="border-t">
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
          ) : linkToken && phase === "ready" ? (
            <PlaidLinkButton
              token={linkToken}
              onSuccess={handleSuccess}
              onExit={handleExit}
              onLoadError={handleLoadError}
            />
          ) : (
            <Button type="button" onClick={onPrepare} disabled={!entityId || phase === "preparing" || phase === "linking"}>
              {phase === "preparing" || phase === "linking" ? (
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
