"use client";

import { useMutation } from "convex/react";
import { ArrowRight, Building2, Check, CreditCard, Landmark, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
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

const steps = ["Business", "AI", "Bank", "Stripe", "Finish"] as const;

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

export function OnboardingScreen({
  userName,
}: {
  userName?: string | null;
}) {
  const router = useRouter();
  const bootstrapWorkspace = useMutation(api.onboarding.bootstrapWorkspace);
  const [stepIndex, setStepIndex] = useState(0);
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState<BusinessType>("services");
  const [currency, setCurrency] = useState("USD");
  const [skippedAi, setSkippedAi] = useState(false);
  const [skippedBank, setSkippedBank] = useState(false);
  const [skippedStripe, setSkippedStripe] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");

  const canContinueBusiness = businessName.trim().length >= 2 && /^[A-Z]{3}$/.test(currency);
  const selectedType = useMemo(
    () => businessTypes.find((type) => type.value === businessType) ?? businessTypes[0],
    [businessType],
  );

  function next() {
    setStepIndex((value) => Math.min(value + 1, steps.length - 1));
  }

  function back() {
    setStepIndex((value) => Math.max(value - 1, 0));
  }

  async function finish() {
    setStatus("submitting");
    setError("");
    try {
      await bootstrapWorkspace({
        businessName,
        businessType,
        currency,
        skippedAi,
        skippedBank,
        skippedStripe,
      });
      router.push("/dashboard");
    } catch (caught) {
      setStatus("error");
      setError(caught instanceof Error ? caught.message : "OpenBooks could not finish setup.");
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
              <div className="text-xs text-muted-foreground">First workspace setup</div>
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
            {stepIndex === 0 ? (
              <div className="grid gap-6" data-testid="onboarding-business-step">
                <div>
                  <p className="text-sm text-muted-foreground">Welcome{userName ? `, ${userName}` : ""}</p>
                  <h1 className="mt-1 text-2xl font-semibold">Create your first set of books</h1>
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    OpenBooks will create a workspace, your first business, and a typed chart of accounts. The ledger engine will use those accounts for every report.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-[1fr_180px]">
                  <div className="grid gap-1.5">
                    <Label htmlFor="business-name">Business name</Label>
                    <Input
                      id="business-name"
                      data-testid="onboarding-business-name"
                      value={businessName}
                      onChange={(event) => setBusinessName(event.target.value)}
                      placeholder="Acme Studio LLC"
                    />
                  </div>
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

                <div className="grid gap-3 md:grid-cols-2">
                  {businessTypes.map((type) => (
                    <button
                      key={type.value}
                      type="button"
                      data-testid={`onboarding-type-${type.value}`}
                      className={cn(
                        "min-h-[116px] rounded-lg border p-4 text-left transition-colors hover:bg-muted/50",
                        businessType === type.value && "border-primary bg-primary/5 ring-1 ring-primary/20",
                      )}
                      onClick={() => setBusinessType(type.value)}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{type.label}</span>
                        {businessType === type.value ? <Check className="size-4 text-primary" /> : null}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{type.detail}</p>
                    </button>
                  ))}
                </div>

                <div className="flex justify-end">
                  <Button data-testid="onboarding-next" disabled={!canContinueBusiness} onClick={next}>
                    Continue
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}

            {stepIndex === 1 ? (
              <IntegrationStep
                icon={Sparkles}
                title="Connect AI"
                body="OpenBooks can still run without model keys. If you skip this, bank rules and the Inbox work, and AI-assisted categorization stays degraded until keys are added."
                primaryLabel="Skip AI for now"
                testId="onboarding-ai-skip"
                onPrimary={() => {
                  setSkippedAi(true);
                  next();
                }}
                onBack={back}
              />
            ) : null}

            {stepIndex === 2 ? (
              <IntegrationStep
                icon={Landmark}
                title="Connect bank data"
                body="Plaid sandbox can sync accounts when keys are present. Without Plaid keys, OpenBooks can start from CSV imports and keep the same ledger path."
                primaryLabel="Use CSV for now"
                testId="onboarding-bank-skip"
                onPrimary={() => {
                  setSkippedBank(true);
                  next();
                }}
                onBack={back}
              />
            ) : null}

            {stepIndex === 3 ? (
              <IntegrationStep
                icon={CreditCard}
                title="Connect Stripe"
                body="Stripe test mode adds payments, fees, and payout reconciliation. You can skip it and connect later from Settings."
                primaryLabel="Skip Stripe for now"
                testId="onboarding-stripe-skip"
                onPrimary={() => {
                  setSkippedStripe(true);
                  next();
                }}
                onBack={back}
              />
            ) : null}

            {stepIndex === 4 ? (
              <div className="grid gap-6" data-testid="onboarding-finish-step">
                <div>
                  <h1 className="text-2xl font-semibold">Ready to create your workspace</h1>
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    OpenBooks will create {businessName.trim() || "your business"} as a {selectedType.label.toLowerCase()} business with a {currency} chart of accounts.
                  </p>
                </div>
                <div className="grid gap-3 rounded-lg border bg-background p-4 text-sm">
                  <SummaryRow label="Business" value={businessName.trim() || "Not set"} />
                  <SummaryRow label="Type" value={selectedType.label} />
                  <SummaryRow label="Currency" value={currency} />
                  <SummaryRow label="AI" value={skippedAi ? "Skipped for now" : "Ready to configure"} />
                  <SummaryRow label="Bank" value={skippedBank ? "CSV/import path first" : "Ready to configure"} />
                  <SummaryRow label="Stripe" value={skippedStripe ? "Skipped for now" : "Ready to configure"} />
                </div>
                {status === "error" ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                  <Button variant="outline" onClick={back}>
                    Back
                  </Button>
                  <Button data-testid="onboarding-finish" disabled={status === "submitting"} onClick={finish}>
                    {status === "submitting" ? "Creating workspace" : "Finish setup"}
                    <ArrowRight className="size-4" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function IntegrationStep({
  icon: Icon,
  title,
  body,
  primaryLabel,
  testId,
  onPrimary,
  onBack,
}: {
  icon: typeof Building2;
  title: string;
  body: string;
  primaryLabel: string;
  testId: string;
  onPrimary: () => void;
  onBack: () => void;
}) {
  return (
    <div className="grid gap-6" data-testid={`${testId}-step`}>
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{body}</p>
        </div>
      </div>
      <div className="rounded-lg border bg-background p-4">
        <div className="text-sm font-medium">You can finish setup without this connection.</div>
        <p className="mt-1 text-sm text-muted-foreground">
          The checklist on Dashboard will keep the connection visible until you complete it.
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button data-testid={testId} onClick={onPrimary}>
          {primaryLabel}
          <ArrowRight className="size-4" />
        </Button>
      </div>
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
