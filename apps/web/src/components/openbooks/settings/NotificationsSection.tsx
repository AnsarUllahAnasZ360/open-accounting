"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import { cn } from "@/lib/utils";

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

  // Optimistic local overlay so toggles feel instant before the query refetches.
  const [overrides, setOverrides] = useState<Partial<Record<NotifKey, boolean>>>({});

  if (data === undefined) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Loading…</div>;
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

  return (
    <div className="flex flex-col gap-3" data-testid="notifications-section">
      <div className="flex items-center gap-2.5 rounded-[12px] border bg-muted/40 px-4 py-2.5">
        <span className="text-[12.5px] text-[#525252]">Sent to</span>
        <span className="font-mono text-[12.5px]">{data.email || "your account email"}</span>
        <div className="flex-1" />
        {!data.emailDeliveryConfigured ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
            Email delivery wired to Plunk when configured
          </span>
        ) : null}
      </div>

      {GROUPS.map((group) => (
        <div key={group.label} className="overflow-hidden rounded-[14px] border bg-card shadow-xs">
          <div className="bg-muted/60 px-[18px] py-2.5 text-[12px] font-semibold text-muted-foreground">{group.label}</div>
          {group.items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 border-t px-[18px] py-3 first:border-t-0">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">{item.title}</div>
                <div className="text-[11.5px] text-muted-foreground">{item.sub}</div>
              </div>
              <button
                type="button"
                data-testid={`notif-${item.id}`}
                data-active={value(item.id) ? "true" : "false"}
                onClick={() => toggle(item.id)}
                className={cn("relative h-[19px] w-[34px] shrink-0 rounded-full transition-colors", value(item.id) ? "bg-primary" : "bg-muted-foreground/40")}
                aria-label={`Toggle ${item.title}`}
              >
                <span className={cn("absolute top-0.5 size-[15px] rounded-full bg-white shadow transition-all", value(item.id) ? "left-[17px]" : "left-0.5")} />
              </button>
            </div>
          ))}
        </div>
      ))}
      <p className="text-[12px] text-muted-foreground/80">
        Anything urgent always lands in your Inbox too — these settings only control the email and digest copies.
      </p>
    </div>
  );
}
