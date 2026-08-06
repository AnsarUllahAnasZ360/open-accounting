"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { getErrorMessage } from "@/lib/errors";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Inbox,
  Landmark,
  LayoutDashboard,
  Loader2,
  Mail,
  Plus,
  Receipt,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Wallet,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { toast } from "sonner";
import { AiSection } from "@/components/openbooks/settings/AiSection";
import { AddBankSheet } from "@/components/openbooks/settings/connections/AddBankSheet";
import { StripeConnectSheet } from "@/components/openbooks/settings/connections/StripeConnectSheet";
import {
  FieldLabel,
  SecretInput,
  WebhookField,
} from "@/components/openbooks/settings/connections/shared";
import type { PlaidAppSummary } from "@/components/openbooks/settings/connections/PlaidSetupSheet";
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
type LegalStructure = "sole_prop" | "llc" | "corp" | "partnership";
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
  {
    value: "services",
    label: "Services",
    detail: "Simple revenue, contractors, travel, meals, and office spend.",
  },
  {
    value: "software",
    label: "Software",
    detail: "Subscription revenue, cloud costs, payroll, and payment fees.",
  },
  {
    value: "ecommerce",
    label: "E-commerce",
    detail: "Product sales, inventory, fulfillment, COGS, and fees.",
  },
  {
    value: "agency",
    label: "Agency",
    detail: "Retainers, subcontractors, project expenses, and receivables.",
  },
];

const legalStructures: Array<{
  value: LegalStructure;
  label: string;
  detail: string;
  entityTypeLabel: string;
}> = [
  {
    value: "sole_prop",
    label: "Sole Proprietor",
    detail: "No formal entity; you and the business are one.",
    entityTypeLabel: "Sole Proprietor",
  },
  {
    value: "llc",
    label: "LLC",
    detail: "Separate legal entity with flexible tax treatment.",
    entityTypeLabel: "LLC",
  },
  {
    value: "corp",
    label: "S-Corp / C-Corp",
    detail: "Corporation structure for investors or staff equity.",
    entityTypeLabel: "S-Corp / C-Corp",
  },
  {
    value: "partnership",
    label: "Partnership",
    detail: "Two or more owners sharing profit and liability.",
    entityTypeLabel: "Partnership",
  },
];

const inviteRoles: Array<{ value: InviteRole; label: string }> = [
  { value: "accountant", label: "Accountant" },
  { value: "hr", label: "HR / Payroll" },
];

