"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { Check, ExternalLink, Pencil } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import { SettingsCard } from "@/components/openbooks/settings/_shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type NotifKey = "review" | "digest" | "anomaly" | "sync" | "owed" | "close" | "marketing";

const GROUPS: Array<{ label: string; items: Array<{ id: NotifKey; title: string; sub: string }> }> = [
  {
    label: "From the AI",
    items: [
      { id: "review", title: "Needs your input", sub: "When the AI is unsure and parks a transaction in your Inbox" },
      { id: "digest", title: "Weekly digest", sub: "A Monday-morning recap of what posted, what's owed and what's due" },
      { id: "anomaly", title: "Unusual activity", sub: "Duplicate charges, silent price hikes, a spend 3× the usual" },
    ],
  },
  {
    label: "Accounts & money",
    items: [
      { id: "sync", title: "Sync problems", sub: "A bank sign-in expired or a Stripe key stopped working" },
      { id: "owed", title: "Money owed", sub: "An invoice goes overdue, or a bill is due in 3 days" },
      { id: "close", title: "Month-end close", sub: "A reminder to lock the books a few days after month end" },
    ],
  },
  {
    label: "Other",
    items: [{ id: "marketing", title: "Product updates", sub: "Occasional notes on new features — off by default" }],
  },
];

export function NotificationsSection() {
  const data = useQuery(api.settings.notificationPreferences, {});
  const setNotification = useMutation(api.settings.setNotification);
  const setNotificationEmail = useMutation(api.settings.setNotificationEmail);
  const setNotificationCadence = useMutation(api.settings.setNotificationCadence);

  // Optimistic local overlay so toggles feel instant before the query refetches.
  const [overrides, setOverrides] = useState<Partial<Record<NotifKey, boolean>>>({});
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailError, setEmailError] = useState("");

  if (data === undefined) {
    return <SettingsCard className="text-sm text-muted-foreground">Loading…</SettingsCard>;
  }

  const value = (key: NotifKey) => overrides[key] ?? data.notifications[key];

  async function toggle(key: NotifKey) {
    const next = !value(key);
    setOverrides((prev) => ({ ...prev, [key]: next }));
    try {
      await setNotification({ key, enabled: next });
    } catch {
      setOverrides((prev) => ({ ...prev, [key]: !next }));
    }
  }

  async function saveEmail() {
    const email = emailDraft.trim();
    if (email.length > 0 && !EMAIL_RE.test(email)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailBusy(true);
    setEmailError("");
    setEmailSaved(false);
    try {
      await setNotificationEmail({ email });
      setEmailSaved(true);
      setEditingEmail(false);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Could not save the email.");
    } finally {
      setEmailBusy(false);
    }
  }

  async function changeCadence(cadence: "off" | "weekly" | "monthly") {
    // Optimistically reflect the digest master-switch toggle locally.
    setOverrides((prev) => ({ ...prev, digest: cadence !== "off" }));
    try {
      await setNotificationCadence({ cadence });
    } catch {
      setOverrides((prev) => ({ ...prev, digest: data!.digestCadence !== "off" }));
    }
  }

  // Show the optimistic digest toggle in the cadence control too.
  const effectiveCadence: "off" | "weekly" | "monthly" =
    overrides.digest === undefined
      ? data.digestCadence
      : overrides.digest
        ? data.digestCadence === "off"
          ? "weekly"
          : data.digestCadence
        : "off";

  return (
    <div className="flex flex-col gap-3" data-testid="notifications-section">
      {/* Delivery email — editable inline (E12-T5). */}
      <SettingsCard className="flex flex-col gap-2.5" testId="notif-delivery">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[12.5px] text-muted-foreground">Sent to</span>
          {editingEmail ? (
            <>
              <Input
                data-testid="notif-email-input"
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                placeholder="you@business.com"
                className="h-8 w-60 font-mono text-[12.5px]"
              />
              <Button size="sm" data-testid="notif-email-save" disabled={emailBusy} onClick={saveEmail}>
                {emailBusy ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setEditingEmail(false); setEmailError(""); }}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <span className="font-mono text-[12.5px]" data-testid="notif-email">{data.email || "your account email"}</span>
              <button
                type="button"
                data-testid="notif-email-edit"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => { setEmailDraft(data.email); setEditingEmail(true); setEmailSaved(false); }}
                aria-label="Edit delivery email"
              >
                <Pencil className="size-3.5" />
              </button>
              {emailSaved ? (
                <span className="inline-flex items-center gap-1 text-[12px] text-primary" data-testid="notif-email-saved">
                  <Check className="size-3.5" /> Saved
                </span>
              ) : null}
            </>
          )}
        </div>
        {emailError ? <p className="text-[12px] text-destructive">{emailError}</p> : null}

        {/* Honest Plunk status row (E12-T5). */}
        {data.emailDeliveryConfigured ? (
          <div className="flex items-center gap-2 text-[12px] text-primary" data-testid="notif-plunk-active">
            <Check className="size-3.5" /> Email delivery active via Plunk
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground" data-testid="notif-plunk-setup">
            <span>Email isn&rsquo;t connected yet — digests stay in your Inbox until you add a Plunk key.</span>
            <Button asChild size="sm" variant="outline">
              <Link href="/settings/connections" data-testid="notif-plunk-link">
                Set up email <ExternalLink className="size-3.5" />
              </Link>
            </Button>
          </div>
        )}
      </SettingsCard>

      {/* Weekly-digest cadence (E12-T5). */}
      <SettingsCard className="flex flex-wrap items-center justify-between gap-3" testId="notif-cadence">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">Digest cadence</div>
          <div className="text-[11.5px] text-muted-foreground">How often the recap email goes out. Off keeps it in your Inbox only.</div>
        </div>
        <Label htmlFor="notif-cadence-select" className="sr-only">Digest cadence</Label>
        <Select value={effectiveCadence} onValueChange={(v) => changeCadence(v as "off" | "weekly" | "monthly")}>
          <SelectTrigger id="notif-cadence-select" data-testid="notif-cadence-select" className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="off">Off</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsCard>

      {GROUPS.map((group) => (
        <SettingsCard key={group.label} padded={false} className="overflow-hidden">
          <div className="bg-muted/60 px-[18px] py-2.5 text-[12px] font-semibold text-muted-foreground">{group.label}</div>
          {group.items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 border-t px-[18px] py-3 first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{item.title}</div>
                <div className="text-[11.5px] text-muted-foreground">{item.sub}</div>
              </div>
              <Switch
                data-testid={`notif-${item.id}`}
                data-active={value(item.id) ? "true" : "false"}
                checked={value(item.id)}
                onCheckedChange={() => toggle(item.id)}
                aria-label={`Toggle ${item.title}`}
              />
            </div>
          ))}
        </SettingsCard>
      ))}
      <p className="text-[12px] text-muted-foreground/80">
        Anything urgent always lands in your Inbox too — these settings only control the email and digest copies.
      </p>
    </div>
  );
}
