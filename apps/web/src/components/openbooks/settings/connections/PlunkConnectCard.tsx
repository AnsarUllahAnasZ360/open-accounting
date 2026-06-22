"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { ExternalLink, Loader2, Mail, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { FieldLabel, SecretInput, StatusPill, readableError, type ConnectionTone } from "./shared";

// E3-T7: in-UI bring-your-own Plunk key entry. The secret is encrypted at rest in
// the unified credentials table; only the last4 + verified state are shown.
export function PlunkConnectCard({ workspaceId }: { workspaceId: Id<"workspaces"> | null }) {
  const status = useQuery(api.plunk.plunkStatus, workspaceId ? { workspaceId } : "skip");
  const savePlunk = useAction(api.plunk.savePlunkCredential);
  const deletePlunk = useMutation(api.plunk.deletePlunkCredential);

  const [secretKey, setSecretKey] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [fromName, setFromName] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    // Seed the editable from-email/from-name from the saved status once it loads.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFromEmail(status?.fromEmail ?? "");
    setFromName(status?.fromName ?? "");
  }, [status?.fromEmail, status?.fromName]);

  const pill: { label: string; tone: ConnectionTone } = !status
    ? { label: "Loading…", tone: "muted" }
    : !status.configured
      ? { label: "Not set up", tone: "muted" }
      : status.verified
        ? { label: "Verified", tone: "ok" }
        : { label: "Needs attention", tone: "warn" };

  async function onSave() {
    if (!workspaceId || !secretKey.trim()) return;
    setSaving(true);
    try {
      const result = await savePlunk({
        workspaceId,
        secretKey: secretKey.trim(),
        ...(fromEmail.trim() ? { fromEmail: fromEmail.trim() } : {}),
        ...(fromName.trim() ? { fromName: fromName.trim() } : {}),
      });
      setSecretKey("");
      if (result.verified) toast.success(result.message);
      else toast.warning(result.message);
    } catch (error) {
      toast.error(readableError(error, "Could not save the Plunk key."));
    } finally {
      setSaving(false);
    }
  }

  async function onRemove() {
    if (!workspaceId) return;
    setRemoving(true);
    try {
      await deletePlunk({ workspaceId });
      toast.success("Plunk key removed.");
    } catch (error) {
      toast.error(readableError(error, "Could not remove the Plunk key."));
    } finally {
      setRemoving(false);
    }
  }

  const hasByoKey = Boolean(status?.configured && status?.lastFour);

  return (
    <section className="rounded-[12px] border bg-card" data-testid="plunk-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-3">
        <span className="flex size-7 items-center justify-center rounded-[8px] bg-ob-green-50 text-ob-green-800">
          <Mail className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">Email (Plunk)</div>
          <div className="text-[11.5px] text-muted-foreground">
            Sends weekly digests, team invites, and password resets.
          </div>
        </div>
        <StatusPill tone={pill.tone} className="ml-auto">
          {pill.label}
        </StatusPill>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {hasByoKey ? (
          <p className="text-[12.5px] text-muted-foreground" data-testid="plunk-saved-key">
            Key on file ••••{status?.lastFour}
            {status?.fromEmail ? ` · ${status.fromEmail}` : ""} · paste a new key to replace it.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <FieldLabel>Plunk secret key</FieldLabel>
            <SecretInput
              value={secretKey}
              onChange={setSecretKey}
              placeholder="sk_…"
              testId="plunk-secret-key"
            />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel>From email</FieldLabel>
            <Input
              value={fromEmail}
              onChange={(event) => setFromEmail(event.target.value)}
              placeholder="hello@yourbusiness.com"
              data-testid="plunk-from-email"
            />
          </div>
          <div className="grid gap-1.5">
            <FieldLabel>From name</FieldLabel>
            <Input
              value={fromName}
              onChange={(event) => setFromName(event.target.value)}
              placeholder="Your Business"
              data-testid="plunk-from-name"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            onClick={onSave}
            disabled={saving || !workspaceId || !secretKey.trim()}
            data-testid="plunk-save"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            {hasByoKey ? "Save & verify" : "Connect Plunk"}
          </Button>
          {hasByoKey ? (
            <Button
              type="button"
              variant="outline"
              onClick={onRemove}
              disabled={removing}
              data-testid="plunk-remove"
            >
              {removing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Remove
            </Button>
          ) : null}
          <a
            className="ml-auto inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
            href="https://docs.useplunk.com/getting-started/introduction"
            target="_blank"
            rel="noreferrer noopener"
          >
            Plunk setup guide <ExternalLink className="size-3" />
          </a>
        </div>
        <p className="text-[11.5px] leading-5 text-muted-foreground">
          Stored encrypted — only the last 4 characters are ever shown again. Verified against Plunk on save.
        </p>
      </div>
    </section>
  );
}