let businessRowSeq = 0;
function newBusinessRow(): {
  id: number;
  name: string;
  businessType: BusinessType;
  legalStructure?: LegalStructure;
  logoStorageId?: Id<"_storage">;
  logoPreview?: string;
} {
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

// Capability pills shown on the welcome splash — each maps to a real OpenBooks
// surface. Tones alternate brand-green / neutral-ink to stay quiet and on-brand
// (no rainbow), echoing the focused "here's what you're setting up" intro.
const WELCOME_PILLS: Array<{
  label: string;
  icon: typeof Building2;
  tone: string;
}> = [
  {
    label: "Dashboard",
    icon: LayoutDashboard,
    tone: "bg-primary/10 text-primary",
  },
  {
    label: "Inbox review",
    icon: Inbox,
    tone: "bg-foreground/10 text-foreground",
  },
  {
    label: "Income & invoices",
    icon: Receipt,
    tone: "bg-primary/10 text-primary",
  },
  {
    label: "Expenses & bills",
    icon: Wallet,
    tone: "bg-foreground/10 text-foreground",
  },
  { label: "Contacts", icon: Users, tone: "bg-primary/10 text-primary" },
  {
    label: "Payroll",
    icon: Landmark,
    tone: "bg-foreground/10 text-foreground",
  },
  { label: "Reports", icon: BarChart3, tone: "bg-primary/10 text-primary" },
  {
    label: "AI copilot",
    icon: Sparkles,
    tone: "bg-foreground/10 text-foreground",
  },
];

// Optional business-logo control for an onboarding business row: a thumbnail
// preview + upload/replace/remove. Self-contained file input; the async upload
// is handled by the parent (which owns the upload URL + row state).
function OnboardingLogoField({
  logoPreview,
  onUpload,
  onRemove,
}: {
  logoPreview?: string;
  onUpload: (file: File) => Promise<void>;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex shrink-0 flex-col items-center gap-2">
      <div className="relative">
        {/* Dashed border upload box */}
        <div
          onClick={() => inputRef.current?.click()}
          className="flex size-24 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 transition-all hover:border-primary/50 hover:bg-primary/10"
          data-testid="onboarding-logo-placeholder"
        >
          {logoPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoPreview}
              alt="Business logo preview"
              className="size-full object-contain rounded-lg"
            />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10">
              <Building2 className="size-7 text-primary" />
            </div>
          )}
        </div>

        {/* Green "+" button overlay - only show when no logo is uploaded */}
        {!logoPreview ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className="absolute bottom-4 right-4 flex size-5 items-center justify-center rounded-full bg-primary text-white shadow-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
            aria-label="Upload logo"
            data-testid="onboarding-logo-upload"
          >
            <Plus className="size-4 font-bold" />
          </button>
        ) : null}
      </div>

      {logoPreview ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-2 py-1 text-xs text-muted-foreground"
          disabled={busy}
          data-testid="onboarding-logo-remove"
          onClick={onRemove}
        >
          Remove
        </Button>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            await onUpload(file);
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

// First-run welcome splash (shown once, before step 0). Brand mark + plain-English
// pitch + a single "Let's get started" CTA that reveals the guided wizard. No
// progress bar here — it's an intro, not a step.
function WelcomeSplash({
  userName,
  onStart,
}: {
  userName?: string | null;
  onStart: () => void;
}) {
  return (
    <main
      className="min-h-screen bg-background text-foreground"
      data-testid="onboarding-welcome"
    >
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-8 lg:px-10">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            ob
          </span>
          <span className="text-base font-semibold tracking-tight">
            open books
          </span>
        </div>

        <div className="flex flex-1 items-center py-10">
          <div className="grid w-full items-center gap-10 lg:grid-cols-2">
            <div className="ob-animate-in">
              <p className="text-sm font-semibold text-primary">
                Welcome{userName ? `, ${userName}` : ""}!
              </p>
              <h1 className="mt-3 max-w-xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
                Set up your books fast with AI
              </h1>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground">
                OpenBooks connects your accounts, learns your categories, and
                keeps a clean double-entry ledger behind the scenes. AI proposes
                — you confirm — and your reports stay right.
              </p>
              <Button
                size="lg"
                className="mt-7"
                data-testid="onboarding-welcome-start"
                onClick={onStart}
              >
                Let&apos;s get started
                <ArrowRight className="size-4" />
              </Button>
            </div>

            <div className="flex flex-wrap justify-center gap-2.5 lg:justify-end">
              {WELCOME_PILLS.map((pill, index) => (
                <span
                  key={pill.label}
                  className="ob-animate-in inline-flex items-center gap-2 rounded-full border bg-card px-3.5 py-2 text-sm font-medium shadow-xs"
                  style={{ animationDelay: `${80 + index * 55}ms` }}
                >
                  <span
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full",
                      pill.tone,
                    )}
                  >
                    <pill.icon className="size-3.5" />
                  </span>
                  {pill.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

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
  const generateLogoUploadUrl = useMutation(
    api.onboarding.generateLogoUploadUrl,
  );
  const archiveEntity = useMutation(api.entities.archive);

  // Live workspace context — populated once the business step bootstraps the
  // workspace, so the integration steps can do real work. These queries require
  // an existing workspace/membership, so they stay "skip" until the viewer
  // reports a workspace (before bootstrap there is nothing to read and the
  // server would reject the unauthorized read).
  const viewer = useQuery(api.session.viewer, {});
  const workspaceReady = Boolean(viewer?.workspace?.id);
  const workspaceId = (viewer?.workspace?.id ??
    null) as Id<"workspaces"> | null;
  const entities = useQuery(api.entities.list, workspaceReady ? {} : "skip");
  const webhook = useQuery(
    api.connections.webhookConfig,
    workspaceReady ? {} : "skip",
  );
  const connectionsData = useQuery(
    api.connections.list,
    workspaceReady ? {} : "skip",
  );
  const progress = useQuery(
    api.onboarding.getProgress,
    workspaceReady ? {} : "skip",
  );
  const aiProviderStatus = useQuery(
    api.ai.providerStatus,
    workspaceId ? { workspaceId } : "skip",
  );

  const businessRows = useMemo(
    () => entities?.rows.filter((entity) => !entity.archived) ?? [],
    [entities]
  );
  const firstEntityId = (businessRows[0]?.id ?? null) as Id<"entities"> | null;
  const connectionBusinesses = businessRows.map((entity) => ({
    id: String(entity.id),
    name: entity.name,
  }));
  const importedTransactionCount = businessRows.reduce(
    (sum, entity) => sum + (entity.transactionCount ?? 0),
    0,
  );
  const connectedBankCount = connectionsData?.bankAccounts?.length ?? 0;
  // A live Plaid bank link books its own opening balance automatically, so the
  // manual opening-balance step is only relevant for CSV/demo/manual setups.
  const plaidBankConnected = (connectionsData?.bankAccounts ?? []).some(
    (account) =>
      Boolean(account.plaidItemId) && account.itemStatus !== "disconnected",
  );
  const connectedStripeCount =
    connectionsData?.connections?.filter(
      (connection) => connection.provider === "stripe",
    ).length ?? 0;
  const existingSetupDetected =
    workspaceReady &&
    businessRows.length > 0 &&
    (importedTransactionCount > 0 ||
      connectedBankCount > 0 ||
      connectedStripeCount > 0);
  const aiReady = aiProviderStatus?.mode === "active";

  const [stepIndex, setStepIndex] = useState(0);
  const [started, setStarted] = useState(false);
  const [businesses, setBusinesses] = useState(() => [newBusinessRow()]);
  const businessesLoadedRef = useRef(false);

  // When existing businesses load from DB, populate the form with them once
  // This ensures users see their previously saved businesses when returning to Business step
  useLayoutEffect(() => {
    if (businessesLoadedRef.current) return;
    if (businessRows.length === 0) return;
    if (stepIndex !== 0) return;

    businessesLoadedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusinesses(
      businessRows.map((entity, index) => ({
        id: index + 1,
        name: entity.name,
        businessType: (entity.businessType as BusinessType) || "services",
      }))
    );
  }, [businessRows, stepIndex]);
  // Owner-chosen workspace name (the whole account's display name). Seeded from
  // the current workspace name once it resolves, unless the owner has typed.
  const [workspaceNameInput, setWorkspaceNameInput] = useState(
    workspaceName ?? "",
  );
  const workspaceNameTouched = useRef(false);

  // Resume support (Epic E4-T1): if the wizard is (re)mounted with a workspace
  // already in progress, jump to the saved current step ONCE so a reload — or an
  // AppShell re-render right after the business step bootstraps — never throws the
  // owner back to step 0. Runs a single time once progress first resolves.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    if (!progress || !progress.persisted) return;
    resumedRef.current = true;
    const settled = new Set([
      ...progress.completedSteps,
      ...progress.skippedSteps,
    ]);
    // First step that hasn't been settled yet, in canonical order.
    const resumeId = STEP_ORDER.find((id) => !settled.has(id)) ?? null;
    const resumeIndex = resumeId
      ? STEP_ORDER.indexOf(resumeId)
      : steps.length - 1;
    if (resumeIndex > 0) {
      // Deliberate one-time sync of the wizard step to the persisted server
      // progress (resume), not a render-driven cascade — guarded by resumedRef.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStepIndex(resumeIndex);
    }
  }, [progress]);

  // Seed the workspace-name field from the current workspace name once it
  // resolves (owner sign-in creates one before onboarding), unless the owner has
  // already edited the field. External-store sync, not a render-driven cascade.
  useEffect(() => {
    if (workspaceName && !workspaceNameTouched.current) {
      setWorkspaceNameInput(workspaceName);
    }
  }, [workspaceName]);

  // Keep the active step visible in the horizontally-scrollable step rail as the
  // wizard advances. No-op on desktop where every step already fits.
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const active = railRef.current?.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    active?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [stepIndex]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InviteRole>("accountant");
  const [invites, setInvites] = useState<Array<{ email: string; url: string }>>(
    [],
  );
  const [inviteError, setInviteError] = useState("");
  const [inviting, setInviting] = useState(false);

  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");

  const [bankSheetOpen, setBankSheetOpen] = useState(false);
  const [stripeSheetOpen, setStripeSheetOpen] = useState(false);
  const [booksStartDate, setBooksStartDate] = useState("");

  const hasWorkspace = Boolean(workspaceName);
  const namedBusinesses = businesses.filter((b) => b.name.trim().length >= 2);
  const canContinueBusiness = namedBusinesses.length >= 1;

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
            Your account is set up with{" "}
            {role ? `the ${role} role` : "your role"}. The workspace owner has
            already created the books — you can start working right away.
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
    setBusinesses((rows) =>
      rows.map((row) => (row.id === id ? { ...row, name } : row)),
    );
  }
  function setRowType(id: number, businessType: BusinessType) {
    setBusinesses((rows) =>
      rows.map((row) => (row.id === id ? { ...row, businessType } : row)),
    );
  }
  // Paired with the temporarily-hidden "Legal structure" selector below; restore
  // alongside that block (see the commented JSX) when the field is re-enabled.
  // function setRowLegalStructure(id: number, legalStructure: LegalStructure) {
  //   setBusinesses((rows) =>
  //     rows.map((row) => (row.id === id ? { ...row, legalStructure } : row)),
  //   );
  // }
  // Upload a logo for a business row: get an auth-only upload URL, POST the file,
  // then stash the storageId (sent to bootstrap) + a local preview URL. Errors
  // surface in the business-step error box rather than throwing to the field.
  async function uploadRowLogo(id: number, file: File) {
    try {
      const uploadUrl = await generateLogoUploadUrl({});
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const preview = URL.createObjectURL(file);
      setBusinesses((rows) =>
        rows.map((row) =>
          row.id === id
            ? { ...row, logoStorageId: storageId, logoPreview: preview }
            : row,
        ),
      );
    } catch (caught) {
      setStatus("error");
      setError(
        getErrorMessage(
          caught,
          "Could not upload that logo. Try a PNG or JPG.",
        ),
      );
    }
  }
  function clearRowLogo(id: number) {
    setBusinesses((rows) =>
      rows.map((row) =>
        row.id === id
          ? { ...row, logoStorageId: undefined, logoPreview: undefined }
          : row,
      ),
    );
  }
  function addBusinessRow() {
    setBusinesses((rows) => [...rows, newBusinessRow()]);
  }
  function removeBusinessRow(id: number) {
    setBusinesses((rows) =>
      rows.length <= 1 ? rows : rows.filter((row) => row.id !== id),
    );
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
  async function persistStepState(
    step: OnboardingStepId,
    state: "complete" | "skipped",
  ) {
    try {
      await markStep({ step, state });
    } catch {
      // No workspace yet — the business step creates it; UI state still advances.
    }
  }

  // Step 0 -> create the workspace + businesses NOW so every later step does real
  // work (Epic E4-T4). If businesses already exist (returning user), just mark step
  // complete and continue without recreating.
  async function continueFromBusiness() {
    setStatus("submitting");
    setError("");
    try {
      // UPDATE MODE: Businesses already exist (returning user)
      // Handle: archiving removed businesses + creating new businesses they just added
      if (businessRows.length > 0) {
        const currentBusinessNames = new Set(
          businesses.map((b) => b.name.trim()).filter((name) => name)
        );
        const existingBusinessNames = new Set(businessRows.map((b) => b.name));

        // Step 1: Archive removed businesses
        // Only archive businesses that exist in the database (businessRows)
        for (const dbBusiness of businessRows) {
          if (!currentBusinessNames.has(dbBusiness.name)) {
            try {
              console.log(
                `Archiving business: ${dbBusiness.name} with ID: ${dbBusiness.id}`
              );
              await archiveEntity({ entityId: dbBusiness.id });
            } catch (error) {
              console.error(
                `Failed to archive business ${dbBusiness.name}:`,
                error
              );
            }
          }
        }

        // Step 2: Update local businesses state to remove archived ones
        // This ensures the UI doesn't show removed businesses if user comes back
        setBusinesses((prevBusinesses) =>
          prevBusinesses.filter((b) =>
            currentBusinessNames.has(b.name.trim())
          )
        );

        // Step 3: Create NEW businesses (ones in form but not in DB yet)
        const newBusinesses = businesses.filter(
          (b) => b.name.trim() && !existingBusinessNames.has(b.name.trim())
        );

        if (newBusinesses.length > 0) {
          // Create the new businesses using bootstrapWorkspace
          try {
            await bootstrapWorkspace({
              businesses: newBusinesses.map((b) => ({
                name: b.name.trim(),
                businessType: b.businessType,
                ...(b.logoStorageId ? { logoStorageId: b.logoStorageId } : {}),
              })),
            });
          } catch (error) {
            console.error("Failed to create new businesses:", error);
            setError(
              getErrorMessage(
                error,
                "Could not add new businesses. Please try again."
              )
            );
            setStatus("error");
            return;
          }
        }

        await persistStepState("business", "complete");
        await setPhase({ phase: "setup" });
        setStatus("idle");
        next();
        return;
      }

      // First time: create new businesses and workspace
      const result = await bootstrapWorkspace({
        ...(workspaceNameInput.trim()
          ? { workspaceName: workspaceNameInput.trim() }
          : {}),
        businesses: namedBusinesses.map((b) => ({
          name: b.name.trim(),
          businessType: b.businessType,
          ...(b.logoStorageId ? { logoStorageId: b.logoStorageId } : {}),
          ...(b.legalStructure
            ? {
                entityType: legalStructures.find(
                  (l) => l.value === b.legalStructure,
                )?.entityTypeLabel,
              }
            : {}),
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
      setError(
        getErrorMessage(caught, "OpenBooks could not create your books."),
      );
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
      setInviteError(getErrorMessage(caught, "Could not create the invite."));
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
      const route =
        result.businessesProcessing > 0 ? "/dashboard?setup=1" : "/dashboard";
      router.push(route);
    } catch (caught) {
      setStatus("error");
      setError(getErrorMessage(caught, "OpenBooks could not finish setup."));
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
      setError(
        getErrorMessage(caught, "OpenBooks could not open your workspace."),
      );
    }
  }

  // First-run welcome splash: only at the very start of a brand-new setup. Hidden
  // once the owner clicks through, for returning/existing setups, and whenever the
  // wizard resumes into a later step from persisted progress.
  const showWelcome =
    !started &&
    stepIndex === 0 &&
    !existingSetupDetected &&
    !progress?.persisted;
  if (showWelcome) {
    return (
      <WelcomeSplash userName={userName} onStart={() => setStarted(true)} />
    );
  }

  const progressPct = Math.round(((stepIndex + 1) / steps.length) * 100);

  return (
    <main
      className="min-h-screen bg-background text-foreground"
      data-testid="onboarding-screen"
    >
      {/* Top app bar + progress — replaces the sidebar stepper with a focused,
          QuickBooks-style "Get started" header that tracks completion. */}
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="relative flex h-14 items-center px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              ob
            </span>
            <span className="text-sm font-semibold tracking-tight">
              open books
            </span>
          </div>
          <span className="absolute left-1/2 -translate-x-1/2 text-sm font-medium text-muted-foreground">
            {hasWorkspace ? "Guided setup" : "Get started"}
          </span>
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            Step {Math.min(stepIndex + 1, steps.length)} of {steps.length}
          </span>
        </div>
        {/* Clickable step rail: titled steps where visited/earlier steps are
            navigable, the current step is highlighted, and future steps are
            locked. Completed connectors fill green, doubling as the progress
            indicator. Scrolls horizontally on narrow screens. */}
        <div
          ref={railRef}
          className="flex justify-center gap-1 overflow-x-auto border-t px-4 py-2.5 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {steps.map((step, index) => {
            const complete = index < stepIndex;
            const active = index === stepIndex;
            const clickable = index <= stepIndex;
            return (
              <div key={step} className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  disabled={!clickable}
                  data-active={active ? "true" : "false"}
                  aria-current={active ? "step" : undefined}
                  onClick={() => clickable && setStepIndex(index)}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[13px] transition-colors",
                    active && "bg-primary/10 font-medium text-primary",
                    !active && complete && "text-foreground hover:bg-muted",
                    !active && !complete && "text-muted-foreground",
                    !clickable && "cursor-not-allowed",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full border text-[11px] tabular-nums",
                      complete &&
                        "border-primary bg-primary text-primary-foreground",
                      active && "border-primary text-primary",
                      !active && !complete && "border-muted-foreground/30",
                    )}
                  >
                    {complete ? <Check className="size-3" /> : index + 1}
                  </span>
                  <span className="whitespace-nowrap">{step}</span>
                </button>
                {index < steps.length - 1 ? (
                  <span
                    className={cn(
                      "h-px w-4 shrink-0 sm:w-6",
                      complete ? "bg-primary" : "bg-border",
                    )}
                    aria-hidden="true"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
        {/* Slim progress bar tracking overall completion across the steps. */}
        <div
          className="h-1 w-full bg-muted"
          role="progressbar"
          aria-valuenow={progressPct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Setup progress"
        >
          <div
            className="h-full rounded-r-full bg-primary transition-[width] duration-500 ease-out"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-col px-4 py-10 sm:px-6 sm:py-14 lg:py-20">
        <div className="w-full ob-animate-in">
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
                <p className="text-sm font-medium text-primary">
                  Welcome{userName ? `, ${userName}` : ""}
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
                  {hasWorkspace
                    ? "Create your businesses"
                    : "Create your first set of books"}
                </h1>
                <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
                  Add one or more businesses. OpenBooks gives each its own typed
                  chart of accounts and keeps a separate ledger — the way
                  separate LLCs are supposed to be kept. You can roll them up
                  later in Portfolio.
                </p>
              </div>

              <div
                className="grid gap-1.5 rounded-lg border bg-background p-4"
                data-testid="onboarding-workspace-name"
              >
                <Label htmlFor="workspace-name" className="text-sm font-medium">
                  Workspace name
                </Label>
                <Input
                  id="workspace-name"
                  data-testid="onboarding-workspace-name-input"
                  value={workspaceNameInput}
                  onChange={(event) => {
                    workspaceNameTouched.current = true;
                    setWorkspaceNameInput(event.target.value);
                  }}
                  placeholder="e.g. Acme Holdings"
                />
                <p className="text-[11.5px] leading-5 text-muted-foreground">
                  This names your whole OpenBooks account — every business lives
                  under it. You can change it later in Settings.
                </p>
              </div>

              <p
                className="text-sm text-muted-foreground"
                data-testid="onboarding-currency"
              >
                <span className="font-medium text-foreground">
                  Currency: USD
                </span>
                {" · "}More currencies coming soon.
              </p>

              <div
                className="grid gap-4"
                data-testid="onboarding-business-rows"
              >
                {businesses.map((row, index) => (
                  <div
                    key={row.id}
                    className="grid gap-3 rounded-lg border bg-background p-4"
                    data-testid="onboarding-business-row"
                  >
                    <div className="flex items-start gap-4">
                      <OnboardingLogoField
                        logoPreview={row.logoPreview}
                        onUpload={(file) => uploadRowLogo(row.id, file)}
                        onRemove={() => clearRowLogo(row.id)}
                      />
                      <div className="flex-1 grid gap-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label
                            htmlFor={`business-name-${row.id}`}
                            className="text-sm font-medium"
                          >
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
                          data-testid={
                            index === 0
                              ? "onboarding-business-name"
                              : `onboarding-business-name-${index}`
                          }
                          value={row.name}
                          onChange={(event) =>
                            setRowName(row.id, event.target.value)
                          }
                          placeholder="Acme Studio LLC"
                        />
                        <p className="text-[11.5px] leading-5 text-muted-foreground mt-[-5px]">
                          Upload logo & your business name here
                        </p>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {businessTypes.map((type) => (
                        <button
                          key={type.value}
                          type="button"
                          data-testid={
                            index === 0
                              ? `onboarding-type-${type.value}`
                              : `onboarding-type-${index}-${type.value}`
                          }
                          className={cn(
                            "rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                            row.businessType === type.value &&
                              "border-primary bg-primary/5 ring-1 ring-primary/20",
                          )}
                          onClick={() => setRowType(row.id, type.value)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">
                              {type.label}
                            </span>
                            {row.businessType === type.value ? (
                              <Check className="size-4 text-primary" />
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {type.detail}
                          </p>
                        </button>
                      ))}
                    </div>
                    {/* Legal structure — temporarily hidden
                    <div className="grid gap-2">
                      <p className="text-sm font-medium text-foreground">
                        Legal structure{" "}
                        <span className="font-normal text-muted-foreground">
                          (optional)
                        </span>
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {legalStructures.map((ls) => (
                          <button
                            key={ls.value}
                            type="button"
                            data-testid={
                              index === 0
                                ? `onboarding-legal-${ls.value}`
                                : `onboarding-legal-${index}-${ls.value}`
                            }
                            className={cn(
                              "rounded-lg border p-3 text-left transition-colors hover:bg-muted/50",
                              row.legalStructure === ls.value &&
                                "border-primary bg-primary/5 ring-1 ring-primary/20",
                            )}
                            onClick={() => setRowLegalStructure(row.id, ls.value)}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">
                                {ls.label}
                              </span>
                              {row.legalStructure === ls.value ? (
                                <Check className="size-4 text-primary" />
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                              {ls.detail}
                            </p>
                          </button>
                        ))}
                      </div>
                    </div>
                    */}
                  </div>
                ))}
              </div>

              {status === "error" ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t pt-6">
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
                  {status === "submitting"
                    ? businessRows.length > 0
                      ? "Updating your books"
                      : "Creating your books"
                    : businessRows.length > 0
                    ? "Update & continue"
                    : "Create & continue"}
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
                <AiSection
                  entityId={firstEntityId}
                  workspaceId={workspaceId}
                  hideDiagnostics
                />
              </div>
              <SkipContinueRow
                onBack={back}
                onContinue={() => {
                  void persistStepState("ai", "complete");
                  next();
                }}
                continueLabel={
                  aiReady ? "Continue with saved AI" : "I've added my key"
                }
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
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                    Invite your team
                  </h1>
                  <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
                    Invite an accountant or HR/payroll teammate. They get their
                    own login and a role-scoped view. Copy each invite link to
                    share it — you can always invite more later from Settings.
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
                    <Select
                      value={inviteRole}
                      onValueChange={(value) =>
                        setInviteRole(value as InviteRole)
                      }
                    >
                      <SelectTrigger
                        data-testid="onboarding-invite-role"
                        className="w-full"
                      >
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
                  <p
                    className="text-sm text-destructive"
                    data-testid="onboarding-invite-error"
                  >
                    {inviteError}
                  </p>
                ) : null}
              </div>

              {invites.length > 0 ? (
                <div
                  className="grid gap-2"
                  data-testid="onboarding-invite-list"
                >
                  {invites.map((invite) => (
                    <div
                      key={invite.email}
                      className="flex flex-wrap items-center gap-2 rounded-lg border bg-background p-3 text-sm"
                      data-testid="onboarding-invite-row"
                    >
                      <span className="font-medium">{invite.email}</span>
                      <code
                        className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground"
                        data-testid="onboarding-invite-url"
                      >
                        {invite.url}
                      </code>
                      <CopyButton
                        value={invite.url}
                        testId="onboarding-invite-copy"
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="mt-2 flex flex-col-reverse gap-2 border-t pt-6 sm:flex-row sm:justify-between">
                <Button variant="outline" onClick={back}>
                  Back
                </Button>
                <Button
                  data-testid="onboarding-team-continue"
                  onClick={() => {
                    void persistStepState(
                      "team",
                      invites.length > 0 ? "complete" : "skipped",
                    );
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
            <PlaidOnboardingStep
              plaidApp={connectionsData?.plaidApp}
              liveEnabled={Boolean(connectionsData?.plaid?.liveEnabled)}
              webhookUrl={webhook?.plaidWebhookUrl ?? ""}
              redirectUri={webhook?.plaidRedirectUri ?? ""}
              connected={Boolean(connectionsData?.bankAccounts?.length)}
              onConnect={() => setBankSheetOpen(true)}
              onSkip={() => {
                void persistStepState("plaid", "skipped");
                next();
              }}
              onContinue={() => {
                void persistStepState("plaid", "complete");
                next();
              }}
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
              urls={[
                {
                  label: "Stripe webhook URL",
                  value: webhook?.stripeWebhookUrl ?? "",
                },
              ]}
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
                connectionsData?.connections?.some(
                  (c) => c.provider === "stripe",
                ),
              )}
              onBack={back}
            />
          ) : null}

          {stepIndex === 6 ? (
            <OpeningBalancesStep
              businesses={businessRows.map((b) => ({
                id: b.id as Id<"entities">,
                name: b.name,
              }))}
              startDate={booksStartDate}
              onStartDateChange={setBooksStartDate}
              plaidBankConnected={plaidBankConnected}
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
              businesses={businessRows.map((b) => ({
                id: b.id as Id<"entities">,
                name: b.name,
              }))}
              startDate={booksStartDate}
              onStartDateChange={setBooksStartDate}
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
              businesses={businessRows.map((b) => ({
                id: b.id as Id<"entities">,
                name: b.name,
              }))}
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

      {/* Reuse the Settings connection sheets so Plaid Link + per-account
          mapping and Stripe OAuth + webhook verification are not duplicated. */}
      {workspaceId ? (
        <>
          <AddBankSheet
            open={bankSheetOpen}
            onOpenChange={setBankSheetOpen}
            businesses={connectionBusinesses}
            defaultEntityId={String(firstEntityId ?? "")}
            existingBankAccounts={connectionsData?.bankAccounts ?? []}
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
      <div>
        <span className="inline-flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-6" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          {body}
        </p>
        {guideHref ? (
          <GuideLink
            href={guideHref}
            label={guideLabel ?? "How to set this up"}
          />
        ) : null}
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
          <div className="text-sm font-semibold text-foreground">
            Existing local setup found
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            OpenBooks already sees real books for this workspace. Continue to
            the product now and treat any unfinished setup steps as a Settings
            checklist.
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
              {stripeCount} Stripe{" "}
              {stripeCount === 1 ? "connection" : "connections"}
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
    <div
      className="grid gap-2 rounded-lg border bg-background p-4"
      data-testid="onboarding-url-panel"
    >
      <div className="text-sm font-medium">
        Register these URLs in the provider dashboard
      </div>
      {present.map((url) => (
        <div
          key={url.label}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <span className="w-44 shrink-0 text-muted-foreground">
            {url.label}
          </span>
          <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
            {url.value}
          </code>
          <CopyButton
            value={url.value}
            testId={`onboarding-copy-${url.label.replace(/\s+/g, "-").toLowerCase()}`}
          />
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
    <div className="mt-2 flex flex-col gap-4 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button
          data-testid={continueTestId}
          disabled={continueDisabled}
          onClick={onContinue}
        >
          {continueLabel}
          <ArrowRight className="size-4" />
        </Button>
      </div>
      <Button
        variant="link"
        className="h-auto justify-start p-0 text-sm font-medium text-primary sm:justify-center"
        data-testid={skipTestId}
        onClick={onSkip}
      >
        {skipLabel}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plaid onboarding step — inline credential form + bank connect
// ---------------------------------------------------------------------------

type PlaidEnvironment = "sandbox" | "development" | "production";

function PlaidOnboardingStep({
  plaidApp,
  liveEnabled,
  webhookUrl,
  redirectUri,
  connected,
  onConnect,
  onSkip,
  onContinue,
  onBack,
}: {
  plaidApp: PlaidAppSummary | undefined;
  liveEnabled: boolean;
  webhookUrl: string;
  redirectUri: string;
  connected: boolean;
  onConnect: () => void;
  onSkip: () => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const saveApp = useAction(api.connections.saveWorkspacePlaidApp);
  const testApp = useAction(api.plaid.testWorkspacePlaidApp);

  const [environment, setEnvironment] = useState<PlaidEnvironment>("sandbox");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reconfiguring, setReconfiguring] = useState(false);

  const isConfigured = plaidApp?.configured === true;
  const showForm = !isConfigured || reconfiguring;

  async function onSave() {
    if (!clientId.trim() || !secret.trim()) return;
    setSaving(true);
    try {
      await saveApp({
        clientId: clientId.trim(),
        secret: secret.trim(),
        environment,
      });
      toast.success("Plaid app saved. You can now connect your bank.");
      setClientId("");
      setSecret("");
      setReconfiguring(false);
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not save the Plaid app."));
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    setTesting(true);
    try {
      const result = await testApp({});
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (error) {
      toast.error(getErrorMessage(error, "Could not reach Plaid."));
    } finally {
      setTesting(false);
    }
  }

  return (
    <StepFrame
      icon={Landmark}
      title="Connect bank data"
      body="Connect through Plaid so OpenBooks syncs your transactions and books an opening balance. One Plaid login can span multiple businesses — you'll map each account to the right business."
      guideHref={SETUP_GUIDE_HREF}
      guideLabel="Open Plaid setup guide"
    >
      {showForm ? (
        <div className="grid gap-4">
          <ol className="grid gap-1.5 rounded-lg border bg-card p-4 text-[12.5px] text-muted-foreground">
            <li className="font-medium text-foreground">Set up in 3 steps</li>
            <li>
              1. Copy the URLs below and register them in your Plaid dashboard.
            </li>
            <li>
              2. In Plaid → Developers → Keys, copy your Client ID and secret.
            </li>
            <li>3. Paste them here and save — then connect your bank.</li>
            <li className="pt-0.5">
              <a
                className="inline-flex items-center gap-1 text-primary hover:underline"
                href="https://dashboard.plaid.com/developers/keys"
                target="_blank"
                rel="noreferrer noopener"
              >
                Open Plaid dashboard <ExternalLink className="size-3" />
              </a>
            </li>
          </ol>

          <div className="grid min-w-0 gap-3 rounded-lg border bg-background p-4">
            <WebhookField
              label="OAuth redirect URL"
              value={redirectUri}
              hint="Add this to Plaid → Developers → API → Allowed redirect URIs."
            />
            <WebhookField
              label="Webhook URL"
              value={webhookUrl}
              hint="Plaid posts transaction updates here automatically."
            />
          </div>

          <div className="grid gap-3 rounded-lg border bg-background p-4">
            <div className="grid gap-1.5">
              <FieldLabel>Environment</FieldLabel>
              <Select
                value={environment}
                onValueChange={(v) => setEnvironment(v as PlaidEnvironment)}
              >
                <SelectTrigger data-testid="onboarding-plaid-environment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Sandbox (test banks)</SelectItem>
                  {liveEnabled ? (
                    <SelectItem value="development">Development</SelectItem>
                  ) : null}
                  {liveEnabled ? (
                    <SelectItem value="production">Production</SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              {!liveEnabled ? (
                <p className="text-[11.5px] leading-5 text-muted-foreground">
                  Live environments require the{" "}
                  <code className="rounded bg-muted px-1 text-[11px]">
                    OPENBOOKS_REAL_TEST_LIVE_CONNECTORS
                  </code>{" "}
                  flag to be set.
                </p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <FieldLabel>Client ID</FieldLabel>
              <SecretInput
                value={clientId}
                onChange={setClientId}
                placeholder="Plaid Client ID"
                testId="onboarding-plaid-client-id"
              />
            </div>

            <div className="grid gap-1.5">
              <FieldLabel>Secret</FieldLabel>
              <SecretInput
                value={secret}
                onChange={setSecret}
                placeholder="Plaid secret for selected environment"
                testId="onboarding-plaid-secret"
              />
              {reconfiguring ? (
                <p className="text-[11.5px] leading-5 text-muted-foreground">
                  Re-entering your credentials rotates the saved app.
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-2 border-t pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onTest}
                disabled={testing || !isConfigured}
                data-testid="onboarding-plaid-test"
              >
                {testing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Test connection
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSave}
                disabled={saving || !clientId.trim() || !secret.trim()}
                data-testid="onboarding-plaid-save"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ShieldCheck className="size-4" />
                )}
                Save Plaid app
              </Button>
              {reconfiguring ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setReconfiguring(false)}
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 rounded-lg border bg-background p-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="flex size-5 items-center justify-center rounded-full bg-ob-green-50">
              <Check className="size-3 text-ob-green-800" />
            </span>
            <span className="font-medium text-ob-green-800">
              Plaid app configured
            </span>
            {plaidApp?.configured ? (
              <span className="text-muted-foreground capitalize">
                · {plaidApp.environment}
              </span>
            ) : null}
          </div>

          {connected ? (
            <p
              className="text-sm text-primary"
              data-testid="onboarding-connected-note"
            >
              Bank connected — you can map accounts to businesses, then
              continue.
            </p>
          ) : (
            <>
              <Button data-testid="onboarding-bank-connect" onClick={onConnect}>
                Connect bank account
              </Button>
              <p className="text-sm text-muted-foreground">
                Skipping keeps this in your resumable setup checklist until you
                complete it.
              </p>
            </>
          )}

          <button
            type="button"
            className="w-fit text-[11.5px] text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => setReconfiguring(true)}
          >
            Re-configure Plaid app
          </button>
        </div>
      )}

      <SkipContinueRow
        onBack={onBack}
        onContinue={onContinue}
        continueLabel="Bank connected — continue"
        continueDisabled={!connected}
        onSkip={onSkip}
        skipTestId="onboarding-bank-skip"
        skipLabel="Use CSV for now"
      />
    </StepFrame>
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
    <StepFrame
      icon={icon}
      title={title}
      body={body}
      guideHref={guideHref}
      guideLabel={guideLabel}
    >
      <UrlPanel urls={urls} />
      <div className="rounded-lg border bg-background p-4">
        <Button data-testid={connectTestId} onClick={onConnect}>
          Connect now
        </Button>
        {connected ? (
          <p
            className="mt-2 text-sm text-primary"
            data-testid="onboarding-connected-note"
          >
            Connected — you can map accounts to businesses, then continue.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Skipping keeps this in your resumable setup checklist until you
            complete it.
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
      setMessage(getErrorMessage(caught, "Could not save the email key."));
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
        {message ? (
          <p className="text-sm text-muted-foreground">{message}</p>
        ) : null}
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
  startDate,
  onStartDateChange,
  plaidBankConnected,
  onSkip,
  onComplete,
  onBack,
}: {
  businesses: Array<{ id: Id<"entities">; name: string }>;
  startDate: string;
  onStartDateChange: (date: string) => void;
  plaidBankConnected: boolean;
  onSkip: () => void;
  onComplete: () => void;
  onBack: () => void;
}) {
  const setOpeningBalances = useMutation(api.onboarding.setOpeningBalances);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [showManual, setShowManual] = useState(false);

  // A connected Plaid bank already posts its own opening balance when it links,
  // so there's nothing to enter here — show a confirmation and let the owner
  // continue. The manual entry form is only for CSV/demo/manual setups, and an
  // owner can still opt into it explicitly.
  if (plaidBankConnected && !showManual) {
    return (
      <StepFrame
        icon={Wallet}
        title="Opening balances"
        body="Your connected bank set the starting balance automatically when it linked, so there's nothing to enter here."
      >
        <div
          className="grid gap-2 rounded-lg border border-primary/20 bg-primary/5 p-4"
          data-testid="onboarding-opening-balances-plaid"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Check className="size-4 shrink-0" />
            Opening balance booked from your bank
          </div>
          <p className="text-[12.5px] leading-5 text-muted-foreground">
            OpenBooks recorded a balanced opening entry from your linked
            bank&apos;s current balance. You&apos;d only set this manually if
            you were starting from a CSV import or manual entries.
          </p>
        </div>
        <SkipContinueRow
          onBack={onBack}
          onContinue={onComplete}
          continueLabel="Continue"
          continueTestId="onboarding-opening-continue"
          onSkip={() => setShowManual(true)}
          skipTestId="onboarding-opening-manual"
          skipLabel="Enter balances manually instead"
        />
      </StepFrame>
    );
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const lines = businesses
        .map((business) => {
          const minor = dollarsToMinor(amounts[String(business.id)] ?? "");
          return minor === null
            ? null
            : { entityId: business.id, balanceMinor: minor };
        })
        .filter(
          (line): line is { entityId: Id<"entities">; balanceMinor: number } =>
            line !== null,
        )
        .filter((line) => line.balanceMinor !== 0)
        .map((line) => ({ ...line, ...(startDate ? { startDate } : {}) }));
      if (lines.length === 0) {
        setMessage(
          "Enter an opening balance for at least one business, or skip.",
        );
        setSaving(false);
        return;
      }
      await setOpeningBalances({ lines });
      onComplete();
    } catch (caught) {
      setMessage(getErrorMessage(caught, "Could not set opening balances."));
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
      <div
        className="grid gap-3 rounded-lg border bg-background p-4"
        data-testid="onboarding-opening-balances"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="opening-start">Start my books on (optional)</Label>
          <Input
            id="opening-start"
            type="date"
            data-testid="onboarding-opening-start"
            value={startDate}
            onChange={(event) => onStartDateChange(event.target.value)}
          />
        </div>
        {businesses.map((business) => (
          <div
            key={String(business.id)}
            className="grid grid-cols-2 items-center gap-3"
          >
            <span className="text-sm font-medium">{business.name}</span>
            <Input
              data-testid={`onboarding-opening-amount-${String(business.id)}`}
              inputMode="decimal"
              value={amounts[String(business.id)] ?? ""}
              onChange={(event) =>
                setAmounts((prev) => ({
                  ...prev,
                  [String(business.id)]: event.target.value,
                }))
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
  startDate,
  onStartDateChange,
  onSkip,
  onComplete,
  onBack,
}: {
  businesses: Array<{ id: Id<"entities">; name: string }>;
  startDate: string;
  onStartDateChange: (date: string) => void;
  onSkip: () => void;
  onComplete: () => void;
  onBack: () => void;
}) {
  const generate = useAction(
    api.onboardingProposals.generateOnboardingProposals,
  );
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
      setMessage(
        `OpenBooks drafted ${total} suggestion${total === 1 ? "" : "s"} for your review.`,
      );
    } catch (caught) {
      setMessage(getErrorMessage(caught, "Could not run the AI setup pass."));
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
      <div
        className="grid gap-4 rounded-lg border bg-background p-4"
        data-testid="onboarding-sync-step"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="sync-start">Review history from (optional)</Label>
          <Input
            id="sync-start"
            type="date"
            data-testid="onboarding-sync-start"
            value={startDate}
            onChange={(event) => onStartDateChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Leave blank to pull as much history as your connector returns.
          </p>
        </div>
        <div>
          <Button
            type="button"
            data-testid="onboarding-sync-run"
            disabled={running}
            onClick={run}
          >
            {running ? "Reviewing your history…" : "Review my history"}
          </Button>
        </div>
        {message ? (
          <p className="text-sm text-muted-foreground">{message}</p>
        ) : null}
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
  const [activeEntity, setActiveEntity] = useState<Id<"entities"> | null>(
    businesses[0]?.id ?? null,
  );
  const entityId = activeEntity ?? businesses[0]?.id ?? null;
  const proposals = useQuery(
    api.onboardingProposals.listOnboardingProposals,
    entityId ? { entityId } : "skip",
  );
  const questions = useQuery(
    api.onboardingProposals.listOnboardingQuestions,
    entityId ? { entityId } : "skip",
  );
  const approve = useMutation(
    api.onboardingProposals.approveOnboardingProposal,
  );
  const reject = useMutation(api.onboardingProposals.rejectOnboardingProposal);
  const answerQuestion = useMutation(
    api.onboardingProposals.answerOnboardingQuestion,
  );
  const completeReview = useMutation(
    api.onboardingProposals.completeProposalReview,
  );

  const open = (proposals ?? []).filter((p) => p.status === "proposed");
  const approvedCount = (proposals ?? []).filter(
    (p) => p.status === "confirmed",
  ).length;
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
            <SelectTrigger
              data-testid="onboarding-review-business"
              className="w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {businesses.map((business) => (
                <SelectItem
                  key={String(business.id)}
                  value={String(business.id)}
                >
                  {business.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {questions && questions.length > 0 ? (
        <div
          className="grid gap-2 rounded-lg border bg-background p-4"
          data-testid="onboarding-questions"
        >
          <div className="text-sm font-medium">A few quick questions</div>
          {questions.map((question) => (
            <div
              key={question.id}
              className="grid gap-1.5 sm:grid-cols-[1fr_220px] sm:items-center"
            >
              <span className="text-sm text-muted-foreground">
                {question.prompt}
              </span>
              <Input
                data-testid={`onboarding-question-${question.key}`}
                defaultValue={question.answer ?? ""}
                placeholder="Your answer"
                onBlur={(event) => {
                  const value = event.target.value.trim();
                  if (value && value !== (question.answer ?? "")) {
                    void answerQuestion({
                      questionId: question.id,
                      answer: value,
                    });
                  }
                }}
              />
            </div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4" data-testid="onboarding-proposals">
        {open.length === 0 ? (
          <p
            className="text-sm text-muted-foreground"
            data-testid="onboarding-proposals-empty"
          >
            No suggestions to review. You can always add income streams and
            rules later in Settings.
          </p>
        ) : (
          Object.entries(grouped).map(([kind, items]) => (
            <div key={kind} className="grid gap-2">
              <div className="text-sm font-medium">
                {PROPOSAL_GROUP_LABELS[kind] ?? kind}
              </div>
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

      <div className="mt-2 flex flex-col-reverse gap-2 border-t pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {open.length > 0 ? (
            <Button
              variant="ghost"
              data-testid="onboarding-approve-all"
              onClick={() => void approveAll()}
            >
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
  const stripe =
    connectionsData?.connections?.filter((c) => c.provider === "stripe")
      .length ?? 0;
  // Posted-vs-inbox for the active business, read from the SAME dashboard
  // read-model the populated org will show (E4-T9 DoD). Reflects whatever the
  // ledger holds now; the finish handler's bulk pass moves more rows from Inbox
  // to posted after the owner lands on the dashboard.
  const dashboard = useQuery(
    api.coreViews.dashboard,
    entityId ? { entityId } : "skip",
  );
  const totalTxns = dashboard?.readStats?.transactions ?? null;
  const inbox = dashboard?.inbox?.openCount ?? null;
  const posted =
    totalTxns === null || inbox === null
      ? null
      : Math.max(0, totalTxns - inbox);
  return (
    <div
      className="grid gap-3 rounded-lg border bg-background p-4 text-sm"
      data-testid="onboarding-summary"
    >
      <SummaryRow label="Businesses" value={String(businessCount)} />
      <SummaryRow label="Bank accounts" value={String(banks)} />
      <SummaryRow label="Stripe connections" value={String(stripe)} />
      <SummaryRow label="Teammates invited" value={String(invites)} />
      <SummaryRow
        label="Suggestions approved"
        value={String(approvedProposals)}
      />
      <SummaryRow
        label="Posted vs Inbox"
        value={
          posted === null || inbox === null
            ? "—"
            : `${posted} posted · ${inbox} in Inbox`
        }
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
