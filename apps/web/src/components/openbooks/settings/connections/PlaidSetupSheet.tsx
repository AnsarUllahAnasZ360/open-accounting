"use client";

import { useAction } from "convex/react";
import { ExternalLink, Landmark, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../../../../convex/_generated/api";
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

import { FieldLabel, SecretInput, WebhookField, readableError } from "./shared";

type PlaidEnvironment = "sandbox" | "development" | "production";

export type PlaidAppSummary =
  | { configured: false }
  | {
      configured: true;
      environment: string;
      keyPreview: string | null;
      label: string;
      lastValidatedAt: number | null;
      status: "active" | "invalid" | "disconnected";
    };

export function PlaidSetupSheet({
  open,
  onOpenChange,
  plaidApp,
  liveEnabled,
  webhookUrl,
  redirectUri,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plaidApp: PlaidAppSummary;
  liveEnabled: boolean;
  webhookUrl: string;
  redirectUri: string;
}) {
  const saveApp = useAction(api.connections.saveWorkspacePlaidApp);
  const testApp = useAction(api.plaid.testWorkspacePlaidApp);

  const configuredEnv = plaidApp.configured ? plaidApp.environment : "sandbox";
  const [environment, setEnvironment] = useState<PlaidEnvironment>(
    configuredEnv === "development" || configuredEnv === "production" ? configuredEnv : "sandbox",
  );
  const [label, setLabel] = useState(plaidApp.configured ? plaidApp.label : "Plaid app");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // Re-seed the form whenever the sheet re-opens so it reflects current state.
  // A deliberate sync to the sheet's open state, not a render-driven cascade.
  useEffect(() => {
    if (!open) return;
    const env = plaidApp.configured ? plaidApp.environment : "sandbox";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnvironment(env === "development" || env === "production" ? env : "sandbox");
    setLabel(plaidApp.configured ? plaidApp.label : "Plaid app");
    setClientId("");
    setSecret("");
  }, [open, plaidApp]);

  async function onSave() {
    if (!clientId.trim() || !secret.trim()) return;
    setSaving(true);
    try {
      await saveApp({ label: label.trim() || undefined, clientId: clientId.trim(), secret: secret.trim(), environment });
      toast.success("Plaid app saved. You can now add bank accounts.");
      setSecret("");
      onOpenChange(false);
    } catch (error) {
      toast.error(readableError(error, "Could not save the Plaid app."));
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
      toast.error(readableError(error, "Could not reach Plaid."));
    } finally {
      setTesting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md" data-testid="plaid-setup-sheet">
        <SheetHeader className="border-b">
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-[8px] bg-ob-green-50 text-ob-green-800">
              <Landmark className="size-4" />
            </span>
            <SheetTitle>Bank connections (Plaid)</SheetTitle>
          </div>
          <SheetDescription>
            One Plaid app powers bank connections for every business in this workspace. Set it up once.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          {plaidApp.configured ? (
            <div className="rounded-[10px] border bg-muted/20 p-3 text-[12.5px]">
              <div className="font-medium">Plaid app saved</div>
              <div className="mt-1 grid gap-0.5 text-muted-foreground">
                <span className="capitalize">Environment: {plaidApp.environment}</span>
                {plaidApp.keyPreview ? <span>Client ID: {plaidApp.keyPreview}</span> : null}
              </div>
            </div>
          ) : null}

          <ol className="grid gap-2 rounded-[10px] border bg-card p-3 text-[12.5px] text-muted-foreground">
            <li className="font-medium text-foreground">Set up in 3 steps</li>
            <li>1. In the Plaid dashboard, register the two URLs below (OAuth redirect + webhook).</li>
            <li>2. Copy your Client ID and a secret for the environment you chose.</li>
            <li>3. Paste them here, test, and save.</li>
            <li>
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

          <div className="grid gap-3">
            <WebhookField
              label="OAuth redirect URL"
              value={redirectUri}
              hint="Add this to Plaid → Developers → API → Allowed redirect URIs."
            />
            <WebhookField
              label="Webhook URL"
              value={webhookUrl}
              hint="Plaid posts transaction updates here. Used automatically when present."
            />
          </div>

          <div className="grid gap-3 border-t pt-4">
            <div className="grid gap-1.5">
              <FieldLabel>Environment</FieldLabel>
              <Select value={environment} onValueChange={(value) => setEnvironment(value as PlaidEnvironment)}>
                <SelectTrigger data-testid="plaid-environment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sandbox">Sandbox (test banks)</SelectItem>
                  {liveEnabled ? <SelectItem value="development">Development</SelectItem> : null}
                  {liveEnabled ? <SelectItem value="production">Production</SelectItem> : null}
                </SelectContent>
              </Select>
              {!liveEnabled ? (
                <p className="text-[11.5px] leading-5 text-muted-foreground">
                  Live environments are disabled. Only Plaid sandbox is available here.
                </p>
              ) : null}
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Label</FieldLabel>
              <Input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Plaid app" />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Client ID</FieldLabel>
              <SecretInput value={clientId} onChange={setClientId} placeholder="Plaid Client ID" testId="plaid-client-id" />
            </div>
            <div className="grid gap-1.5">
              <FieldLabel>Secret</FieldLabel>
              <SecretInput value={secret} onChange={setSecret} placeholder="Plaid secret" testId="plaid-secret" />
              {plaidApp.configured ? (
                <p className="text-[11.5px] leading-5 text-muted-foreground">
                  Re-enter your Client ID and secret to rotate the saved app.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        <SheetFooter className="flex-row justify-between border-t">
          <Button type="button" variant="outline" onClick={onTest} disabled={testing} data-testid="plaid-test">
            {testing ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Test connection
          </Button>
          <Button
            type="button"
            onClick={onSave}
            disabled={saving || !clientId.trim() || !secret.trim()}
            data-testid="plaid-save"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Save Plaid app
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
