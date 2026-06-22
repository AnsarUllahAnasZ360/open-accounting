"use client";

import { usePaginatedQuery } from "convex/react";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Actor pill tones routed through semantic surfaces — AI uses the brand-green
// AI surface, a person uses the info-blue surface, rules/system stay neutral.
const ACTOR_STYLE: Record<string, string> = {
  ai: "bg-ai-surface text-ai",
  rule: "bg-muted text-muted-foreground",
  user: "bg-info-surface text-info",
  system: "bg-muted text-muted-foreground",
};

type ActorFilter = "all" | "ai" | "rule" | "user" | "system";

const PAGE_SIZE = 50;

// Debounce the free-text filter so each keystroke doesn't fire a fresh
// server-filtered page load.
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(handle);
  }, [value, ms]);
  return debounced;
}

export function AuditSection() {
  const { activeEntity } = useActiveEntity();
  const [text, setText] = useState("");
  const [actorKind, setActorKind] = useState<ActorFilter>("all");
  const [since, setSince] = useState("");

  const debouncedText = useDebounced(text, 300);
  const sinceMs = since ? Date.parse(`${since}T00:00:00.000Z`) : undefined;

  // E12-T7: server-side filtered, cursor-paginated audit log. `usePaginatedQuery`
  // accumulates pages and resets automatically whenever a filter arg changes, so
  // the whole dataset is never held or filtered in the browser — filters are
  // passed as ARGS and applied on the server, and "Load more" reaches events far
  // older than the most recent 200.
  const filterArgs = useMemo(
    () => ({
      ...(activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {}),
      ...(actorKind === "all" ? {} : { actorKind }),
      ...(sinceMs ? { sinceMs } : {}),
      ...(debouncedText ? { text: debouncedText } : {}),
    }),
    [activeEntity.id, actorKind, sinceMs, debouncedText],
  );

  const { results, status, loadMore } = usePaginatedQuery(api.audit.list, filterArgs, {
    initialNumItems: PAGE_SIZE,
  });

  if (status === "LoadingFirstPage") {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Loading audit log…</div>;
  }

  const rows = results;
  const canLoadMore = status === "CanLoadMore" || status === "LoadingMore";

  return (
    <div className="flex flex-col gap-3" data-testid="audit-section">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input className="h-9 pl-9" placeholder="Filter actions" value={text} onChange={(e) => setText(e.target.value)} data-testid="audit-filter-text" />
        </div>
        <Select value={actorKind} onValueChange={(v) => setActorKind(v as ActorFilter)}>
          <SelectTrigger className="h-9 w-36" data-testid="audit-filter-actor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">All actors</SelectItem>
              <SelectItem value="ai">AI</SelectItem>
              <SelectItem value="rule">Rule</SelectItem>
              <SelectItem value="user">Person</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input type="date" className="h-9 w-40" value={since} onChange={(e) => setSince(e.target.value)} data-testid="audit-filter-since" aria-label="Since date" />
      </div>

      <div className="overflow-hidden rounded-[14px] border bg-card shadow-xs">
        {/* Desktop header row. Columns size to auto/auto/flex so the Action
            column owns the remaining width and truncates instead of forcing a
            horizontal scrollbar. Hidden below sm where rows reflow to stacks. */}
        <div className="hidden grid-cols-[auto_auto_minmax(0,1fr)] gap-3 bg-muted/60 px-[18px] py-2.5 text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground sm:grid">
          <span>When</span>
          <span>Who / what</span>
          <span>Action</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-[18px] py-4 text-[12.5px] text-muted-foreground" data-testid="audit-empty">No matching events.</div>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              data-testid="audit-row"
              className="flex flex-col gap-1.5 border-t px-[18px] py-3 text-[12.5px] first:border-t-0 sm:grid sm:grid-cols-[auto_auto_minmax(0,1fr)] sm:items-center sm:gap-3 sm:py-2.5"
            >
              <span className="money-figures order-2 text-[11.5px] text-muted-foreground/70 sm:order-none sm:whitespace-nowrap">
                {new Date(row.when).toLocaleDateString("en-US")}
              </span>
              <span className="order-1 sm:order-none">
                <span
                  className={cn(
                    "inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-medium capitalize",
                    ACTOR_STYLE[(row.actor ?? "").toLowerCase()] ?? "bg-muted text-muted-foreground",
                  )}
                  data-testid={`audit-actor-${row.actor}`}
                >
                  {row.actor}
                </span>
              </span>
              <span className="order-3 min-w-0 text-foreground/80 sm:order-none sm:truncate" title={row.summary || row.action}>
                {row.summary || row.action}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Load-more advances the server cursor; older events stay reachable
          beyond the most recent 200 (E12-T7). */}
      {canLoadMore ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            data-testid="audit-load-more"
            disabled={status === "LoadingMore"}
            onClick={() => loadMore(PAGE_SIZE)}
          >
            {status === "LoadingMore" ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}

      <p className="text-[12px] text-muted-foreground/80">
        Every posting is recorded — who or what did it, and why. Corrections never overwrite; they reverse and repost.
      </p>
    </div>
  );
}
