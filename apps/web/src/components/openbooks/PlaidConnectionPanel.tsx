"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import {
  AlertTriangle,
  Banknote,
  Check,
  ChevronRight,
  Link,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlaidLink, type PlaidLinkError, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";

import { api } from "../../../../../convex/_generated/api";
import { Amount } from "@/components/openbooks/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  openBooksPlaidFixtureTransactions,
  plaidEnvLabel,
  plaidModeTone,
  type PlaidConnectionState,
  type PlaidEnvState,
  type PlaidFixtureTransaction,
  type PlaidSelectableAccount,
} from "@/lib/openbooks/plaid";
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
      { mode: "sandbox" | "fixture"; linkToken: string; env: PlaidEnvState }
    >;
    createSandboxPublicToken: FunctionReference<
      "action",
      "public",
      { entityId: string; institutionId?: string },
      { mode: "sandbox" | "fixture"; publicToken: string; request: unknown }
    >;
    exchangePublicTokenAndPreviewAccounts: FunctionReference<
      "action",
      "public",
      { entityId: string; publicToken: string },
      {
        mode: "sandbox" | "fixture";
        accessTokenPersisted: boolean;
        persistenceBlocker?: string;
        accounts: PlaidSelectableAccount[];
      }
    >;
    selectSandboxFixtureAccounts: FunctionReference<
      "mutation",
      "public",
      { entityId: string; accounts: PlaidSelectableAccount[] },
      { createdCount: number; accounts: Array<{ bankAccountId: string; ledgerAccountId: string; plaidAccountId: string }> }
    >;
    syncFixtureTransactions: FunctionReference<
      "mutation",
      "public",
      {
        entityId: string;
        bankAccountId: string;
        transactions: PlaidFixtureTransaction[];
        removedTransactionIds?: string[];
        nextCursor?: string;
      },
      {
        stagedCount: number;
        postedCount: number;
        needsReviewCount: number;
        duplicateCount: number;
        plaidPriorCount: number;
        removedCount: number;
        removedReversalCount: number;
        nextCursor: string;
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
    handleItemLoginRequired: FunctionReference<
      "mutation",
      "public",
      { entityId: string; institutionName: string; itemId: string },
      { inboxItemId: string; payloadSummary: string }
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

function StatusBadge({ env }: { env: PlaidEnvState | undefined }) {
  const tone = plaidModeTone(env);
  if (tone === "ready") {
    return (
      <Badge className="bg-primary text-primary-foreground">
        <ShieldCheck className="size-3" />
        Sandbox ready
      </Badge>
    );
  }
  if (tone === "blocked") {
    return (
      <Badge variant="destructive">
        <AlertTriangle className="size-3" />
        Sandbox required
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <Banknote className="size-3" />
      Fixture mode
    </Badge>
  );
}

function StepRow({
  icon: Icon,
  title,
  detail,
  complete,
}: {
  icon: typeof Link;
  title: string;
  detail: string;
  complete?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-background px-3 py-2">
      <div
        className={cn(
          "mt-0.5 flex size-7 items-center justify-center rounded-lg border",
          complete ? "border-primary/30 bg-primary/10 text-primary" : "text-muted-foreground",
        )}
      >
        {complete ? <Check className="size-4" /> : <Icon className="size-4" />}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
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
  className,
}: {
  entityId?: string | null;
  className?: string;
}) {
  const envState = useQuery(plaidApi.plaid.envState, {});
  const connectionState = useQuery(
    plaidApi.plaid.listConnectionState,
    entityId ? { entityId } : "skip",
  );
  const createLinkToken = useAction(plaidApi.plaid.createLinkToken);
  const createSandboxPublicToken = useAction(plaidApi.plaid.createSandboxPublicToken);
  const exchangePublicToken = useAction(plaidApi.plaid.exchangePublicTokenAndPreviewAccounts);
  const selectAccounts = useMutation(plaidApi.plaid.selectSandboxFixtureAccounts);
  const syncTransactions = useMutation(plaidApi.plaid.syncFixtureTransactions);
  const syncItemNow = useAction(plaidApi.plaid.syncItemNow);
  const createRelinkCard = useMutation(plaidApi.plaid.handleItemLoginRequired);

  const [state, setState] = useState<ActionState>("idle");
  const [message, setMessage] = useState("");
  const [linkTokenMode, setLinkTokenMode] = useState<"sandbox" | "fixture" | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [previewAccounts, setPreviewAccounts] = useState<PlaidSelectableAccount[]>([]);
  const [createdBankAccountId, setCreatedBankAccountId] = useState<string | null>(null);

  const activeBankAccountId = useMemo(() => {
    return createdBankAccountId ?? connectionState?.accounts[0]?.id ?? null;
  }, [connectionState?.accounts, createdBankAccountId]);
  const activePlaidItemId = connectionState?.items.find((item) => item.status === "active")?.plaidItemId ?? null;

  async function runStep(label: string, operation: () => Promise<string>) {
    if (!entityId) {
      setState("error");
      setMessage("Create or select the Live Sandbox entity before connecting Plaid.");
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

  function updateAccountSelection(plaidAccountId: string, include: boolean) {
    setPreviewAccounts((accounts) =>
      accounts.map((account) =>
        account.plaidAccountId === plaidAccountId ? { ...account, include } : account,
      ),
    );
  }

  const handlePlaidSuccess = useCallback(
    (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      if (!entityId) return;
      setState("working");
      setMessage("Plaid Link succeeded. Exchanging the temporary token with Convex.");
      void exchangePublicToken({
        entityId,
        publicToken,
      })
        .then((preview) => {
          setPreviewAccounts(preview.accounts);
          setLinkTokenMode(preview.mode);
          setLinkToken(null);
          setState("success");
          const institution = metadata.institution?.name ?? "Plaid sandbox bank";
          if (preview.mode === "sandbox" && preview.accessTokenPersisted) {
            setMessage(`${institution} connected. Access token is stored server-side; choose the accounts to add.`);
            return;
          }
          setMessage(preview.persistenceBlocker ?? "Plaid exchange fell back to fixture mode; choose fixture accounts to continue.");
        })
        .catch((error) => {
          setState("error");
          setMessage(readableError(error, "Plaid Link completed, but token exchange failed."));
        });
    },
    [entityId, exchangePublicToken],
  );

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
    setMessage("Plaid Link could not load in this browser session. Use sandbox bypass or retry after checking the network.");
  }, []);

  const env = connectionState?.env ?? envState;

  return (
    <Card className={cn("shadow-xs", className)} data-testid="plaid-connection-panel">
      <CardHeader className="border-b">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="size-4 text-primary" />
              Bank connection
            </CardTitle>
            <CardDescription>
              Plaid sandbox imports bank and card activity, then stages each item through the
              OpenBooks categorization pipeline.
            </CardDescription>
          </div>
          <StatusBadge env={env} />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <StepRow
            icon={ShieldCheck}
            title="Environment"
            detail={plaidEnvLabel(env)}
            complete={Boolean(env?.ready)}
          />
          <StepRow
            icon={Link}
            title="Link launch"
            detail={linkTokenMode ? `${linkTokenMode} token prepared` : "Open Plaid Link from a sandbox token or use fixture bypass."}
            complete={Boolean(linkTokenMode)}
          />
          <StepRow
            icon={RefreshCw}
            title="Pipeline sync"
            detail={activePlaidItemId ? "Stored Plaid item can sync through Convex actions and cron." : "Fixture sync sends Plaid-shaped transactions to stages 1-3."}
            complete={Boolean(activeBankAccountId || activePlaidItemId)}
          />
        </div>

        {!entityId ? (
          <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
            Main integration should pass the Live Sandbox entity id into this panel.
          </div>
        ) : null}

        {env?.problems.length ? (
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm">
            <div className="font-medium">Plaid configuration</div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {env.problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!entityId || state === "working"}
            onClick={() =>
              runStep("Create Link token", async () => {
                const result = await createLinkToken({ entityId: entityId!, clientName: "OpenBooks" });
                setLinkTokenMode(result.mode);
                setLinkToken(result.mode === "sandbox" ? result.linkToken : null);
                return result.mode === "sandbox"
                  ? "Sandbox Link token is ready. Open Plaid Link to connect a bank."
                  : "Fixture Link token is ready because Plaid sandbox env is absent.";
              })
            }
          >
            <Link className="size-4" />
            Prepare Link
          </Button>
          {linkToken && linkTokenMode === "sandbox" ? (
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
          ) : (
            <Button disabled data-testid="plaid-open-link">
              <Banknote className="size-4" />
              Open Plaid Link
            </Button>
          )}
          <Button
            disabled={!entityId || state === "working"}
            onClick={() =>
              runStep("Sandbox bypass", async () => {
                const token = await createSandboxPublicToken({ entityId: entityId!, institutionId: "ins_109508" });
                const preview = await exchangePublicToken({
                  entityId: entityId!,
                  publicToken: token.publicToken,
                });
                setPreviewAccounts(preview.accounts);
                setLinkTokenMode(token.mode);
                if (preview.mode === "sandbox") {
                  return preview.accessTokenPersisted
                    ? "Sandbox public token exchanged. Access token is stored server-side; accounts are ready for selection."
                    : (preview.persistenceBlocker ?? "Sandbox public token exchanged, but access-token storage was not confirmed.");
                }
                return "Fixture accounts are ready for selection.";
              })
            }
          >
            <ChevronRight className="size-4" />
            Use sandbox bypass
          </Button>
          <Button
            variant="outline"
            disabled={!entityId || state === "working"}
            onClick={() =>
              runStep("Relink card", async () => {
                const result = await createRelinkCard({
                  entityId: entityId!,
                  institutionName: "Plaid Sandbox Bank",
                  itemId: "fixture-item-login-required",
                });
                return result.payloadSummary;
              })
            }
          >
            <AlertTriangle className="size-4" />
            Simulate relink
          </Button>
        </div>

        {previewAccounts.length ? (
          <div className="space-y-3 rounded-lg border p-3" data-testid="plaid-account-selection">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium">Account selection</div>
                <p className="text-xs text-muted-foreground">
                  Included accounts get ledger accounts and bank-account records.
                </p>
              </div>
              <Button
                size="sm"
                disabled={state === "working" || !previewAccounts.some((account) => account.include)}
                onClick={() =>
                  runStep("Create accounts", async () => {
                    const result = await selectAccounts({ entityId: entityId!, accounts: previewAccounts });
                    setCreatedBankAccountId(result.accounts[0]?.bankAccountId ?? null);
                    return result.createdCount > 0
                      ? `Created ${result.createdCount} Plaid account${result.createdCount === 1 ? "" : "s"}.`
                      : "Plaid accounts already exist; refreshed account selection.";
                  })
                }
              >
                <Check className="size-4" />
                Create selected
              </Button>
            </div>
            <div className="grid gap-2">
              {previewAccounts.map((account) => (
                <label
                  key={account.plaidAccountId}
                  className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <input
                      type="checkbox"
                      checked={account.include}
                      onChange={(event) => updateAccountSelection(account.plaidAccountId, event.target.checked)}
                      className="size-4 accent-[#2ca01c]"
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{account.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {account.subtype} ending {account.mask}
                      </span>
                    </span>
                  </span>
                  <Amount amountMinor={account.balanceMinor} currency={account.currency} />
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="rounded-lg border p-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="text-sm font-medium">Transactions sync</div>
              <p className="text-xs text-muted-foreground">
                Real sync uses the stored Plaid item cursor; fixture sync stays available when sandbox keys are absent.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
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
              <Button
                variant="outline"
                disabled={!entityId || !activeBankAccountId || state === "working"}
                onClick={() =>
                  runStep("Sync fixture transactions", async () => {
                    const result = await syncTransactions({
                      entityId: entityId!,
                      bankAccountId: activeBankAccountId!,
                      transactions: openBooksPlaidFixtureTransactions,
                    });
                    return `Synced ${result.stagedCount}; posted ${result.postedCount}; inbox ${result.needsReviewCount}; duplicates ${result.duplicateCount}; Plaid priors ${result.plaidPriorCount}.`;
                  })
                }
              >
                <RefreshCw className={cn("size-4", state === "working" && "animate-spin")} />
                Sync fixture
              </Button>
            </div>
          </div>
        </div>

        {connectionState?.items.length ? (
          <div className="grid gap-2" data-testid="plaid-connected-items">
            {connectionState.items.map((item) => (
              <div key={item.plaidItemId} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm">
                <div>
                  <div className="font-medium">{item.institutionName ?? "Plaid item"}</div>
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

        {connectionState?.accounts.length ? (
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

        {connectionState?.recentTransactions.length ? (
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

        {message ? (
          <div
            className={cn(
              "rounded-lg border px-4 py-3 text-sm",
              state === "error"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-primary/20 bg-primary/5 text-primary",
            )}
            data-testid="plaid-panel-message"
          >
            {message}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
