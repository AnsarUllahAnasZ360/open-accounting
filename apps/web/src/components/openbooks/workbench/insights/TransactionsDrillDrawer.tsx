"use client";

import { useQuery } from "convex/react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

import { api } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { Amount, formatMinorMoney } from "@/components/openbooks/primitives";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { DetailSheet } from "../DetailSheet";

/**
 * The drill target a chart point or AI entity chip resolves to. One generic
 * callback shape every Insights consumer passes around: it identifies a slice of
 * the period to list the underlying transactions for. All fields beyond the
 * window are optional — a timeline point sets `day`, a counterparty chip sets
 * `counterparty`, a legend filter sets `direction`.
 */
export type DrillTarget = {
  /** Human title for the drawer header, e.g. "Jun 14" or "Acme Studio". */
  title: string;
  /** Active window the drill is scoped to (always the panel's active range). */
  from: string;
  to: string;
  day?: string;
  counterparty?: string;
  direction?: "in" | "out" | "all";
  /** Narrow to transactions still missing a category (the Uncategorized drill). */
  uncategorized?: boolean;
};

/**
 * The reusable drill drawer (E1.3 / E1.4): given a DrillTarget, it lists the
 * real underlying transactions for that point/segment using the same row shape
 * the register uses (date · counterparty · category, signed money on the right).
 * Entity-scoped — reads the auth-checked, bounded `coreViews.insightsDrill`
 * query. Opens as a right Sheet on desktop, a bottom Drawer on mobile (via the
 * shared DetailSheet). It only lists; it never posts (AI proposes, the ledger
 * posts), so there are no mutating actions here.
 */
export function TransactionsDrillDrawer({
  target,
  entityId,
  onOpenChange,
}: {
  target: DrillTarget | null;
  entityId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const open = target != null;
  const result = useQuery(
    api.coreViews.insightsDrill,
    target
      ? {
          ...(entityId ? { entityId: entityId as Id<"entities"> } : {}),
          from: target.from,
          to: target.to,
          ...(target.day ? { day: target.day } : {}),
          ...(target.counterparty ? { counterparty: target.counterparty } : {}),
          ...(target.direction ? { direction: target.direction } : {}),
          ...(target.uncategorized ? { uncategorized: true } : {}),
        }
      : "skip",
  );
  const loading = open && result === undefined;
  const rows = result?.rows ?? [];
  const currency = result?.currency ?? "USD";
  const totalMinor = rows.reduce((sum, row) => sum + row.amountMinor, 0);

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={target?.title ?? "Transactions"}
      subtitle={
        target
          ? `${rows.length} transaction${rows.length === 1 ? "" : "s"} · ${target.from} – ${target.to}`
          : undefined
      }
    >
      <div className="flex flex-col gap-3" data-testid="insights-drill-drawer">
        {/* Net for the drilled slice — money-in green, neutral otherwise. */}
        {!loading && rows.length > 0 ? (
          <div className="flex items-center justify-between rounded-[14px] p-3 ring-1 ring-foreground/10">
            <span className="text-xs text-muted-foreground">Net in this slice</span>
            <Amount
              amountMinor={totalMinor}
              currency={currency}
              signed
              tone={totalMinor > 0 ? "income" : "neutral"}
              className="text-base font-semibold"
            />
          </div>
        ) : null}

        {loading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12 rounded-[10px]" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">
            No transactions in this slice.
          </p>
        ) : (
          <ul className="flex flex-col">
            {rows.map((row) => {
              const inflow = row.amountMinor > 0;
              const FlowIcon = inflow ? ArrowDownLeft : ArrowUpRight;
              return (
                <li
                  key={row.id}
                  className="flex items-center gap-3 border-b py-2.5 last:border-b-0"
                  data-testid="insights-drill-row"
                >
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-full",
                      inflow ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                    )}
                    aria-hidden
                  >
                    <FlowIcon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{row.counterparty}</div>
                    <div className="money-figures truncate text-xs text-muted-foreground">
                      {row.date} · {row.categoryName}
                      {row.posted ? null : (
                        <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[10px] font-normal">
                          Unposted
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Amount
                    amountMinor={row.amountMinor}
                    currency={currency}
                    signed
                    tone={inflow ? "income" : "expense"}
                    className="shrink-0 text-sm font-medium"
                  />
                </li>
              );
            })}
            {rows.length >= 200 ? (
              <li className="pt-2 text-center text-xs text-muted-foreground">
                Showing the first 200. Narrow the period to see the rest.
              </li>
            ) : null}
          </ul>
        )}

        {!loading && rows.length > 0 ? (
          <p className="px-1 text-[11px] text-muted-foreground">
            Total for this slice:{" "}
            <span className="money-figures">
              {formatMinorMoney(Math.abs(totalMinor), { currency })}
            </span>
          </p>
        ) : null}
      </div>
    </DetailSheet>
  );
}
