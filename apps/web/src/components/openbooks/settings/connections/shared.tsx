"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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

export type ConnectionTone = "ok" | "warn" | "bad" | "muted";

export type ConnectionBusiness = { id: string; name: string };

/** Quiet status pill. Money-in green for healthy, never alarm-red for ordinary
 * "off" states — only true failures use the negative surface. */
export function StatusPill({
  tone,
  children,
  className,
}: {
  tone: ConnectionTone;
  children: React.ReactNode;
  className?: string;
}) {
  const toneClass =
    tone === "ok"
      ? "bg-ob-green-50 text-ob-green-800"
      : tone === "warn"
        ? "bg-warning-surface text-warning"
        : tone === "bad"
          ? "bg-negative-surface text-negative"
          : "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        toneClass,
        className,
      )}
    >
      {children}
    </span>
  );
}

// Plain-English status mapping. The backend speaks in machine codes
// (relink_required, pending_oauth, not_configured); owners should never see them.
export function humanizeItemStatus(status?: string | null): { label: string; tone: ConnectionTone } {
  switch (status) {
    case "active":
      return { label: "Connected", tone: "ok" };
    case "relink_required":
      return { label: "Reconnect needed", tone: "warn" };
    case "disconnected":
      return { label: "Disconnected", tone: "muted" };
    default:
      return { label: "Needs review", tone: "warn" };
  }
}

export function humanizeConnectionStatus(status?: string | null): { label: string; tone: ConnectionTone } {
  switch (status) {
    case "active":
      return { label: "Connected", tone: "ok" };
    case "relink_required":
      return { label: "Reconnect needed", tone: "warn" };
    case "pending_oauth":
      return { label: "Finish in popup", tone: "warn" };
    case "configuration_required":
      return { label: "Setup needed", tone: "warn" };
    case "disconnected":
      return { label: "Disconnected", tone: "muted" };
    default:
      return { label: status ?? "Unknown", tone: "muted" };
  }
}

export function humanizeWebhookStatus(status?: string | null): { label: string; tone: ConnectionTone } | null {
  switch (status) {
    case "listening":
      return { label: "Live updates on", tone: "ok" };
    case "pending_verification":
      // E3-T6: a secret is saved but no signed delivery has confirmed it yet.
      return { label: "Webhook unverified", tone: "warn" };
    case "failing":
      return { label: "Webhook failing", tone: "bad" };
    case "not_configured":
      return { label: "Real-time off", tone: "muted" };
    default:
      return null;
  }
}

export function formatRelative(value?: number | null): string {
  if (!value) return "Not synced yet";
  const diff = Date.now() - value;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "Synced just now";
  if (mins < 60) return `Synced ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Synced ${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `Synced ${days}d ago`;
  return `Synced ${new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

export function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const uncaught = error.message.match(/Uncaught \w*Error: ([\s\S]+)/);
  if (uncaught) return uncaught[1].trim().split("\n")[0] ?? fallback;
  return error.message;
}

/** Read-only endpoint URL with a one-click copy. Used for the Stripe/Plaid
 * webhook URLs and the Plaid OAuth redirect the owner registers in each
 * provider dashboard. */
export function WebhookField({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  function onCopy() {
    if (!value) return;
    void navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        toast.success(`${label} copied`);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => toast.error("Could not copy to clipboard."));
  }
  return (
    <div className="grid gap-1.5">
      <Label className="text-[12px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-2">
        <code
          className="min-w-0 flex-1 truncate rounded-[8px] border bg-muted/40 px-2.5 py-2 font-mono text-[12px]"
          title={value || undefined}
          data-testid={`webhook-value-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}
        >
          {value || "Not available in this environment"}
        </code>
        <Button type="button" variant="outline" size="sm" disabled={!value} onClick={onCopy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {hint ? <p className="text-[11.5px] leading-5 text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Masked input with a reveal toggle — so the owner can verify a long key
 * before saving, then hide it again. */
export function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete = "off",
  testId,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  testId?: string;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={reveal ? "text" : "password"}
        placeholder={placeholder}
        autoComplete={autoComplete}
        spellCheck={false}
        className="pr-9 font-mono"
      />
      <button
        type="button"
        onClick={() => setReveal((current) => !current)}
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={reveal ? "Hide secret" : "Show secret"}
        tabIndex={-1}
      >
        {reveal ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function BusinessSelect({
  businesses,
  value,
  onChange,
  disabled,
  testId,
}: {
  businesses: ConnectionBusiness[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger data-testid={testId}>
        <SelectValue placeholder="Choose a business" />
      </SelectTrigger>
      <SelectContent>
        {businesses.map((business) => (
          <SelectItem key={business.id} value={business.id}>
            {business.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Label className="text-[12px] font-medium text-muted-foreground">{children}</Label>;
}
