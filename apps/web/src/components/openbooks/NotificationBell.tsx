"use client";

import { useMutation, useQuery } from "convex/react";
import { Bell, CheckCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function NotificationBell({ workspaceId }: { workspaceId?: string }) {
  const data = useQuery(api.notifications.list, workspaceId ? { workspaceId: workspaceId as Id<"workspaces"> } : {});
  const markRead = useMutation(api.notifications.markRead);
  const markAllRead = useMutation(api.notifications.markAllRead);
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const unread = data?.unreadCount ?? 0;
  const items = data?.notifications ?? [];

  async function openNotification(item: (typeof items)[number]) {
    setOpen(false);
    if (!item.read) {
      try {
        await markRead({ notificationId: item.id as Id<"notifications"> });
      } catch {
        // non-fatal; navigation still proceeds
      }
    }
    if (item.link) router.push(item.link);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              aria-label={unread > 0 ? `Notifications (${unread} unread)` : "Notifications"}
              data-testid="notifications-trigger"
              size="icon-sm"
              variant="outline"
              className="relative"
            >
              <Bell />
              {unread > 0 ? (
                <span
                  className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
                  data-testid="notifications-unread-count"
                >
                  {unread > 9 ? "9+" : unread}
                </span>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-0" data-testid="notifications-panel">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground"
              onClick={() => void markAllRead(workspaceId ? { workspaceId: workspaceId as Id<"workspaces"> } : {})}
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </Button>
          ) : null}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">You&apos;re all caught up.</div>
          ) : (
            <ul>
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openNotification(item)}
                    data-testid="notification-item"
                    className={cn(
                      "flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left last:border-b-0 hover:bg-muted/50",
                      !item.read && "bg-primary/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        item.read ? "bg-transparent" : "bg-primary",
                      )}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium leading-snug">{item.title}</span>
                      {item.body ? <span className="block text-xs text-muted-foreground">{item.body}</span> : null}
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{relativeTime(item.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
