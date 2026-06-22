"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import {
  AlertTriangle,
  Banknote,
  Check,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { usePlaidLink, type PlaidLinkError, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";

import { api } from "../../../../../convex/_generated/api";
import { Amount } from "@/components/openbooks/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  plaidEnvLabel,
  type PlaidAccountUpsertResult,
  type PlaidConnectionState,
  type PlaidEnvState,
  type PlaidSelectableAccount,
} from "@/lib/openbooks/plaid";
import { clearPlaidOAuthSession, storePlaidOAuthSession } from "@/lib/openbooks/plaid-oauth";
import { cn } from "@/lib/utils";

type ActionState = "idle" | "working" | "success" | "error";

type PlaidApi = {
  plaid: {
    envState: FunctionReference<"query", "public", Record<string, never>, PlaidEnvState>;
    listConnectionState: FunctionReference<"query", "public", { entityId: string }, PlaidConnectionState>;
    createLinkToken: FunctionReference<
      "action",
      "public",
      { entityId: string; clientName?: string },
      { mode: "sandbox" | "development" | "production" | "fixture"; linkToken: string; env: PlaidEnvState }
    >;
    exchangePublicTokenAndPreviewAccounts: FunctionReference<
      "action",
      "public",
      { entityId: string; publicToken: string; previewOnly?: boolean },
      {
        mode: "sandbox" | "development" | "production" | "fixture";
        accessTokenPersisted: boolean;
        persistenceBlocker?: string;
        previewOnly?: boolean;
        plaidItemId?: string;
        accounts: PlaidSelectableAccount[];
        accountsCreated?: number;
        accountsUpdated?: number;
        institutionName?: string;
      }
    >;
    assignPlaidAccountsToBusinesses: FunctionReference<
      "mutation",
      "public",
      { entityId: string; plaidItemId?: string; accounts: PlaidSelectableAccount[] },
      { createdCount: number; updatedCount: number; accounts: Array<{ plaidAccountId: string; entityId: string }> }
    >;
    refreshPlaidItemAccounts: FunctionReference<
      "action",
      "public",
      { entityId: string; plaidItemId: string },
      PlaidAccountUpsertResult & {
        status: "refreshed" | "missing_item" | "skipped" | "locked";
        reason?: string;
        institutionName?: string;
      }
    >;
    syncItemNow: FunctionReference<
      "action",
      "public",
      { entityId: string; plaidItemId: string },
      {
        status: string;
        itemId: string;
        trigger: "manual" | "cron" | "webhook";
        stagedCount?: number;
        postedCount?: number;
        needsReviewCount?: number;
        duplicateCount?: number;
        unmatchedAccountCount?: number;
        reason?: string;
      }
    >;
  };
};

const plaidApi = api as unknown as PlaidApi;

function readableError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const uncaught = error.message.match(/Uncaught Error: ([\s\S]+)/);
  if (uncaught) return uncaught[1].trim().split("\n")[0] ?? fallback;
  return error.message;
}

