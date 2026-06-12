"use client";

import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Input } from "@/components/ui/input";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const ACTOR_STYLE: Record<string, string> = {
  ai: "bg-[#f1f8ee] text-[#1d6b12]",
  rule: "bg-muted text-[#525252]",
  user: "bg-[#eff8ff] text-[#175cd3]",
  system: "bg-muted text-muted-foreground",
};

export function AuditSection() {
  const { activeEntity } = useActiveEntity();
  const data = useQuery(
    api.moduleViews.overview,
    activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {},
  );
  const [text, setText] = useState("");
  const [actorKind, setActorKind] = useState<"all" | "ai" | "rule" | "user" | "system">("all");
  const [since, setSince] = useState("");

  const rows = useMemo(() => {
    const all = data?.settings.audit.rows ?? [];
    const sinceMs = since ? Date.parse(`${since}T00:00:00.000Z`) : null;
    return all.filter((row) => {
      const kind = (row.actor ?? "").toLowerCase();
      const haystack = `${row.actor} ${row.action} ${row.summary}`.toLowerCase();
      const textMatch = haystack.includes(text.trim().toLowerCase());
      const actorMatch = actorKind === "all" || kind === actorKind;
      const dateMatch = sinceMs === null || row.when >= sinceMs;
      return textMatch && actorMatch && dateMatch;
    });
  }, [data, text, actorKind, since]);

  if (data === undefined) {
    return <div className="rounded-[14px] border bg-card p-5 text-sm text-muted-foreground shadow-xs">Loading audit log…</div>;
  }

  return (
    <div className="flex flex-col gap-3" data-testid="audit-section">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input className="h-9 pl-9" placeholder="Filter actions" value={text} onChange={(e) => setText(e.target.value)} data-testid="audit-filter-text" />
        </div>
        <Select value={actorKind} onValueChange={(v) => setActorKind(v as typeof actorKind)}>
          <SelectTrigger className="h-9 w-36" data-testid="audit-filter-actor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actors</SelectItem>
            <SelectItem value="ai">AI</SelectItem>
            <SelectItem value="rule">Rule</SelectItem>
            <SelectItem value="user">Person</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" className="h-9 w-40" value={since} onChange={(e) => setSince(e.target.value)} data-testid="audit-filter-since" aria-label="Since date" />
      </div>

      <div className="overflow-hidden rounded-[14px] border bg-card shadow-xs">
        <div className="grid grid-cols-[120px_120px_1fr] gap-2.5 bg-muted/60 px-[18px] py-2.5 text-[11px] font-semibold uppercase tracking-[0.03em] text-muted-foreground">
          <span>When</span>
          <span>Who / what</span>
          <span>Action</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-[18px] py-4 text-[12.5px] text-muted-foreground" data-testid="audit-empty">No matching events.</div>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="grid grid-cols-[120px_120px_1fr] items-center gap-2.5 border-t px-[18px] py-2.5 text-[12.5px]" data-testid="audit-row">
              <span className="money-figures text-[11.5px] text-muted-foreground/70">{new Date(row.when).toLocaleDateString("en-US")}</span>
              <span>
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
              <span className="text-[#3d3d3d]">{row.summary || row.action}</span>
            </div>
          ))
        )}
      </div>
      <p className="text-[12px] text-muted-foreground/80">
        Every posting is recorded — who or what did it, and why. Corrections never overwrite; they reverse and repost.
      </p>
    </div>
  );
}
