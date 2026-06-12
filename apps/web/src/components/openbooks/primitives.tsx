import {
  ArrowRight,
  BarChart3,
  Check,
  CircleAlert,
  Inbox,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type CurrencyCode = "USD" | "EUR" | "GBP" | "INR" | string;

export function formatMinorMoney(
  amountMinor: number,
  { currency = "USD", compact = false }: { currency?: CurrencyCode; compact?: boolean } = {},
) {
  const amount = amountMinor / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    maximumFractionDigits: compact ? 1 : 2,
    minimumFractionDigits: compact ? 0 : 2,
  }).format(amount);
}

export function Amount({
  amountMinor,
  currency = "USD",
  signed = false,
  compact = false,
  tone = "neutral",
  className,
}: {
  amountMinor: number;
  currency?: CurrencyCode;
  signed?: boolean;
  compact?: boolean;
  tone?: "neutral" | "income" | "expense";
  className?: string;
}) {
  const sign = signed && amountMinor > 0 ? "+" : "";
  return (
    <span
      className={cn(
        "money-figures whitespace-nowrap",
        tone === "income" && "text-primary",
        tone === "expense" && "text-muted-foreground",
        className,
      )}
    >
      {sign}
      {formatMinorMoney(amountMinor, { currency, compact })}
    </span>
  );
}

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  trend,
  children,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  icon?: LucideIcon;
  trend?: string;
  children?: ReactNode;
}) {
  return (
    <Card className="shadow-xs">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-2xl font-semibold">{value}</div>
        {detail || trend ? (
          <div className="flex items-center justify-between gap-3">
            {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : <span />}
            {trend ? <Badge variant="outline">{trend}</Badge> : null}
          </div>
        ) : null}
        {children}
      </CardContent>
    </Card>
  );
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center">
      <Icon className="size-10 text-muted-foreground" strokeWidth={1.5} />
      <div className="mt-3 text-sm font-medium">{title}</div>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div className="min-w-0">
        {eyebrow ? <p className="text-sm text-muted-foreground">{eyebrow}</p> : null}
        <h1 className="text-2xl font-semibold leading-tight">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Sparkline({
  data,
  className,
}: {
  data: number[];
  className?: string;
}) {
  if (data.length < 2) return null;
  const width = 120;
  const height = 36;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data.map((value, index) => {
    const x = 2 + (index / (data.length - 1)) * (width - 4);
    const y = 2 + (1 - (value - min) / range) * (height - 4);
    return [x, y] as const;
  });
  const line = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${points[points.length - 1][0].toFixed(1)},${height} L${points[0][0].toFixed(1)},${height} Z`;
  return (
    <svg aria-hidden="true" className={cn("h-9 w-full", className)} viewBox={`0 0 ${width} ${height}`}>
      <path d={area} fill="currentColor" opacity="0.08" />
      <path d={line} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}

export function BarChart({
  data,
}: {
  data: Array<{ label: string; value: number }>;
}) {
  const max = Math.max(...data.map((item) => Math.abs(item.value)), 1);
  return (
    <div className="flex h-36 items-end gap-2" aria-label="Bar chart">
      {data.map((item) => (
        <div key={item.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
          <div className="flex h-28 w-full items-end border-b">
            <div
              className={cn("mx-auto w-5 rounded-t bg-primary", item.value < 0 && "bg-muted-foreground")}
              style={{ height: `${Math.max(6, (Math.abs(item.value) / max) * 112)}px` }}
            />
          </div>
          <span className="w-full truncate text-center text-xs text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export function CategoryChip({
  label,
  active = false,
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium",
        active ? "border-primary/30 bg-primary/10 text-primary" : "text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

export function ConfidenceRing({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <span className="relative inline-flex size-9 items-center justify-center">
      <svg className="absolute inset-0 size-9 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
        <circle className="stroke-muted" cx="18" cy="18" fill="none" r="15" strokeWidth="3" />
        <circle
          className="stroke-primary"
          cx="18"
          cy="18"
          fill="none"
          r="15"
          strokeDasharray={`${(clamped / 100) * 94.25} 94.25`}
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
      <span className="money-figures text-[10px] font-medium">{clamped}</span>
    </span>
  );
}

export function AgingMiniBar({
  current,
  days30,
  days60,
  days90,
}: {
  current: number;
  days30: number;
  days60: number;
  days90: number;
}) {
  const total = Math.max(current + days30 + days60 + days90, 1);
  const segments = [
    { label: "Current", value: current, className: "bg-primary" },
    { label: "30", value: days30, className: "bg-muted-foreground/45" },
    { label: "60", value: days60, className: "bg-muted-foreground/65" },
    { label: "90", value: days90, className: "bg-muted-foreground" },
  ];
  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {segments.map((segment) => (
          <span
            key={segment.label}
            aria-label={segment.label}
            className={segment.className}
            style={{ width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        {segments.map((segment) => (
          <span key={segment.label}>{segment.label}</span>
        ))}
      </div>
    </div>
  );
}

export function ReasoningPopover({ children }: { children: ReactNode }) {
  return (
    <details className="group relative">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-primary">
        <Sparkles className="size-3" />
        Reasoning
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md">
        {children}
      </div>
    </details>
  );
}

export function ReviewItem({
  counterparty,
  date,
  amountMinor,
  question,
  options,
}: {
  counterparty: string;
  date: string;
  amountMinor: number;
  question: string;
  options: string[];
}) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">{counterparty}</div>
          <div className="money-figures mt-0.5 text-xs text-muted-foreground">{date}</div>
        </div>
        <div className="flex items-center gap-2">
          <Amount amountMinor={amountMinor} tone={amountMinor > 0 ? "income" : "expense"} />
          <Badge variant="outline">
            <CircleAlert className="size-3" />
            Review
          </Badge>
        </div>
      </div>
      <div className="mt-3 flex gap-2 text-sm text-muted-foreground">
        <Sparkles className="mt-0.5 size-4 text-primary" />
        <span>{question}</span>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((option) => (
          <Button key={option} size="sm" variant="outline">
            <Check className="size-3" />
            {option}
          </Button>
        ))}
        <Button size="sm" variant="ghost">
          Skip
          <ArrowRight className="size-3" />
        </Button>
      </div>
    </div>
  );
}

export const primitiveIcons = {
  BarChart3,
  Inbox,
};
