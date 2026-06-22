"use client";

import { useAction } from "convex/react";
import { CreditCard, ExternalLink, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import {
  BusinessSelect,
  FieldLabel,
  SecretInput,
  WebhookField,
  readableError,
  type ConnectionBusiness,
} from "./shared";

type StripeMode = "test" | "live";

export type StripeEditTarget = { entityId: string; label: string } | null;

export function StripeConnectSheet({
  open,
  onOpenChange,
  businesses,
  defaultEntityId,
  liveEnabled,
  webhookUrl,
  editing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  businesses: ConnectionBusiness[];
  defaultEntityId: string;
  liveEnabled: boolean;
  webhookUrl: string;
  editing: StripeEditTarget;
}) {
  const saveStripe = useAction(api.connections.saveStripeCredential);

  const [entityId, setEntityId] = useState(defaultEntityId);
  const [mode, setMode] = useState<StripeMode>("test");
  const [label, setLabel] = useState("");
  const [restrictedKey, setRestrictedKey] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Reset the form each time the sheet opens — a deliberate sync to the sheet's
    // open state, not a render-driven cascade.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntityId(editing?.entityId ?? defaultEntityId);
    setMode("test");
    setLabel(editing?.label ?? "");
    setRestrictedKey("");
    setWebhookSecret("");
  }, [open, editing, defaultEntityId]);

  async function onSave() {
    if (!entityId || !restrictedKey.trim() || !webhookSecret.trim()) return;
    setSaving(true);
    try {
      await saveStripe({
        entityId: entityId as Id<"entities">,
        label: label.trim() || undefined,
        mode,
        restrictedKey: restrictedKey.trim(),
        webhookSecret: webhookSecret.trim(),
      });
      toast.success(
        editing
          ? "Stripe key updated. Verify the webhook to turn on live updates."
          : "Stripe connected. Verify the webhook to turn on live updates.",
      );
      setRestrictedKey("");
      setWebhookSecret("");
      onOpenChange(false);
    } catch (error) {
      toast.error(readableError(error, "Could not save the Stripe account."));
    } finally {
      setSaving(false);
    }
  }

  const keyPrefix = mode === "live" ? "rk_live_" : "rk_test_";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md" data-testid="stripe-connect-sheet">
        <SheetHeader className="border-b">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-[8px] bg-ob-green-50 text-ob-green-800">
              <CreditCard className="size-4" />
            </span>
            <SheetTitle>{editing ? "Update Stripe key" : "Connect Stripe"}</SheetTitle>
          </div>
          <SheetDescription>
            Paste a restricted (read-only) key for one Stripe account and choose which business it belongs to.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          <div className="grid gap-1.5">
            <FieldLabel>Business</FieldLabel>
            <BusinessSelect
              businesses={businesses}
              value={entityId}
              onChange={setEntityId}
              disabled={Boolean(editing)}
              testId="stripe-business"
            />
            {editing ? (
              <p className="text-[11.5px] leading-5 text-muted-foreground">
                To move this account to a different business, disconnect it and reconnect under the new one.
              </p>
            ) : null}
          </div>

          <div className="grid gap-2 rounded-[10px] border bg-card p-3 text-[12.5px] text-muted-foreground">
            <span className="font-medium text-foreground">How to create a read-only key</span>
            <span>
              In Stripe → Developers → API keys → Create restricted key, grant <strong>Read</strong> on Charges,
              PaymentIntents, Invoices, Payouts, and Customers. Least privilege — the key can never move money.
            </span>
            <a
              className="inline-flex items-center gap-1 text-primary hover:underline"
              href="https://dashboard.stripe.com/apikeys/create"
              target="_blank"
              rel="noreferrer noopener"
            >
              Create a restricted key <ExternalLink className="size-3" />
            </a>
          </div>

          <div className="grid gap-3">
            {liveEnabled ? (
              <div className="grid gap-1.5">
                <FieldLabel>Mode</FieldLabel>
                <Select value={mode} onValueChange={(value) => setMode(value as StripeMode)}>
                  <SelectTrigger data-testid="stripe-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">Test</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <FieldLabel>Label (optional)</FieldLabel>
              <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Storefront Stripe" />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Restricted key</FieldLabel>
              <SecretInput
                value={restrictedKey}
                onChange={setRestrictedKey}
                placeholder={`${keyPrefix}…`}
                testId="stripe-key"
              />
              <p className="text-[11.5px] leading-5 text-muted-foreground">
                We validate the key against Stripe and store it encrypted. Only the last 4 characters are ever shown again.
              </p>
            </div>
          </div>

          <div className="grid gap-3 border-t pt-4">
            <div className="text-[12.5px] font-medium">Real-time updates (required)</div>
            <WebhookField
              label="Webhook URL"
              value={webhookUrl}
              hint="In Stripe → Developers → Webhooks, add this endpoint, then paste its signing secret below."
            />
            <div className="grid gap-1.5">
              <FieldLabel>Webhook signing secret</FieldLabel>
              <SecretInput
                value={webhookSecret}
                onChange={setWebhookSecret}
                placeholder="whsec_…"
                testId="stripe-webhook-secret"
              />
              <p className="text-[11.5px] leading-5 text-muted-foreground">
                Required. We don’t report live updates as on until a real signed delivery (or the “Verify webhook”
                action) confirms the endpoint — until then the connection stays in an unverified state.
              </p>
            </div>
          </div>
        </div>

        <SheetFooter className="border-t">
          <Button
            type="button"
            onClick={onSave}
            disabled={saving || !entityId || !restrictedKey.trim() || !webhookSecret.trim()}
            data-testid="stripe-save"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {editing ? "Update key" : "Connect Stripe"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
