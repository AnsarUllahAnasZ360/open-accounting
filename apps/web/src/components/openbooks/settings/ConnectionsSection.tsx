"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  Building2,
  ChevronDown,
  CreditCard,
  ExternalLink,
  Landmark,
  Loader2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Amount, EmptyState } from "@/components/openbooks/primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useActiveEntity } from "@/lib/openbooks/active-entity";

import { AddBankSheet } from "./connections/AddBankSheet";
import { PlunkConnectCard } from "./connections/PlunkConnectCard";
import { PlaidSetupSheet } from "./connections/PlaidSetupSheet";
import { StripeConnectSheet, type StripeEditTarget } from "./connections/StripeConnectSheet";
import {
  StatusPill,
  WebhookField,
  formatRelative,
  humanizeConnectionStatus,
  humanizeItemStatus,
  humanizeWebhookStatus,
  readableError,
  type ConnectionTone,
} from "./connections/shared";

type ConnectionsData = FunctionReturnType<typeof api.connections.list>;
type BankAccount = ConnectionsData["bankAccounts"][number];
type StripeConnection = ConnectionsData["connections"][number];

type BankGroup = {
  key: string;
  entityId: Id<"entities">;
  entityName: string;
  plaidItemId: string;
  institutionName: string;
  itemStatus: string | null;
  lastSyncedAt: number | null;
  accounts: BankAccount[];
};

type Confirm = { title: string; description: string; cta: string; action: () => Promise<void> };