function PlaidOpenButton({
  token,
  disabled,
  onSuccess,
  onExit,
  onOpen,
  onLoadError,
}: {
  token: string;
  disabled?: boolean;
  onSuccess: (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => void;
  onExit: (error: PlaidLinkError | null) => void;
  onOpen: () => void;
  onLoadError: () => void;
}) {
  const {
    open: openPlaidLink,
    ready,
    error,
  } = usePlaidLink({
    token,
    onSuccess,
    onExit,
  });

  useEffect(() => {
    if (error) onLoadError();
  }, [error, onLoadError]);

  return (
    <Button
      disabled={disabled || !ready}
      onClick={() => {
        onOpen();
        openPlaidLink();
      }}
      data-testid="plaid-open-link"
    >
      <Banknote className="size-4" />
      Open Plaid Link
    </Button>
  );
}

export function PlaidConnectionPanel({
  entityId,
  businessName,
  businesses,
  showConnectAction = true,
  showSetupProblems = true,
  compact = false,
  className,
}: {
  entityId?: string | null;
  businessName?: string | null;
  // E3-T5: when a workspace has more than one business, pass the full list so a
  // single Plaid login can be split — each previewed account gets its own
  // business picker after Link success. Omit (or pass one) for the single-
  // business auto-persist flow (back-compat).
  businesses?: Array<{ id: string; name: string }>;
  showConnectAction?: boolean;
  showSetupProblems?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const envState = useQuery(plaidApi.plaid.envState, {});
  const connectionState = useQuery(
    plaidApi.plaid.listConnectionState,
    entityId ? { entityId } : "skip",
  );
  const createLinkToken = useAction(plaidApi.plaid.createLinkToken);
  const exchangePublicToken = useAction(plaidApi.plaid.exchangePublicTokenAndPreviewAccounts);
  const assignAccounts = useMutation(plaidApi.plaid.assignPlaidAccountsToBusinesses);
  const refreshPlaidItemAccounts = useAction(plaidApi.plaid.refreshPlaidItemAccounts);
  const syncItemNow = useAction(plaidApi.plaid.syncItemNow);

  // E3-T5 split flow: when 2+ businesses exist, after Link success we preview the
  // accounts and let the owner map each to a business before persisting.
  const canSplit = (businesses?.length ?? 0) > 1;
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [pendingAccounts, setPendingAccounts] = useState<PlaidSelectableAccount[] | null>(null);
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const [state, setState] = useState<ActionState>("idle");
  const [message, setMessage] = useState("");
  const [linkTokenMode, setLinkTokenMode] = useState<"sandbox" | "development" | "production" | "fixture" | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const rawActiveItem = connectionState?.items.find((item) => item.status === "active") ?? null;
  const hasStoredBankAccounts = (connectionState?.accounts.length ?? 0) > 0;
  const activePlaidItemId = rawActiveItem?.plaidItemId ?? null;

  async function runStep(label: string, operation: () => Promise<string>) {
    if (!entityId) {
      setState("error");
      setMessage("Create or select a business before connecting a bank.");
      return;
    }
    setState("working");
    setMessage("");
    try {
      const nextMessage = await operation();
      setState("success");
      setMessage(nextMessage || label);
    } catch (error) {
      setState("error");
      setMessage(readableError(error, `Could not complete ${label.toLowerCase()}.`));
    }
  }

  const handlePlaidSuccess = useCallback(
    (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      if (!entityId) return;
      setState("working");
      setMessage("Plaid Link succeeded. Exchanging the temporary token with Convex.");
      void exchangePublicToken({
        entityId,
        publicToken,
        // Split flow: preview the accounts without persisting so the owner can
        // map each to a business; otherwise persist all to this business.
        ...(canSplit ? { previewOnly: true } : {}),
      })
        .then((result) => {
          setLinkTokenMode(result.mode);
          setLinkToken(null);
          setState("success");
          const institution = result.institutionName ?? metadata.institution?.name ?? "Plaid bank";
          // E3-T5 split: hold the previewed accounts and let the owner assign
          // each one a business before confirming.
          if (canSplit && result.previewOnly && result.accessTokenPersisted) {
            clearPlaidOAuthSession();
            setPendingItemId(result.plaidItemId ?? null);
            setPendingAccounts(result.accounts);
            // Default every account to the started-from business.
            setAssignments(
              Object.fromEntries(result.accounts.map((account) => [account.plaidAccountId, entityId])),
            );
            setMessage(`${institution} connected. Assign each account to a business, then confirm.`);
            return;
          }
          if (result.mode !== "fixture" && result.accessTokenPersisted) {
            clearPlaidOAuthSession();
            const touched = (result.accountsCreated ?? 0) + (result.accountsUpdated ?? 0);
            setMessage(`${institution} connected. ${touched} account${touched === 1 ? "" : "s"} saved to this business.`);
            return;
          }
          setMessage(result.persistenceBlocker ?? "Plaid exchange could not persist a bank token. Open Setup and check the saved credentials.");
        })
        .catch((error) => {
          setState("error");
          setMessage(readableError(error, "Plaid Link completed, but token exchange failed."));
        });
    },
    [entityId, exchangePublicToken, canSplit],
  );

  const handleConfirmAssignments = useCallback(() => {
    if (!entityId || !pendingAccounts) return;
    setState("working");
    setMessage("Saving account-to-business assignments.");
    const accounts = pendingAccounts.map((account) => ({
      ...account,
      entityId: assignments[account.plaidAccountId] ?? entityId,
    }));
    void assignAccounts({
      entityId,
      ...(pendingItemId ? { plaidItemId: pendingItemId } : {}),
      accounts,
    })
      .then((result) => {
        setState("success");
        setPendingAccounts(null);
        setPendingItemId(null);
        setMessage(`Saved ${result.createdCount} account${result.createdCount === 1 ? "" : "s"} across your businesses.`);
      })
      .catch((error) => {
        setState("error");
        setMessage(readableError(error, "Could not save the account assignments."));
      });
  }, [entityId, pendingAccounts, pendingItemId, assignments, assignAccounts]);

  const handlePlaidExit = useCallback((error: PlaidLinkError | null) => {
    if (!error) {
      setState("idle");
      setMessage("Plaid Link was closed before a bank was connected.");
      return;
    }
    setState("error");
    setMessage(error.display_message || error.error_message || error.error_code || "Plaid Link exited with an error.");
  }, []);

  const handlePlaidLoadError = useCallback(() => {
    setState("error");
    setMessage("Plaid Link could not load in this browser session. Check the setup values and retry.");
  }, []);

  // Owner-facing connection status. An active stored item reads as "Connected";
  // a stored item that needs re-auth reads as "Sign-in expired"; nothing stored
  // yet reads as "Not connected".
  const activeItem = rawActiveItem;
  const expiredItem = connectionState?.items.find((item) => item.status !== "active") ?? null;
  const primaryItem = activeItem ?? expiredItem ?? null;
  const accountsNeedRefresh = Boolean(activeItem && !hasStoredBankAccounts);
  const connectionTone: "connected" | "pending_accounts" | "expired" | "none" = activeItem
    ? accountsNeedRefresh
      ? "pending_accounts"
      : "connected"
    : expiredItem
      ? "expired"
      : "none";
  const lastSyncedLabel = activeItem?.lastSyncedAt
    ? `synced ${new Date(activeItem.lastSyncedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
    : "not synced yet";

  return (
    <Card className={cn("shadow-xs", className)} data-testid="plaid-connection-panel">
      <CardContent className={cn("space-y-4", compact ? "p-4" : "pt-6")}>
        {/* Owner-facing connection card: logo badge, one status pill, one primary
            action. Everything operational happens here; everything diagnostic is
            in the Advanced disclosure. */}
        <div className="flex flex-wrap items-center gap-3 rounded-[12px] border bg-card p-4" data-testid="plaid-connection-card">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted">
            <Banknote className="size-5 text-muted-foreground" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold">
              {primaryItem?.institutionName ?? "Bank account"}
            </div>
            {businessName ? (
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">{businessName}</div>
            ) : null}
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
              {connectionTone === "connected" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-ob-green-50 px-2 py-0.5 text-[11px] font-medium text-ob-green-800">
                  <Check className="size-3" /> Connected · {lastSyncedLabel}
                </span>
              ) : connectionTone === "pending_accounts" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-surface px-2 py-0.5 text-[11px] font-medium text-warning">
                  <AlertTriangle className="size-3" /> Connected · accounts need refresh
                </span>
              ) : connectionTone === "expired" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-negative-surface px-2 py-0.5 text-[11px] font-medium text-negative">
                  <AlertTriangle className="size-3" /> Sign-in expired
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Not connected
                </span>
              )}
            </div>
          </div>
          {connectionTone === "pending_accounts" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!entityId || !activePlaidItemId || state === "working"}
              data-testid="plaid-refresh-accounts"
              onClick={() =>
                runStep("Refresh Plaid accounts", async () => {
                  const result = await refreshPlaidItemAccounts({
                    entityId: entityId!,
                    plaidItemId: activePlaidItemId!,
                  });
                  if (result.status !== "refreshed") {
                    return `Account refresh ${result.status}${result.reason ? `: ${result.reason}` : ""}.`;
                  }
                  const touched = result.createdCount + (result.updatedCount ?? 0);
                  return `Account list refreshed. ${touched} account${touched === 1 ? "" : "s"} saved.`;
                })
              }
            >
              <RefreshCw className={cn("size-4", state === "working" && "animate-spin")} />
              Refresh accounts
            </Button>
          ) : connectionTone === "connected" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={!entityId || !activePlaidItemId || state === "working"}
              data-testid="plaid-primary-sync"
              onClick={() =>
                runStep("Sync Plaid item", async () => {
                  const result = await syncItemNow({ entityId: entityId!, plaidItemId: activePlaidItemId! });
                  if (result.status !== "synced") {
                    return `Plaid sync ${result.status}${result.reason ? `: ${result.reason}` : ""}.`;
                  }
                  return `Synced; posted ${result.postedCount ?? 0}, inbox ${result.needsReviewCount ?? 0}.`;
                })
              }
            >
              <RefreshCw className={cn("size-4", state === "working" && "animate-spin")} />
              Sync bank
            </Button>
          ) : connectionTone === "expired" && showConnectAction ? (
            <Button
              size="sm"
              disabled={!entityId || state === "working"}
              data-testid="plaid-primary-reconnect"
              onClick={() =>
                runStep("Prepare Plaid Link", async () => {
                  const result = await createLinkToken({ entityId: entityId!, clientName: "OpenBooks" });
                  setLinkTokenMode(result.mode);
                  setLinkToken(result.mode !== "fixture" ? result.linkToken : null);
                  if (result.mode !== "fixture") {
                    storePlaidOAuthSession({ linkToken: result.linkToken, entityId: entityId! });
                  }
                  return result.mode !== "fixture"
                    ? `${plaidEnvLabel(result.env)}. Open Plaid Link to reconnect this bank.`
                    : "Plaid setup is missing. Save credentials before reconnecting.";
                })
              }
            >
              <RefreshCw className="size-4" />
              Reconnect
            </Button>
          ) : linkToken && linkTokenMode !== "fixture" && showConnectAction ? (
            <PlaidOpenButton
              token={linkToken}
              disabled={!entityId || state === "working"}
              onSuccess={handlePlaidSuccess}
              onExit={handlePlaidExit}
              onOpen={() => {
                setState("working");
                setMessage("Opening Plaid Link.");
              }}
              onLoadError={handlePlaidLoadError}
            />
          ) : showConnectAction ? (
            <Button
              size="sm"
              disabled={!entityId || state === "working"}
              data-testid="plaid-primary-connect"
              onClick={() =>
                runStep("Prepare Plaid Link", async () => {
                  const result = await createLinkToken({ entityId: entityId!, clientName: "OpenBooks" });
                  setLinkTokenMode(result.mode);
                  setLinkToken(result.mode !== "fixture" ? result.linkToken : null);
                  if (result.mode !== "fixture") {
                    storePlaidOAuthSession({ linkToken: result.linkToken, entityId: entityId! });
                  }
                  return result.mode !== "fixture"
                    ? `${plaidEnvLabel(result.env)}. Open Plaid Link to connect a bank.`
                    : "Plaid setup is missing. Open Setup to save credentials.";
                })
              }
            >
              <Banknote className="size-4" />
              Add bank
            </Button>
          ) : null}
        </div>

        {message ? (
          <div
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              state === "error"
                ? "border-negative/30 bg-negative-surface text-negative"
                : "border-primary/20 bg-primary/5 text-primary",
            )}
            data-testid="plaid-panel-message"
          >
            {message}
          </div>
        ) : null}

        {!entityId ? (
          <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
            Main integration should pass a business id into this panel.
          </div>
        ) : null}

        {showSetupProblems && envState?.problems.length ? (
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <div className="font-medium">Plaid configuration</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {envState.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="rounded-lg border p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium">Transactions sync</div>
              <p className="text-xs text-muted-foreground">
                Sync uses the stored Plaid item cursor and stages uncertain rows for review.
              </p>
            </div>
            <Button
              variant="outline"
              disabled={!entityId || !activePlaidItemId || state === "working"}
              data-testid="plaid-sync-now"
              onClick={() =>
                runStep("Sync Plaid item", async () => {
                  const result = await syncItemNow({
                    entityId: entityId!,
                    plaidItemId: activePlaidItemId!,
                  });
                  if (result.status !== "synced") {
                    return `Plaid sync ${result.status}${result.reason ? `: ${result.reason}` : ""}.`;
                  }
                  return `Plaid sync finished; staged ${result.stagedCount ?? 0}; posted ${result.postedCount ?? 0}; inbox ${result.needsReviewCount ?? 0}; duplicates ${result.duplicateCount ?? 0}; unmatched accounts ${result.unmatchedAccountCount ?? 0}.`;
                })
              }
            >
              <RefreshCw className={cn("size-4", state === "working" && "animate-spin")} />
              Sync now
            </Button>
          </div>
        </div>

        {pendingAccounts && pendingAccounts.length ? (
          <div className="space-y-3 rounded-lg border p-3" data-testid="plaid-assign-accounts">
            <div>
              <div className="text-sm font-medium">Assign accounts to a business</div>
              <p className="text-xs text-muted-foreground">
                One Plaid login can hold accounts for more than one business. Route each account to the right books.
              </p>
            </div>
            <div className="grid gap-2">
              {pendingAccounts.map((account) => (
                <div
                  key={account.plaidAccountId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  data-testid="plaid-assign-row"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{account.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {account.subtype} ending {account.mask}
                    </div>
                  </div>
                  <Select
                    value={assignments[account.plaidAccountId] ?? entityId ?? ""}
                    onValueChange={(value) =>
                      setAssignments((prev) => ({ ...prev, [account.plaidAccountId]: value }))
                    }
                  >
                    <SelectTrigger className="w-48" data-testid="plaid-assign-business">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(businesses ?? []).map((business) => (
                        <SelectItem key={business.id} value={business.id}>
                          {business.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <Button
              onClick={handleConfirmAssignments}
              disabled={state === "working"}
              data-testid="plaid-assign-confirm"
            >
              <Check className="size-4" />
              Confirm assignments
            </Button>
          </div>
        ) : null}

        {connectionState?.items.length && !hasStoredBankAccounts ? (
          <div className="grid gap-2" data-testid="plaid-connected-items">
            {connectionState.items.map((item) => (
              <div key={item.plaidItemId} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{item.institutionName ?? "Connected bank"}</div>
                  <div className="text-xs text-muted-foreground">
                    {item.status.replace("_", " ")}
                    {item.lastSyncedAt ? ` · last sync ${new Date(item.lastSyncedAt).toLocaleString()}` : " · not synced yet"}
                    {item.lastSyncTrigger ? ` · ${item.lastSyncTrigger}` : ""}
                  </div>
                </div>
                <Badge variant={item.status === "active" ? "outline" : "destructive"}>{item.status}</Badge>
              </div>
            ))}
          </div>
        ) : null}

        {activeItem && connectionState?.accounts.length ? (
          <div className="grid gap-2" data-testid="plaid-connected-accounts">
            {connectionState.accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{account.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {account.kind} ending {account.mask}
                  </div>
                </div>
                <Amount amountMinor={account.balanceMinor} />
              </div>
            ))}
          </div>
        ) : null}

        {activeItem && connectionState?.recentTransactions.length ? (
          <div className="space-y-2 rounded-lg border p-3" data-testid="plaid-recent-transactions">
            <div>
              <div className="text-sm font-medium">Recent bank imports</div>
              <p className="text-xs text-muted-foreground">
                These Plaid-shaped items were staged as OpenBooks transactions through the pipeline.
              </p>
            </div>
            <div className="grid gap-2">
              {connectionState.recentTransactions.map((transaction) => (
                <div key={transaction.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{transaction.merchant}</div>
                    <div className="text-xs text-muted-foreground">
                      {transaction.date} · {transaction.review.replace("_", " ")}
                      {transaction.plaidPriorCaptured ? " · Plaid prior" : ""}
                    </div>
                  </div>
                  <Amount amountMinor={transaction.amountMinor} currency={transaction.currency} />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {connectionState?.connectionIssues.length ? (
          <div className="space-y-2" data-testid="plaid-connection-issues">
            {connectionState.connectionIssues.map((issue) => (
              <div key={issue.id} className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-primary">
                {issue.payloadSummary}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
