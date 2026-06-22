"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  Building2,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Landmark,
  Mail,
  Plus,
  Sparkles,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { AiSection } from "@/components/openbooks/settings/AiSection";
import { AddBankSheet } from "@/components/openbooks/settings/connections/AddBankSheet";
import { StripeConnectSheet } from "@/components/openbooks/settings/connections/StripeConnectSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type BusinessType = "services" | "software" | "ecommerce" | "agency";
type InviteRole = "accountant" | "hr" | "admin" | "member";

// The wizard's visible step labels. The canonical id order lives in
// convex/onboarding.ts (ONBOARDING_STEP_ORDER) and drives the persisted,
// resumable progress record (Epic E4-T1). Step 0 (Business) bootstraps the
// workspace; every later step does REAL work against the live workspace.
const steps = [
  "Business",
  "AI",
  "Email",
  "Team",
  "Bank",
  "Stripe",
  "Opening balances",
  "Set up books",
  "Review & finish",
] as const;

// The canonical step ids (mirrors convex/onboarding.ts ONBOARDING_STEP_ORDER)
// used for markStep + resume. Index i here == index i in the visible `steps`
// array above (both begin at "business"/"Business"); `steps` adds a trailing
// "Finish" with no canonical id.
const STEP_ORDER = [
  "business",
  "ai",
  "plunk",
  "team",
  "plaid",
  "stripe",
  "openingBalances",
  "sync",
  "review",
] as const;

type OnboardingStepId = (typeof STEP_ORDER)[number];

const SETUP_GUIDE_HREF = "/setup";

const businessTypes: Array<{
  value: BusinessType;
  label: string;
  detail: string;
}> = [
  { value: "services", label: "Services", detail: "Simple revenue, contractors, travel, meals, and office spend." },
  { value: "software", label: "Software", detail: "Subscription revenue, cloud costs, payroll, and payment fees." },
  { value: "ecommerce", label: "E-commerce", detail: "Product sales, inventory, fulfillment, COGS, and fees." },
  { value: "agency", label: "Agency", detail: "Retainers, subcontractors, project expenses, and receivables." },
];

const inviteRoles: Array<{ value: InviteRole; label: string }> = [
  { value: "accountant", label: "Accountant" },
  { value: "hr", label: "HR / Payroll" },
];

let businessRowSeq = 0;
function newBusinessRow(): { id: number; name: string; businessType: BusinessType } {
  businessRowSeq += 1;
  return { id: businessRowSeq, name: "", businessType: "services" };
}

const landingForRole: Record<string, string> = {
  hr: "/payroll",
  member: "/payroll",
  accountant: "/dashboard",
  admin: "/dashboard",
  owner: "/dashboard",
};