function ProviderCard({
  icon: Icon,
  title,
  description,
  statusText,
  statusTone,
  actions,
  guideUrl,
  guideLabel,
}: {
  icon: typeof Landmark;
  title: string;
  description: string;
  statusText: string;
  statusTone: "ok" | "muted";
  actions: React.ReactNode;
  guideUrl?: string;
  guideLabel?: string;
}) {
  const externalGuide = guideUrl ? /^https?:\/\//.test(guideUrl) : false;
  const guideClassName = "ml-auto inline-flex items-center gap-1 text-[12px] text-primary hover:underline";

  return (
    <section className="flex flex-col gap-3 rounded-[14px] border bg-card p-4 shadow-xs" data-testid={`provider-card-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-ob-green-50 text-ob-green-800">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold">{title}</div>
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">{description}</p>
        </div>
        <span
          className={
            statusTone === "ok"
              ? "mt-1 inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] font-medium text-ob-green-800"
              : "mt-1 inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-muted-foreground"
          }
        >
          <span
            className={
              statusTone === "ok"
                ? "size-1.5 rounded-full bg-primary"
                : "size-1.5 rounded-full bg-muted-foreground/40"
            }
          />
          {statusText}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions}
        {guideUrl ? (
          externalGuide ? (
            <a
              className={guideClassName}
              href={guideUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              {guideLabel ?? "Setup guide"} <ExternalLink className="size-3" />
            </a>
          ) : (
            <Link className={guideClassName} href={guideUrl}>
              {guideLabel ?? "Setup guide"}
            </Link>
          )
        ) : null}
      </div>
    </section>
  );
}

// E3-T8: map the server-derived health status to a quiet status pill tone.
function healthTone(status: string): { tone: ConnectionTone; label: string } {
  switch (status) {
    case "active":
      return { tone: "ok", label: "Active" };
    case "relink_required":
      return { tone: "warn", label: "Re-link required" };
    case "needs_attention":
      return { tone: "warn", label: "Needs attention" };
    default:
      return { tone: "muted", label: "Not configured" };
  }
}

export function ConnectionsSection({ workspaceId }: { workspaceId?: Id<"workspaces"> | null }) {
  const data = useQuery(api.connections.list, {});
  const webhook = useQuery(api.connections.webhookConfig, {});
  const health = useQuery(api.connections.health, {});
  const { activeEntity } = useActiveEntity();

  const syncBank = useAction(api.plaid.syncItemNow);
  const disconnectBank = useAction(api.plaid.disconnectPlaidItem);
  const setBankSync = useMutation(api.plaid.setBankAccountSync);
  const testPlaidApp = useAction(api.plaid.testWorkspacePlaidApp);
  const syncStripe = useAction(api.stripe.syncNow);
  const verifyStripeWebhook = useAction(api.connections.verifyStripeWebhook);
  const validateStripeKey = useAction(api.connections.validateStripeCredential);
  const disconnectStripe = useMutation(api.connections.disconnect);
  // E5-T9: re-map which business a bank/Stripe connection belongs to.
  const reassignBank = useMutation(api.connections.reassignBankAccountEntity);
  const reassignStripe = useMutation(api.connections.reassignStripeAccountEntity);

  const [plaidSetupOpen, setPlaidSetupOpen] = useState(false);
  const [addBankOpen, setAddBankOpen] = useState(false);
  const [stripeOpen, setStripeOpen] = useState(false);
  const [stripeEdit, setStripeEdit] = useState<StripeEditTarget>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const businesses = useMemo(
    () => (data?.businesses ?? []).map((business) => ({ id: String(business.id), name: business.name })),
    [data?.businesses],
  );

  const defaultEntityId = useMemo(() => {
    const ids = new Set(businesses.map((business) => business.id));
    if (activeEntity.id && ids.has(activeEntity.id)) return activeEntity.id;
    return businesses[0]?.id ?? "";
  }, [activeEntity.id, businesses]);

  const bankGroups = useMemo(() => {
    const groups = new Map<string, BankGroup>();
    for (const account of data?.bankAccounts ?? []) {
      if (!account.plaidItemId || account.itemStatus === "disconnected") continue;
      const key = `${String(account.entityId)}:${account.plaidItemId}`;
      const existing = groups.get(key);
      if (existing) {
        existing.accounts.push(account);
        existing.lastSyncedAt = Math.max(existing.lastSyncedAt ?? 0, account.lastSyncedAt ?? 0) || null;
        continue;
      }
      groups.set(key, {
        key,
        entityId: account.entityId as Id<"entities">,
        entityName: account.entityName,
        plaidItemId: account.plaidItemId,
        institutionName: account.institutionName ?? account.name,
        itemStatus: account.itemStatus,
        lastSyncedAt: account.lastSyncedAt ?? null,
        accounts: [account],
      });
    }
    return [...groups.values()];
  }, [data?.bankAccounts]);

  const stripeConnections = useMemo(
    () =>
      (data?.connections ?? []).filter(
        (connection) =>
          connection.provider === "stripe" && connection.isCredentialConnection && connection.status !== "disconnected",
      ),
    [data?.connections],
  );

  // Group everything under the business it belongs to — the relationship the
  // owner actually thinks in.
  const grouped = useMemo(() => {
    const rows = businesses.map((business) => ({
      business,
      banks: bankGroups.filter((group) => String(group.entityId) === business.id),
      stripe: stripeConnections.filter((connection) => String(connection.entityId) === business.id),
    }));
    return rows.filter((row) => row.banks.length > 0 || row.stripe.length > 0);
  }, [businesses, bankGroups, stripeConnections]);

  const totalAccounts = bankGroups.length + stripeConnections.length;

  // E3-T8/T9: the server-derived AI health row drives the AI card on this surface.
  const aiHealth = useMemo(
    () => (health?.connections ?? []).find((row) => row.kind === "ai") ?? null,
    [health?.connections],
  );

  if (data === undefined) {
    return (
      <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">
        Loading connections…
      </div>
    );
  }

  if (data.businesses.length === 0) {
    return (
      <div className="rounded-[14px] border border-dashed bg-card p-5 shadow-xs" data-testid="connections-section">
        <div className="text-[13.5px] font-semibold">Create a business first</div>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          Bank and Stripe connections attach to a specific business so imported activity lands in the right books.
        </p>
        <Button asChild className="mt-3" size="sm">
          <Link href="/settings/businesses">
            <Plus className="size-4" /> Add business
          </Link>
        </Button>
      </div>
    );
  }

  const plaidConfigured = data.plaidApp.configured;
  const plaidEnv = data.plaidApp.configured ? data.plaidApp.environment : null;

  async function runBankSync(group: BankGroup) {
    setBusy(group.key);
    try {
      const result = await syncBank({ entityId: group.entityId, plaidItemId: group.plaidItemId });
      if (result.status !== "synced") {
        const reason = "reason" in result && result.reason ? `: ${result.reason}` : "";
        toast.message(`Sync ${result.status}${reason}`);
      } else {
        const posted = result.postedCount ?? 0;
        const review = result.needsReviewCount ?? 0;
        toast.success(`Synced — ${posted} posted${review ? `, ${review} sent to Inbox` : ""}.`);
      }
    } catch (error) {
      toast.error(readableError(error, "Bank sync failed."));
    } finally {
      setBusy(null);
    }
  }

  async function runStripeSync(connection: StripeConnection) {
    setBusy(String(connection.id));
    try {
      const result = await syncStripe({
        entityId: connection.entityId as Id<"entities">,
        connectionId: connection.id,
      });
      const review = result.inboxItemsCreated ? `, ${result.inboxItemsCreated} to review` : "";
      toast.success(
        `Synced — ${result.incomeTransactionsCreated} payments, ${result.payoutsCreated} payouts${review}.`,
      );
    } catch (error) {
      toast.error(readableError(error, "Stripe sync failed."));
    } finally {
      setBusy(null);
    }
  }

  async function runStripeVerify(connection: StripeConnection) {
    setBusy(String(connection.id));
    try {
      const result = await verifyStripeWebhook({ entityId: connection.entityId as Id<"entities"> });
      if (result.ok) {
        toast.success(result.message);
      } else {
        toast.warning(result.message);
      }
    } catch (error) {
      toast.error(readableError(error, "Could not verify the Stripe webhook."));
    } finally {
      setBusy(null);
    }
  }

  // E3-T8: re-probe the saved Stripe key against Stripe /account and stamp the
  // result server-side, so the health pill reflects a fresh check.
  async function runStripeValidate(connection: StripeConnection) {
    setBusy(String(connection.id));
    try {
      const result = await validateStripeKey({
        entityId: connection.entityId as Id<"entities">,
        connectionId: connection.id,
      });
      if (result.ok) toast.success(result.message);
      else toast.warning(result.message);
    } catch (error) {
      toast.error(readableError(error, "Could not validate the Stripe key."));
    } finally {
      setBusy(null);
    }
  }

  // E3-T8: re-probe the workspace Plaid app credentials.
  async function runPlaidValidate(key: string) {
    setBusy(key);
    try {
      const result = await testPlaidApp({});
      if (result.ok) toast.success(result.message);
      else toast.warning(result.message);
    } catch (error) {
      toast.error(readableError(error, "Could not validate the Plaid app."));
    } finally {
      setBusy(null);
    }
  }

  async function toggleAccountSync(account: BankAccount) {
    setBusy(`toggle:${String(account.id)}`);
    try {
      await setBankSync({ bankAccountId: account.id, includeInSync: !account.includeInSync });
    } catch (error) {
      toast.error(readableError(error, "Could not update sync."));
    } finally {
      setBusy(null);
    }
  }

  // E5-T9: move a bank account to a different business. Future syncs land under
  // the new business; already-posted history stays under the original (immutable).
  async function reassignBankToBusiness(account: BankAccount, entityId: string) {
    if (String(account.entityId) === entityId) return;
    setBusy(`reassign:${String(account.id)}`);
    try {
      await reassignBank({ bankAccountId: account.id, entityId: entityId as Id<"entities"> });
      toast.success("Connection moved. New transactions will sync to the new business.");
    } catch (error) {
      toast.error(readableError(error, "Could not move the connection."));
    } finally {
      setBusy(null);
    }
  }

  // E5-T9: move a Stripe account to a different business (future syncs only).
  async function reassignStripeToBusiness(connection: StripeConnection, entityId: string) {
    if (!connection.stripeAccountId || String(connection.entityId) === entityId) return;
    setBusy(`reassign-stripe:${String(connection.id)}`);
    try {
      await reassignStripe({ stripeAccountId: connection.stripeAccountId, entityId: entityId as Id<"entities"> });
      toast.success("Stripe account moved. New payouts will sync to the new business.");
    } catch (error) {
      toast.error(readableError(error, "Could not move the Stripe account."));
    } finally {
      setBusy(null);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.action();
      setConfirm(null);
    } catch (error) {
      toast.error(readableError(error, "That action could not be completed."));
    } finally {
      setConfirmBusy(false);
    }
  }

  const aiPill = healthTone(aiHealth?.status ?? "not_configured");

  return (
    <div className="flex flex-col gap-5" data-testid="connections-section">
      {/* All your keys in one place: AI, Banks, Stripe, Email — consistent cards
          with status + actions + guide links. Single column on mobile (E3-T9). */}
      <div className="grid gap-3 md:grid-cols-2">
        <ProviderCard
          icon={Sparkles}
          title="AI"
          description="Bring your own provider key for categorization and Ask AI. Workspace-wide."
          statusText={aiPill.label}
          statusTone={aiHealth?.status === "active" ? "ok" : "muted"}
          guideUrl="/setup"
          guideLabel="Open setup guide"
          actions={
            <Button size="sm" asChild data-testid="ai-card-open">
              <Link href="/settings/ai">
                <Settings2 className="size-4" /> Manage AI
              </Link>
            </Button>
          }
        />
        <ProviderCard
          icon={Landmark}
          title="Banks"
          description="Connect business bank accounts through Plaid. One Plaid app powers every business."
          statusText={plaidConfigured ? `Ready · ${plaidEnv}` : "Not set up"}
          statusTone={plaidConfigured ? "ok" : "muted"}
          guideUrl="https://plaid.com/docs/quickstart/"
          guideLabel="Plaid guide"
          actions={
            plaidConfigured ? (
              <>
                <Button size="sm" onClick={() => setAddBankOpen(true)} data-testid="bank-add-open">
                  <Plus className="size-4" /> Add bank
                </Button>
                <Button size="sm" variant="outline" onClick={() => setPlaidSetupOpen(true)} data-testid="plaid-setup-open">
                  <Settings2 className="size-4" /> Plaid settings
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setPlaidSetupOpen(true)} data-testid="plaid-setup-open">
                <Landmark className="size-4" /> Set up Plaid
              </Button>
            )
          }
        />
        <ProviderCard
          icon={CreditCard}
          title="Stripe"
          description="Sync payments, invoices, payouts, and fees with a read-only restricted key."
          statusText={
            stripeConnections.length
              ? `${stripeConnections.length} account${stripeConnections.length === 1 ? "" : "s"}`
              : "Not set up"
          }
          statusTone={stripeConnections.length ? "ok" : "muted"}
          guideUrl="https://docs.stripe.com/keys#limit-access"
          guideLabel="Stripe guide"
          actions={
            <Button
              size="sm"
              onClick={() => {
                setStripeEdit(null);
                setStripeOpen(true);
              }}
              data-testid="stripe-connect-open"
            >
              <Plus className="size-4" /> Add Stripe account
            </Button>
          }
        />
      </div>

      {/* Copyable redirect + webhook URLs the owner must register in each provider
          dashboard. Surfaced prominently so setup never requires opening a sheet. */}
      <section className="flex flex-col gap-3 rounded-[14px] border bg-card p-4 shadow-xs" data-testid="setup-endpoints">
        <div>
          <h3 className="text-[13.5px] font-semibold">Setup endpoints</h3>
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
            Register these in your Plaid and Stripe dashboards so OpenBooks receives real-time updates.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <WebhookField
            label="Stripe webhook URL"
            value={webhook?.stripeWebhookUrl ?? ""}
            hint="Add as a webhook endpoint in Stripe → Developers → Webhooks."
          />
          <WebhookField
            label="Plaid webhook URL"
            value={webhook?.plaidWebhookUrl ?? ""}
            hint="Set as your Plaid item webhook so syncs trigger on new activity."
          />
          <WebhookField
            label="Plaid redirect URI"
            value={webhook?.plaidRedirectUri ?? ""}
            hint="Add to your Plaid app's allowed redirect URIs for OAuth banks."
          />
          <WebhookField
            label="Stripe redirect URI"
            value={webhook?.stripeRedirectUri ?? ""}
            hint="Add to your Stripe Connect OAuth settings."
          />
        </div>
      </section>

      {/* Connected accounts, grouped by business. */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-normal text-muted-foreground/80">
            Connected accounts
          </h3>
          {totalAccounts ? (
            <span className="text-[12px] text-muted-foreground">
              {totalAccounts} across {grouped.length} {grouped.length === 1 ? "business" : "businesses"}
            </span>
          ) : null}
        </div>

        {totalAccounts === 0 ? (
          <EmptyState
            icon={Landmark}
            title="No accounts connected yet"
            description={
              plaidConfigured
                ? "Add a bank through Plaid or connect a Stripe account to start importing activity."
                : "Set up Plaid to connect banks, or add a Stripe account — each is attached to a business."
            }
            action={
              !plaidConfigured && stripeConnections.length === 0 ? (
                <Button size="sm" variant="outline" asChild data-testid="connections-onboarding-cta">
                  <Link href="/settings/businesses">Start with your businesses</Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-4" data-testid="connected-accounts">
            {grouped.map(({ business, banks, stripe }) => (
              <div key={business.id} className="rounded-[14px] border bg-card shadow-xs">
                <div className="flex items-center gap-2 border-b px-4 py-2.5">
                  <Building2 className="size-3.5 text-muted-foreground" />
                  <span className="text-[13px] font-semibold">{business.name}</span>
                </div>
                <div className="divide-y">
                  {banks.map((group) => {
                    const status = humanizeItemStatus(group.itemStatus);
                    const needsRelink = group.itemStatus === "relink_required";
                    return (
                      <div key={group.key} className="px-4 py-3" data-testid="bank-group">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <Landmark className="size-4 shrink-0 text-muted-foreground" />
                          <span className="text-sm font-medium">{group.institutionName}</span>
                          <StatusPill tone={status.tone}>{status.label}</StatusPill>
                          <span className="text-[11.5px] text-muted-foreground">{formatRelative(group.lastSyncedAt)}</span>
                          <div className="ml-auto flex items-center gap-1.5">
                            {needsRelink ? (
                              <Button
                                size="sm"
                                onClick={() => setAddBankOpen(true)}
                                data-testid="bank-reconnect"
                              >
                                <RefreshCw className="size-4" />
                                Reconnect
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === group.key}
                              onClick={() => runBankSync(group)}
                            >
                              <RefreshCw className={busy === group.key ? "size-4 animate-spin" : "size-4"} />
                              Sync
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon-sm" variant="ghost" aria-label="Bank actions">
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={() => runBankSync(group)}>
                                  <RefreshCw className="size-4" /> Sync now
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => runPlaidValidate(`validate:${group.key}`)}
                                  data-testid="plaid-validate-app"
                                >
                                  <ShieldCheck className="size-4" /> Validate Plaid app
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() =>
                                    setConfirm({
                                      title: `Disconnect ${group.institutionName}?`,
                                      description:
                                        "Syncing stops and the bank is unlinked at Plaid. Transactions already imported and your books stay exactly as they are.",
                                      cta: "Disconnect",
                                      action: async () => {
                                        await disconnectBank({ entityId: group.entityId, plaidItemId: group.plaidItemId });
                                        toast.success(`${group.institutionName} disconnected.`);
                                      },
                                    })
                                  }
                                >
                                  Disconnect bank
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        <div className="mt-2 grid gap-1.5 pl-7">
                          {group.accounts.map((account) => (
                            <div
                              key={String(account.id)}
                              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] bg-muted/30 px-2.5 py-1.5"
                            >
                              <span className="text-[12.5px]">{account.name}</span>
                              <span className="text-[11.5px] text-muted-foreground">
                                {account.kind} ••{account.mask}
                              </span>
                              <Amount
                                amountMinor={account.balanceMinor}
                                currency={account.currency}
                                className="text-[12.5px] font-medium"
                              />
                              {/* E5-T9: which business this account belongs to, editable. */}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="ml-auto h-7 px-2 text-[11.5px]"
                                    disabled={busy === `reassign:${String(account.id)}` || businesses.length < 2}
                                    data-testid="bank-business-select"
                                  >
                                    {account.entityName}
                                    <ChevronDown className="size-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  <DropdownMenuLabel>Business</DropdownMenuLabel>
                                  <DropdownMenuRadioGroup
                                    value={String(account.entityId)}
                                    onValueChange={(value) => reassignBankToBusiness(account, value)}
                                  >
                                    {businesses.map((business) => (
                                      <DropdownMenuRadioItem key={business.id} value={business.id}>
                                        {business.name}
                                      </DropdownMenuRadioItem>
                                    ))}
                                  </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                              </DropdownMenu>
                              <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                                <Switch
                                  checked={account.includeInSync}
                                  disabled={busy === `toggle:${String(account.id)}`}
                                  onCheckedChange={() => toggleAccountSync(account)}
                                  aria-label="Include in sync"
                                />
                                Sync
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {stripe.map((connection) => {
                    const status = humanizeConnectionStatus(connection.status);
                    const webhookStatus = humanizeWebhookStatus(connection.webhookStatus);
                    return (
                      <div key={String(connection.id)} className="px-4 py-3" data-testid="stripe-row">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                          <CreditCard className="size-4 shrink-0 text-muted-foreground" />
                          <span className="text-sm font-medium">{connection.displayName}</span>
                          <StatusPill tone={status.tone}>{status.label}</StatusPill>
                          {webhookStatus ? <StatusPill tone={webhookStatus.tone}>{webhookStatus.label}</StatusPill> : null}
                          <span className="text-[11.5px] text-muted-foreground">
                            {connection.credential?.keyPreview ?? "Saved key"} · {formatRelative(connection.lastSyncedAt)}
                          </span>
                          <div className="ml-auto flex items-center gap-1.5">
                            {/* E5-T9: which business this Stripe account belongs to, editable. */}
                            {connection.stripeAccountId ? (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 px-2 text-[11.5px]"
                                    disabled={busy === `reassign-stripe:${String(connection.id)}` || businesses.length < 2}
                                    data-testid="stripe-business-select"
                                  >
                                    {connection.entityName}
                                    <ChevronDown className="size-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  <DropdownMenuLabel>Business</DropdownMenuLabel>
                                  <DropdownMenuRadioGroup
                                    value={String(connection.entityId)}
                                    onValueChange={(value) => reassignStripeToBusiness(connection, value)}
                                  >
                                    {businesses.map((business) => (
                                      <DropdownMenuRadioItem key={business.id} value={business.id}>
                                        {business.name}
                                      </DropdownMenuRadioItem>
                                    ))}
                                  </DropdownMenuRadioGroup>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === String(connection.id)}
                              onClick={() => runStripeSync(connection)}
                            >
                              <RefreshCw className={busy === String(connection.id) ? "size-4 animate-spin" : "size-4"} />
                              Sync
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="icon-sm" variant="ghost" aria-label="Stripe actions">
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-44">
                                <DropdownMenuItem onClick={() => runStripeSync(connection)}>
                                  <RefreshCw className="size-4" /> Sync now
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => runStripeValidate(connection)}
                                  data-testid="stripe-validate-key"
                                >
                                  <ShieldCheck className="size-4" /> Validate key
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => runStripeVerify(connection)}
                                  data-testid="stripe-verify-webhook"
                                >
                                  <ShieldCheck className="size-4" /> Verify webhook
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setStripeEdit({ entityId: String(connection.entityId), label: connection.displayName });
                                    setStripeOpen(true);
                                  }}
                                >
                                  <Settings2 className="size-4" /> Update key
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() =>
                                    setConfirm({
                                      title: `Disconnect ${connection.displayName}?`,
                                      description:
                                        "Syncing stops for this Stripe account. Imported payments and your books stay as they are.",
                                      cta: "Disconnect",
                                      action: async () => {
                                        await disconnectStripe({ connectionId: connection.id });
                                        toast.success("Stripe account disconnected.");
                                      },
                                    })
                                  }
                                >
                                  Disconnect
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                        {connection.webhookStatus === "pending_verification" ? (
                          <p
                            className="mt-1.5 text-[11.5px] leading-5 text-warning"
                            data-testid="stripe-webhook-pending-hint"
                          >
                            Webhook secret saved but not verified yet. Register the endpoint in Stripe, then choose
                            “Verify webhook” — live payout, refund, and dispute updates stay off until it’s confirmed.
                          </p>
                        ) : connection.webhookStatus === "failing" ? (
                          <p className="mt-1.5 text-[11.5px] leading-5 text-negative">
                            Stripe sent an event we couldn’t verify. Re-copy the signing secret with “Update key”, then
                            “Verify webhook”.
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Email (Plunk) — same BYO-key treatment as Plaid/Stripe so every key the
          owner manages lives on one Connections surface (E3-T7). */}
      <PlunkConnectCard workspaceId={workspaceId ?? null} />

      <PlaidSetupSheet
        open={plaidSetupOpen}
        onOpenChange={setPlaidSetupOpen}
        plaidApp={data.plaidApp}
        liveEnabled={data.plaid.liveEnabled}
        webhookUrl={webhook?.plaidWebhookUrl ?? ""}
        redirectUri={webhook?.plaidRedirectUri ?? ""}
      />
      <AddBankSheet
        open={addBankOpen}
        onOpenChange={setAddBankOpen}
        businesses={businesses}
        defaultEntityId={defaultEntityId}
      />
      <StripeConnectSheet
        open={stripeOpen}
        onOpenChange={setStripeOpen}
        businesses={businesses}
        defaultEntityId={defaultEntityId}
        liveEnabled={data.stripe.liveEnabled}
        webhookUrl={webhook?.stripeWebhookUrl ?? ""}
        editing={stripeEdit}
      />

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => (!open ? setConfirm(null) : undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirm?.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmBusy}>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                void runConfirm();
              }}
              disabled={confirmBusy}
            >
              {confirmBusy ? <Loader2 className="size-4 animate-spin" /> : null}
              {confirm?.cta ?? "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