export function OnboardingScreen({
  workspaceName,
  userName,
  joinedViaInvite,
  role,
}: {
  workspaceName?: string | null;
  userName?: string | null;
  joinedViaInvite?: boolean;
  role?: string | null;
}) {
  const router = useRouter();
  const bootstrapWorkspace = useMutation(api.onboarding.bootstrapWorkspace);
  const markStep = useMutation(api.onboarding.markStep);
  const setPhase = useMutation(api.onboarding.setPhase);
  const finishOnboarding = useMutation(api.onboarding.finishOnboarding);
  const inviteTeammate = useMutation(api.team.invite);

  // Live workspace context — populated once the business step bootstraps the
  // workspace, so the integration steps can do real work. These queries require
  // an existing workspace/membership, so they stay "skip" until the viewer
  // reports a workspace (before bootstrap there is nothing to read and the
  // server would reject the unauthorized read).
  const viewer = useQuery(api.session.viewer, {});
  const workspaceReady = Boolean(viewer?.workspace?.id);
  const workspaceId = (viewer?.workspace?.id ?? null) as Id<"workspaces"> | null;
  const entities = useQuery(api.entities.list, workspaceReady ? {} : "skip");
  const webhook = useQuery(api.connections.webhookConfig, workspaceReady ? {} : "skip");
  const connectionsData = useQuery(api.connections.list, workspaceReady ? {} : "skip");
  const progress = useQuery(api.onboarding.getProgress, workspaceReady ? {} : "skip");
  const aiProviderStatus = useQuery(
    api.ai.providerStatus,
    workspaceId ? { workspaceId } : "skip",
  );

  const businessRows = entities?.rows.filter((entity) => !entity.archived) ?? [];
  const firstEntityId = (businessRows[0]?.id ?? null) as Id<"entities"> | null;
  const connectionBusinesses = businessRows.map((entity) => ({ id: String(entity.id), name: entity.name }));
  const importedTransactionCount = businessRows.reduce(
    (sum, entity) => sum + (entity.transactionCount ?? 0),
    0,
  );
  const connectedBankCount = connectionsData?.bankAccounts?.length ?? 0;
  const connectedStripeCount =
    connectionsData?.connections?.filter((connection) => connection.provider === "stripe").length ?? 0;
  const existingSetupDetected =
    workspaceReady &&
    businessRows.length > 0 &&
    (importedTransactionCount > 0 || connectedBankCount > 0 || connectedStripeCount > 0);
  const aiReady = aiProviderStatus?.mode === "active";

  const [stepIndex, setStepIndex] = useState(0);
  const [businesses, setBusinesses] = useState(() => [newBusinessRow()]);
  const [currency, setCurrency] = useState("USD");

  // Resume support (Epic E4-T1): if the wizard is (re)mounted with a workspace
  // already in progress, jump to the saved current step ONCE so a reload — or an
  // AppShell re-render right after the business step bootstraps — never throws the
  // owner back to step 0. Runs a single time once progress first resolves.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    if (!progress || !progress.persisted) return;
    resumedRef.current = true;
    const settled = new Set([...progress.completedSteps, ...progress.skippedSteps]);
    // First step that hasn't been settled yet, in canonical order.
    const resumeId = STEP_ORDER.find((id) => !settled.has(id)) ?? null;
    const resumeIndex = resumeId ? STEP_ORDER.indexOf(resumeId) : steps.length - 1;
    if (resumeIndex > 0) {
      // Deliberate one-time sync of the wizard step to the persisted server
      // progress (resume), not a render-driven cascade — guarded by resumedRef.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStepIndex(resumeIndex);
    }
  }, [progress]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("accountant");
  const [invites, setInvites] = useState<Array<{ email: string; url: string }>>([]);
  const [inviteError, setInviteError] = useState("");
  const [inviting, setInviting] = useState(false);

  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");

  const [bankSheetOpen, setBankSheetOpen] = useState(false);
  const [stripeSheetOpen, setStripeSheetOpen] = useState(false);

  const hasWorkspace = Boolean(workspaceName);
  const namedBusinesses = businesses.filter((b) => b.name.trim().length >= 2);
  const canContinueBusiness = namedBusinesses.length >= 1 && /^[A-Z]{3}$/.test(currency);

  // An invited teammate joined an existing workspace and must NOT see business
  // creation (Epic E4-T6). They get a minimal "you've joined" confirmation and a
  // route to their role's landing instead of the full first-run.
  if (joinedViaInvite) {
    const target = landingForRole[role ?? ""] ?? "/dashboard";
    return (
      <main
        className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground"
        data-testid="onboarding-invited-confirmation"
      >
        <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-xs">
          <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Check className="size-5" />
          </span>
          <h1 className="mt-4 text-xl font-semibold">
            You&apos;ve joined {workspaceName ?? "the workspace"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your account is set up with {role ? `the ${role} role` : "your role"}. The workspace
            owner has already created the books — you can start working right away.
          </p>
          <Button
            className="mt-5 w-full"
            data-testid="onboarding-invited-continue"
            onClick={() => router.push(target)}
          >
            Continue to OpenBooks
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </main>
    );
  }

  function setRowName(id: number, name: string) {
    setBusinesses((rows) => rows.map((row) => (row.id === id ? { ...row, name } : row)));
  }
  function setRowType(id: number, businessType: BusinessType) {
    setBusinesses((rows) => rows.map((row) => (row.id === id ? { ...row, businessType } : row)));
  }
  function addBusinessRow() {
    setBusinesses((rows) => [...rows, newBusinessRow()]);
  }
  function removeBusinessRow(id: number) {
    setBusinesses((rows) => (rows.length <= 1 ? rows : rows.filter((row) => row.id !== id)));
  }

  function next() {
    setStepIndex((value) => Math.min(value + 1, steps.length - 1));
  }
  function back() {
    setStepIndex((value) => Math.max(value - 1, 0));
  }

  // Persist a step state into the resumable record (Epic E4-T1). Best-effort:
  // before the workspace exists there is no row to write, so it no-ops; once
  // bootstrapped every skip/complete persists for resume.
  async function persistStepState(step: OnboardingStepId, state: "complete" | "skipped") {
    try {
      await markStep({ step, state });
    } catch {
      // No workspace yet — the business step creates it; UI state still advances.
    }
  }

  // Step 0 -> create the workspace + businesses NOW so every later step does real
  // work (Epic E4-T4). Idempotent: bootstrapWorkspace no-ops on an existing
  // workspace, so re-entering the business step never duplicates.
  async function continueFromBusiness() {
    setStatus("submitting");
    setError("");
    try {
      const result = await bootstrapWorkspace({
        businesses: namedBusinesses.map((b) => ({
          name: b.name.trim(),
          businessType: b.businessType,
          currency,
        })),
      });
      if (result.alreadyOnboarded) {
        await completeExistingSetup();
        return;
      }
      await persistStepState("business", "complete");
      await setPhase({ phase: "setup" });
      setStatus("idle");
      next();
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "OpenBooks could not create your books.");
    }
  }

  async function addInvite() {
    const email = inviteEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setInviteError("Enter a valid email address.");
      return;
    }
    setInviting(true);
    setInviteError("");
    try {
      const result = await inviteTeammate({ email, role: inviteRole });
      setInvites((prev) => [...prev, { email, url: result.inviteUrl }]);
      setInviteEmail("");
    } catch (caught) {
      setInviteError(caught instanceof Error ? caught.message : "Could not create the invite.");
    } finally {
      setInviting(false);
    }
  }

  // Finish (Epic E4-T9): advance to the 'done' phase AND enqueue the AI
  // categorize/post bulk pass for every business so the owner lands on real,
  // ledger-backed numbers — not an empty shell. The `?setup=1` flag tells the
  // dashboard to show a "your books are being set up" state while the bulk pass
  // posts confident items and routes the rest to the Inbox.
  async function finish() {
    setStatus("submitting");
    setError("");
    try {
      const result = await finishOnboarding({});
      const route = result.businessesProcessing > 0 ? "/dashboard?setup=1" : "/dashboard";
      router.push(route);
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "OpenBooks could not finish setup.");
    }
  }

  async function completeExistingSetup() {
    setStatus("submitting");
    setError("");
    try {
      await setPhase({ phase: "done" });
      router.push("/dashboard");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "OpenBooks could not open your workspace.");
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground" data-testid="onboarding-screen">
      <div className="mx-auto grid min-h-screen w-full max-w-[1120px] gap-8 px-4 py-6 lg:grid-cols-[280px_1fr] lg:px-6">
        <aside className="self-start lg:sticky lg:top-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">
              ob
            </span>
            <div>
              <div className="text-sm font-semibold">open books</div>
              <div className="text-xs text-muted-foreground">
                {hasWorkspace ? "Guided setup" : "First workspace setup"}
              </div>
            </div>
          </div>
          <div className="mt-8 space-y-2">
            {steps.map((step, index) => {
              const complete = index < stepIndex;
              const active = index === stepIndex;
              return (
                <button
                  key={step}
                  type="button"
                  className={cn(
                    "flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-sm",
                    active && "bg-primary/10 text-primary",
                    !active && complete && "text-foreground",
                    !active && !complete && "text-muted-foreground",
                  )}
                  onClick={() => index <= stepIndex && setStepIndex(index)}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full border text-[11px]",
                      complete && "border-primary bg-primary text-primary-foreground",
                      active && "border-primary text-primary",
                    )}
                  >
                    {complete ? <Check className="size-3" /> : index + 1}
                  </span>
                  {step}
                </button>
              );
            })}
          </div>
        </aside>

        <section className="flex min-h-[640px] items-center">
          <div className="w-full rounded-lg border bg-card p-5 shadow-xs lg:p-7">
            {existingSetupDetected ? (
              <ExistingSetupShortcut
                businessCount={businessRows.length}
                transactionCount={importedTransactionCount}
                bankCount={connectedBankCount}
                stripeCount={connectedStripeCount}
                aiReady={aiReady}
                finishing={status === "submitting"}
                onContinue={() => void completeExistingSetup()}
              />
            ) : null}

            {stepIndex === 0 ? (
              <div className="grid gap-6" data-testid="onboarding-business-step">
                <div>
                  <p className="text-sm text-muted-foreground">Welcome{userName ? `, ${userName}` : ""}</p>
                  <h1 className="mt-1 text-2xl font-semibold">
                    {hasWorkspace ? "Create your businesses" : "Create your first set of books"}
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    Add one or more businesses. OpenBooks gives each its own typed chart of accounts
                    and keeps a separate ledger — the way separate LLCs are supposed to be kept. You
                    can roll them up later in Portfolio.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                  <div className="hidden md:block" />
                  <div className="grid gap-1.5">
                    <Label>Base currency</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger data-testid="onboarding-currency" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                        <SelectItem value="CAD">CAD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-4" data-testid="onboarding-business-rows">
                  {businesses.map((row, index) => (
                    <div
                      key={row.id}
                      className="grid gap-3 rounded-lg border bg-background p-4"
                      data-testid="onboarding-business-row"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor={`business-name-${row.id}`} className="text-sm">
                          Business {index + 1}
                        </Label>
                        {businesses.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            data-testid="onboarding-remove-business"
                            onClick={() => removeBusinessRow(row.id)}
                          >
                            <Trash2 className="size-4" />
                            Remove
                          </Button>
                        ) : null}
                      </div>
                      <Input
                        id={`business-name-${row.id}`}
                        data-testid={index === 0 ? "onboarding-business-name" : `onboarding-business-name-${index}`}
                        value={row.name}
                        onChange={(event) => setRowName(row.id, event.target.value)}
                        placeholder="Acme Studio LLC"
                      />
                      <div className="grid gap-2 sm:grid-cols-2">
                        {businessTypes.map((type) => (
                          <button
                            key={type.value}
                            type="button"
                            data-testid={index === 0 ? `onboarding-type-${type.value}` : `onboarding-type-${index}-${type.value}`}
                            className={cn(
                              "rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                              row.businessType === type.value && "border-primary bg-primary/5 ring-1 ring-primary/20",
                            )}
                            onClick={() => setRowType(row.id, type.value)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">{type.label}</span>
                              {row.businessType === type.value ? <Check className="size-4 text-primary" /> : null}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{type.detail}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {status === "error" ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="onboarding-add-business"
                    onClick={addBusinessRow}
                  >
                    <Plus className="size-4" />
                    Add another business
                  </Button>
                  <Button
                    data-testid="onboarding-next"
                    disabled={!canContinueBusiness || status === "submitting"}
                    onClick={continueFromBusiness}
                  >
                    {status === "submitting" ? "Creating your books" : "Create & continue"}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}

            {stepIndex === 1 ? (
              <StepFrame
                icon={Sparkles}
                title="Connect AI"
                body="Bring your own model key so OpenBooks can categorize your real transactions. With no key, bank rules and the Inbox still work, but AI categorization stays degraded until you add a key in Settings > AI."
                guideHref={SETUP_GUIDE_HREF}
                guideLabel="Open setup guide"
              >
                <div className="rounded-lg border bg-background p-3">
                  <AiSection entityId={firstEntityId} workspaceId={workspaceId} />
                </div>
                <SkipContinueRow
                  onBack={back}
                  onContinue={() => {
                    void persistStepState("ai", "complete");
                    next();
                  }}
                  continueLabel={aiReady ? "Continue with saved AI" : "I've added my key"}
                  onSkip={() => {
                    void persistStepState("ai", "skipped");
                    next();
                  }}
                  skipTestId="onboarding-ai-skip"
                  skipLabel="Skip AI for now"
                />
              </StepFrame>
            ) : null}

            {stepIndex === 2 ? (
              <PlunkStep
                workspaceId={workspaceId}
                onSkip={() => {
                  void persistStepState("plunk", "skipped");
                  next();
                }}
                onComplete={() => {
                  void persistStepState("plunk", "complete");
                  next();
                }}
                onBack={back}
              />
            ) : null}

            {stepIndex === 3 ? (
              <div className="grid gap-6" data-testid="onboarding-team-step">
                <div className="flex items-start gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Users className="size-5" />
                  </span>
                  <div>
                    <h1 className="text-2xl font-semibold">Invite your team</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                      Invite an accountant or HR/payroll teammate. They get their own login and a
                      role-scoped view. Copy each invite link to share it — you can always invite
                      more later from Settings.
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 rounded-lg border bg-background p-4">
                  <div className="grid gap-3 sm:grid-cols-[1fr_160px_auto]">
                    <div className="grid gap-1.5">
                      <Label htmlFor="invite-email">Teammate email</Label>
                      <Input
                        id="invite-email"
                        data-testid="onboarding-invite-email"
                        value={inviteEmail}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="teammate@company.com"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Role</Label>
                      <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as InviteRole)}>
                        <SelectTrigger data-testid="onboarding-invite-role" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {inviteRoles.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        data-testid="onboarding-invite-add"
                        disabled={inviting}
                        onClick={addInvite}
                      >
                        {inviting ? "Inviting…" : "Create invite"}
                      </Button>
                    </div>
                  </div>
                  {inviteError ? (
                    <p className="text-sm text-destructive" data-testid="onboarding-invite-error">
                      {inviteError}
                    </p>
                  ) : null}
                </div>

                {invites.length > 0 ? (
                  <div className="grid gap-2" data-testid="onboarding-invite-list">
                    {invites.map((invite) => (
                      <div
                        key={invite.email}
                        className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 text-sm"
                        data-testid="onboarding-invite-row"
                      >
                        <span className="font-medium">{invite.email}</span>
                        <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground" data-testid="onboarding-invite-url">
                          {invite.url}
                        </code>
                        <CopyButton value={invite.url} testId="onboarding-invite-copy" />
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                  <Button variant="outline" onClick={back}>
                    Back
                  </Button>
                  <Button
                    data-testid="onboarding-team-continue"
                    onClick={() => {
                      void persistStepState("team", invites.length > 0 ? "complete" : "skipped");
                      next();
                    }}
                  >
                    {invites.length > 0 ? "Continue" : "Skip for now"}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}

            {stepIndex === 4 ? (
              <ConnectStep
                icon={Landmark}
                title="Connect bank data"
                body="Connect through Plaid so OpenBooks syncs your transactions and books an opening balance. One Plaid login can span multiple businesses — you'll map each account to the right business. No keys yet? Skip and start from a CSV import."
                guideHref={SETUP_GUIDE_HREF}
                guideLabel="Open Plaid setup guide"
                urls={[
                  { label: "Plaid redirect URI", value: webhook?.plaidRedirectUri ?? "" },
                  { label: "Plaid webhook URL", value: webhook?.plaidWebhookUrl ?? "" },
                ]}
                connectTestId="onboarding-bank-connect"
                skipTestId="onboarding-bank-skip"
                skipLabel="Use CSV for now"
                onConnect={() => setBankSheetOpen(true)}
                onSkip={() => {
                  void persistStepState("plaid", "skipped");
                  next();
                }}
                onContinue={() => {
                  void persistStepState("plaid", "complete");
                  next();
                }}
                continueLabel="Bank connected — continue"
                connected={Boolean(connectionsData?.bankAccounts?.length)}
                onBack={back}
              />
            ) : null}

            {stepIndex === 5 ? (
              <ConnectStep
                icon={CreditCard}
                title="Connect Stripe"
                body="Stripe adds payments, fees, and payout reconciliation per business. Connecting requires registering and verifying the webhook below before the connection reports as listening. You can skip and connect later from Settings."
                guideHref={SETUP_GUIDE_HREF}
                guideLabel="Open Stripe setup guide"
                urls={[{ label: "Stripe webhook URL", value: webhook?.stripeWebhookUrl ?? "" }]}
                connectTestId="onboarding-stripe-connect"
                skipTestId="onboarding-stripe-skip"
                skipLabel="Skip Stripe for now"
                onConnect={() => setStripeSheetOpen(true)}
                onSkip={() => {
                  void persistStepState("stripe", "skipped");
                  next();
                }}
                onContinue={() => {
                  void persistStepState("stripe", "complete");
                  next();
                }}
                continueLabel="Stripe connected — continue"
                connected={Boolean(
                  connectionsData?.connections?.some((c) => c.provider === "stripe"),
                )}
                onBack={back}
              />
            ) : null}

            {stepIndex === 6 ? (
              <OpeningBalancesStep
                businesses={businessRows.map((b) => ({ id: b.id as Id<"entities">, name: b.name }))}
                onSkip={() => {
                  void persistStepState("openingBalances", "skipped");
                  next();
                }}
                onComplete={() => {
                  void persistStepState("openingBalances", "complete");
                  next();
                }}
                onBack={back}
              />
            ) : null}

            {stepIndex === 7 ? (
              <SyncStep
                businesses={businessRows.map((b) => ({ id: b.id as Id<"entities">, name: b.name }))}
                onSkip={() => {
                  void persistStepState("sync", "skipped");
                  next();
                }}
                onComplete={() => {
                  void persistStepState("sync", "complete");
                  next();
                }}
                onBack={back}
              />
            ) : null}

            {stepIndex === 8 ? (
              <ReviewStep
                businesses={businessRows.map((b) => ({ id: b.id as Id<"entities">, name: b.name }))}
                businessCount={businessRows.length}
                invites={invites.length}
                connectionsData={connectionsData}
                finishing={status === "submitting"}
                error={status === "error" ? error : ""}
                onFinish={async () => {
                  await persistStepState("review", "complete");
                  await finish();
                }}
                onBack={back}
              />
            ) : null}
          </div>
        </section>
      </div>

      {/* Reuse the Settings connection sheets so Plaid Link + per-account
          mapping and Stripe OAuth + webhook verification are not duplicated. */}
      {workspaceId ? (
        <>
          <AddBankSheet
            open={bankSheetOpen}
            onOpenChange={setBankSheetOpen}
            businesses={connectionBusinesses}
            defaultEntityId={String(firstEntityId ?? "")}
          />
          <StripeConnectSheet
            open={stripeSheetOpen}
            onOpenChange={setStripeSheetOpen}
            businesses={connectionBusinesses}
            defaultEntityId={String(firstEntityId ?? "")}
            liveEnabled={Boolean(connectionsData?.stripe?.liveEnabled)}
            webhookUrl={webhook?.stripeWebhookUrl ?? ""}
            editing={null}
          />
        </>
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Shared step chrome
// ---------------------------------------------------------------------------

function StepFrame({
  icon: Icon,
  title,
  body,
  guideHref,
  guideLabel,
  children,
}: {
  icon: typeof Building2;
  title: string;
  body: string;
  guideHref?: string;
  guideLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-6">
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{body}</p>
          {guideHref ? <GuideLink href={guideHref} label={guideLabel ?? "How to set this up"} /> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

function GuideLink({ href, label }: { href: string; label: string }) {
  const external = /^https?:\/\//.test(href);
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      data-testid="onboarding-guide-link"
    >
      {label}
      <ExternalLink className="size-3.5" />
    </a>
  );
}

function ExistingSetupShortcut({
  businessCount,
  transactionCount,
  bankCount,
  stripeCount,
  aiReady,
  finishing,
  onContinue,
}: {
  businessCount: number;
  transactionCount: number;
  bankCount: number;
  stripeCount: number;
  aiReady: boolean;
  finishing: boolean;
  onContinue: () => void;
}) {
  return (
    <div
      className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4"
      data-testid="onboarding-existing-setup"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-foreground">Existing local setup found</div>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            OpenBooks already sees real books for this workspace. Continue to the product now and
            treat any unfinished setup steps as a Settings checklist.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border bg-background px-2.5 py-1">
              {businessCount} {businessCount === 1 ? "business" : "businesses"}
            </span>
            <span className="rounded-full border bg-background px-2.5 py-1">
              {transactionCount.toLocaleString()} transactions
            </span>
            <span className="rounded-full border bg-background px-2.5 py-1">
              {bankCount} bank {bankCount === 1 ? "account" : "accounts"}
            </span>
            <span className="rounded-full border bg-background px-2.5 py-1">
              {stripeCount} Stripe {stripeCount === 1 ? "connection" : "connections"}
            </span>
            <span className="rounded-full border bg-background px-2.5 py-1">
              AI {aiReady ? "active" : "not active"}
            </span>
          </div>
        </div>
        <Button
          type="button"
          className="shrink-0"
          data-testid="onboarding-use-existing-setup"
          disabled={finishing}
          onClick={onContinue}
        >
          {finishing ? "Opening product" : "Use existing setup"}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function CopyButton({ value, testId }: { value: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid={testId}
      disabled={!value}
      onClick={() => {
        if (!value) return;
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function UrlPanel({ urls }: { urls: Array<{ label: string; value: string }> }) {
  const present = urls.filter((url) => url.value);
  if (present.length === 0) return null;
  return (
    <div className="grid gap-2 rounded-lg border bg-background p-4" data-testid="onboarding-url-panel">
      <div className="text-sm font-medium">Register these URLs in the provider dashboard</div>
      {present.map((url) => (
        <div key={url.label} className="flex flex-wrap items-center gap-2 text-sm">
          <span className="w-44 shrink-0 text-muted-foreground">{url.label}</span>
          <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
            {url.value}
          </code>
          <CopyButton value={url.value} testId={`onboarding-copy-${url.label.replace(/\s+/g, "-").toLowerCase()}`} />
        </div>
      ))}
    </div>
  );
}

function SkipContinueRow({
  onBack,
  onContinue,
  continueLabel,
  onSkip,
  skipTestId,
  skipLabel,
  continueTestId,
  continueDisabled,
}: {
  onBack: () => void;
  onContinue: () => void;
  continueLabel: string;
  onSkip: () => void;
  skipTestId: string;
  skipLabel: string;
  continueTestId?: string;
  continueDisabled?: boolean;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
      <Button variant="outline" onClick={onBack}>
        Back
      </Button>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button variant="ghost" data-testid={skipTestId} onClick={onSkip}>
          {skipLabel}
        </Button>
        <Button data-testid={continueTestId} disabled={continueDisabled} onClick={onContinue}>
          {continueLabel}
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plaid / Stripe connect step (reuses the Settings sheets via a callback)
// ---------------------------------------------------------------------------

function ConnectStep({
  icon,
  title,
  body,
  guideHref,
  guideLabel,
  urls,
  connectTestId,
  skipTestId,
  skipLabel,
  onConnect,
  onSkip,
  onContinue,
  continueLabel,
  connected,
  onBack,
}: {
  icon: typeof Building2;
  title: string;
  body: string;
  guideHref: string;
  guideLabel: string;
  urls: Array<{ label: string; value: string }>;
  connectTestId: string;
  skipTestId: string;
  skipLabel: string;
  onConnect: () => void;
  onSkip: () => void;
  onContinue: () => void;
  continueLabel: string;
  connected: boolean;
  onBack: () => void;
}) {
  return (
    <StepFrame icon={icon} title={title} body={body} guideHref={guideHref} guideLabel={guideLabel}>
      <UrlPanel urls={urls} />
      <div className="rounded-lg border bg-background p-4">
        <Button data-testid={connectTestId} onClick={onConnect}>
          Connect now
        </Button>
        {connected ? (
          <p className="mt-2 text-sm text-primary" data-testid="onboarding-connected-note">
            Connected — you can map accounts to businesses, then continue.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Skipping keeps this in your resumable setup checklist until you complete it.
          </p>
        )}
      </div>
      <SkipContinueRow
        onBack={onBack}
        onContinue={onContinue}
        continueLabel={continueLabel}
        continueDisabled={!connected}
        onSkip={onSkip}
        skipTestId={skipTestId}
        skipLabel={skipLabel}
      />
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Plunk (workspace email) step
// ---------------------------------------------------------------------------

function PlunkStep({
  workspaceId,
  onSkip,
  onComplete,
  onBack,
}: {
  workspaceId: Id<"workspaces"> | null;
  onSkip: () => void;
  onComplete: () => void;
  onBack: () => void;
}) {
  const savePlunk = useAction(api.plunk.savePlunkCredential);
  const [secretKey, setSecretKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!workspaceId || !secretKey.trim()) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await savePlunk({
        workspaceId,
        secretKey: secretKey.trim(),
        ...(fromEmail.trim() ? { fromEmail: fromEmail.trim() } : {}),
      });
      setSaved(true);
      setMessage(result.message || "Saved your email key.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not save the email key.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <StepFrame
      icon={Mail}
      title="Connect email (Plunk)"
      body="OpenBooks sends invites, access notices, and the weekly digest through Plunk. Paste your Plunk secret key to send from your own domain. Skip to use the built-in default until you're ready."
      guideHref="https://docs.useplunk.com/api-reference/authentication"
      guideLabel="Where to find your Plunk secret key"
    >
      <div className="grid gap-3 rounded-lg border bg-background p-4">
        <div className="grid gap-1.5">
          <Label htmlFor="plunk-key">Plunk secret key</Label>
          <Input
            id="plunk-key"
            type="password"
            data-testid="onboarding-plunk-key"
            value={secretKey}
            onChange={(event) => setSecretKey(event.target.value)}
            placeholder="sk_..."
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="plunk-from">From email (optional)</Label>
          <Input
            id="plunk-from"
            data-testid="onboarding-plunk-from"
            value={fromEmail}
            onChange={(event) => setFromEmail(event.target.value)}
            placeholder="hello@yourdomain.com"
          />
        </div>
        <div>
          <Button
            type="button"
            data-testid="onboarding-plunk-save"
            disabled={!workspaceId || saving || !secretKey.trim()}
            onClick={save}
          >
            {saving ? "Saving…" : "Save email key"}
          </Button>
        </div>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </div>
      <SkipContinueRow
        onBack={onBack}
        onContinue={onComplete}
        continueLabel="Continue"
        continueDisabled={!saved}
        onSkip={onSkip}
        skipTestId="onboarding-plunk-skip"
        skipLabel="Skip email for now"
      />
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Opening balances step (E4-T5)
// ---------------------------------------------------------------------------

function dollarsToMinor(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  if (!/^-?\d+(\.\d{0,2})?$/.test(trimmed)) return null;
  return Math.round(parseFloat(trimmed) * 100);
}

function OpeningBalancesStep({
  businesses,
  onSkip,
  onComplete,
  onBack,
}: {
  businesses: Array<{ id: Id<"entities">; name: string }>;
  onSkip: () => void;
  onComplete: () => void;
  onBack: () => void;
}) {
  const setOpeningBalances = useMutation(api.onboarding.setOpeningBalances);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [startDate, setStartDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const lines = businesses
        .map((business) => {
          const minor = dollarsToMinor(amounts[String(business.id)] ?? "");
          return minor === null ? null : { entityId: business.id, balanceMinor: minor };
        })
        .filter((line): line is { entityId: Id<"entities">; balanceMinor: number } => line !== null)
        .filter((line) => line.balanceMinor !== 0)
        .map((line) => ({ ...line, ...(startDate ? { startDate } : {}) }));
      if (lines.length === 0) {
        setMessage("Enter an opening balance for at least one business, or skip.");
        setSaving(false);
        return;
      }
      await setOpeningBalances({ lines });
      onComplete();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not set opening balances.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <StepFrame
      icon={Wallet}
      title="Set opening balances"
      body="Enter each business's starting cash balance in USD so your balance sheet is correct from day one. OpenBooks books a balanced opening entry against Opening Balance Equity, dated the first of your start month. Amounts are USD only."
    >
      <div className="grid gap-3 rounded-lg border bg-background p-4" data-testid="onboarding-opening-balances">
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="opening-start">Start my books on (optional)</Label>
          <Input
            id="opening-start"
            type="date"
            data-testid="onboarding-opening-start"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </div>
        {businesses.map((business) => (
          <div key={String(business.id)} className="grid gap-1.5 sm:grid-cols-[1fr_200px] sm:items-center">
            <span className="text-sm font-medium">{business.name}</span>
            <Input
              data-testid={`onboarding-opening-amount-${String(business.id)}`}
              inputMode="decimal"
              value={amounts[String(business.id)] ?? ""}
              onChange={(event) =>
                setAmounts((prev) => ({ ...prev, [String(business.id)]: event.target.value }))
              }
              placeholder="0.00"
            />
          </div>
        ))}
        {message ? <p className="text-sm text-destructive">{message}</p> : null}
      </div>
      <SkipContinueRow
        onBack={onBack}
        onContinue={save}
        continueLabel={saving ? "Saving…" : "Set opening balances"}
        continueTestId="onboarding-opening-save"
        continueDisabled={saving}
        onSkip={onSkip}
        skipTestId="onboarding-opening-skip"
        skipLabel="Skip for now"
      />
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// AI bulk-setup (sync) step (E4-T7)
// ---------------------------------------------------------------------------

function SyncStep({
  businesses,
  onSkip,
  onComplete,
  onBack,
}: {
  businesses: Array<{ id: Id<"entities">; name: string }>;
  onSkip: () => void;
  onComplete: () => void;
  onBack: () => void;
}) {
  const generate = useAction(api.onboardingProposals.generateOnboardingProposals);
  const [startDate, setStartDate] = useState("");
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);

  async function run() {
    setRunning(true);
    setMessage("");
    try {
      let total = 0;
      for (const business of businesses) {
        const result = await generate({
          entityId: business.id,
          ...(startDate ? { startDate } : {}),
        });
        total += result.proposalCount;
      }
      setDone(true);
      setMessage(`OpenBooks drafted ${total} suggestion${total === 1 ? "" : "s"} for your review.`);
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not run the AI setup pass.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <StepFrame
      icon={Sparkles}
      title="Let AI set up your books"
      body="OpenBooks reviews your synced history, clusters your recurring income and expenses, and drafts income streams, categories, and rules for you to review. Choose how far back to start, or let it pull everything the connector gives."
    >
      <div className="grid gap-3 rounded-lg border bg-background p-4" data-testid="onboarding-sync-step">
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label htmlFor="sync-start">Start my books on (optional)</Label>
          <Input
            id="sync-start"
            type="date"
            data-testid="onboarding-sync-start"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to pull as much history as your connector returns.
          </p>
        </div>
        <div>
          <Button type="button" data-testid="onboarding-sync-run" disabled={running} onClick={run}>
            {running ? "Reviewing your history…" : "Review my history"}
          </Button>
        </div>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </div>
      <SkipContinueRow
        onBack={onBack}
        onContinue={onComplete}
        continueLabel="Review suggestions"
        continueDisabled={!done}
        onSkip={onSkip}
        skipTestId="onboarding-sync-skip"
        skipLabel="Skip for now"
      />
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// Proposal review/approve step (E4-T8)
// ---------------------------------------------------------------------------

const PROPOSAL_GROUP_LABELS: Record<string, string> = {
  incomeStream: "Income streams",
  category: "Expense categories",
  rule: "Categorization rules",
};

function ReviewStep({
  businesses,
  businessCount,
  invites,
  connectionsData,
  finishing,
  error,
  onFinish,
  onBack,
}: {
  businesses: Array<{ id: Id<"entities">; name: string }>;
  businessCount: number;
  invites: number;
  connectionsData:
    | {
        bankAccounts?: Array<unknown>;
        connections?: Array<{ provider: string }>;
      }
    | undefined;
  finishing: boolean;
  error: string;
  onFinish: () => void | Promise<void>;
  onBack: () => void;
}) {
  const [activeEntity, setActiveEntity] = useState<Id<"entities"> | null>(businesses[0]?.id ?? null);
  const entityId = activeEntity ?? businesses[0]?.id ?? null;
  const proposals = useQuery(
    api.onboardingProposals.listOnboardingProposals,
    entityId ? { entityId } : "skip",
  );
  const questions = useQuery(
    api.onboardingProposals.listOnboardingQuestions,
    entityId ? { entityId } : "skip",
  );
  const approve = useMutation(api.onboardingProposals.approveOnboardingProposal);
  const reject = useMutation(api.onboardingProposals.rejectOnboardingProposal);
  const answerQuestion = useMutation(api.onboardingProposals.answerOnboardingQuestion);
  const completeReview = useMutation(api.onboardingProposals.completeProposalReview);

  const open = (proposals ?? []).filter((p) => p.status === "proposed");
  const approvedCount = (proposals ?? []).filter((p) => p.status === "confirmed").length;
  const grouped = open.reduce<Record<string, typeof open>>((acc, proposal) => {
    (acc[proposal.kind] ??= []).push(proposal);
    return acc;
  }, {});

  async function approveAll() {
    for (const proposal of open) {
      await approve({ proposalId: proposal.id });
    }
  }

  async function finishReview() {
    // Mark proposalsReviewed + advance phase to 'done' (E4-T8 DoD), then let the
    // parent set phase done (idempotent) and route to the populated dashboard.
    await completeReview({});
    await onFinish();
  }

  return (
    <StepFrame
      icon={Check}
      title="Review what AI proposed"
      body="AI proposes, you approve — the ledger only books what you confirm. Approve the income streams, categories, and rules that look right, edit or reject the rest, then finish."
    >
      {businesses.length > 1 ? (
        <div className="grid gap-1.5 sm:max-w-xs">
          <Label>Business</Label>
          <Select
            value={String(entityId ?? "")}
            onValueChange={(value) => setActiveEntity(value as Id<"entities">)}
          >
            <SelectTrigger data-testid="onboarding-review-business" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {businesses.map((business) => (
                <SelectItem key={String(business.id)} value={String(business.id)}>
                  {business.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {questions && questions.length > 0 ? (
        <div className="grid gap-2 rounded-lg border bg-background p-4" data-testid="onboarding-questions">
          <div className="text-sm font-medium">A few quick questions</div>
          {questions.map((question) => (
            <div key={question.id} className="grid gap-1.5 sm:grid-cols-[1fr_220px] sm:items-center">
              <span className="text-sm text-muted-foreground">{question.prompt}</span>
              <Input
                data-testid={`onboarding-question-${question.key}`}
                defaultValue={question.answer ?? ""}
                placeholder="Your answer"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value && value !== (question.answer ?? "")) {
                    void answerQuestion({ questionId: question.id, answer: value });
                  }
                }}
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4" data-testid="onboarding-proposals">
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground" data-testid="onboarding-proposals-empty">
            No suggestions to review. You can always add income streams and rules later in Settings.
          </p>
        ) : (
          Object.entries(grouped).map(([kind, items]) => (
            <div key={kind} className="grid gap-2">
              <div className="text-sm font-medium">{PROPOSAL_GROUP_LABELS[kind] ?? kind}</div>
              {items.map((proposal) => (
                <div
                  key={proposal.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 text-sm"
                  data-testid="onboarding-proposal-row"
                >
                  <span className="flex-1">{proposal.summary}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="onboarding-proposal-approve"
                    onClick={() => void approve({ proposalId: proposal.id })}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid="onboarding-proposal-reject"
                    onClick={() => void reject({ proposalId: proposal.id })}
                  >
                    Reject
                  </Button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      <FirstRunSummary
        businessCount={businessCount}
        connectionsData={connectionsData}
        invites={invites}
        approvedProposals={approvedCount}
        entityId={entityId}
      />

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {open.length > 0 ? (
            <Button variant="ghost" data-testid="onboarding-approve-all" onClick={() => void approveAll()}>
              Approve all
            </Button>
          ) : null}
          <Button
            data-testid="onboarding-finish"
            disabled={finishing}
            onClick={() => void finishReview()}
          >
            {finishing ? "Finishing" : "Finish & go to dashboard"}
            <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </StepFrame>
  );
}

// ---------------------------------------------------------------------------
// First-run summary
// ---------------------------------------------------------------------------

function FirstRunSummary({
  businessCount,
  connectionsData,
  invites,
  approvedProposals,
  entityId,
}: {
  businessCount: number;
  connectionsData:
    | {
        bankAccounts?: Array<unknown>;
        connections?: Array<{ provider: string }>;
      }
    | undefined;
  invites: number;
  approvedProposals: number;
  entityId: Id<"entities"> | null;
}) {
  const banks = connectionsData?.bankAccounts?.length ?? 0;
  const stripe = connectionsData?.connections?.filter((c) => c.provider === "stripe").length ?? 0;
  // Posted-vs-inbox for the active business, read from the SAME dashboard
  // read-model the populated org will show (E4-T9 DoD). Reflects whatever the
  // ledger holds now; the finish handler's bulk pass moves more rows from Inbox
  // to posted after the owner lands on the dashboard.
  const dashboard = useQuery(api.coreViews.dashboard, entityId ? { entityId } : "skip");
  const totalTxns = dashboard?.readStats?.transactions ?? null;
  const inbox = dashboard?.inbox?.openCount ?? null;
  const posted = totalTxns === null || inbox === null ? null : Math.max(0, totalTxns - inbox);
  return (
    <div className="grid gap-3 rounded-lg border bg-background p-4 text-sm" data-testid="onboarding-summary">
      <SummaryRow label="Businesses" value={String(businessCount)} />
      <SummaryRow label="Bank accounts" value={String(banks)} />
      <SummaryRow label="Stripe connections" value={String(stripe)} />
      <SummaryRow label="Teammates invited" value={String(invites)} />
      <SummaryRow label="Suggestions approved" value={String(approvedProposals)} />
      <SummaryRow
        label="Posted vs Inbox"
        value={posted === null || inbox === null ? "—" : `${posted} posted · ${inbox} in Inbox`}
      />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b py-2 last:border-b-0 sm:grid-cols-[160px_1fr]">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
