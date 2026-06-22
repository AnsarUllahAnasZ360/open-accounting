"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

export type SectionTabItem = {
  /** Sub-tab slug, e.g. "invoices" or the default "income". */
  id: string;
  label: string;
  /** Quiet subtitle (e.g. "Accounts receivable") shown under the label. */
  subtitle?: string;
  /** Absolute href the tab links to, e.g. "/income/invoices" or "/income". */
  href: string;
};

/**
 * The section sub-tab bar (Epic E0.3). A presentational underline tab strip
 * rendered under the section title for every operational section, so each
 * section feels like the same page with different data. It does NOT own
 * routing — it links to sibling sub-tab URLs and highlights the active one
 * (passed in from the URL-derived active id). Behavior contract:
 *  - 2px brand-green (#2ca01c via `--primary`) active underline
 *  - medium-weight active label, muted inactive labels
 *  - mobile: same bar, horizontally scrollable, active auto-scrolled into view
 *  - real <Link> navigation so deep-links and the back button stay correct
 */
export function SectionTabs({
  items,
  activeId,
  className,
}: {
  items: ReadonlyArray<SectionTabItem>;
  activeId: string;
  className?: string;
}) {
  const activeRef = useRef<HTMLAnchorElement | null>(null);
  const searchParams = useSearchParams();

  // Keep the active tab in view on narrow screens when the active id changes
  // (e.g. deep-linking to a trailing sub-tab on mobile).
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeId]);

  // Carry the live toolbar query string (period / search / filters, set by the
  // workbench URL-state hook) across a sub-tab switch so it survives the
  // path-only navigation (E0.4 acceptance: filters retained when switching to
  // Insights and back).
  const queryString = searchParams.toString();
  const withQuery = (href: string) => (queryString ? `${href}?${queryString}` : href);

  if (items.length <= 1) return null;

  return (
    <nav
      aria-label="Section views"
      data-testid="section-tabs"
      className={cn(
        // Underline rail spans the full width; the bar scrolls horizontally on
        // mobile and the scrollbar is hidden so it reads as a clean tab strip.
        "relative -mb-px flex max-w-full items-stretch gap-1 overflow-x-auto border-b border-border",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {items.map((item) => {
        const isActive = item.id === activeId;
        return (
          <Link
            key={item.id}
            href={withQuery(item.href)}
            ref={isActive ? activeRef : undefined}
            aria-current={isActive ? "page" : undefined}
            data-testid={`section-tab-${item.id}`}
            data-active={isActive ? "true" : undefined}
            className={cn(
              "group flex shrink-0 flex-col gap-0.5 whitespace-nowrap px-3 pb-2.5 pt-1.5 text-sm transition-colors",
              // 2px active underline in brand green; inactive shows a transparent
              // 2px border so the label never shifts when it becomes active.
              "border-b-2",
              isActive
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span>{item.label}</span>
            {item.subtitle ? (
              <span
                className={cn(
                  "text-[11px] font-normal leading-none",
                  isActive ? "text-muted-foreground" : "text-muted-foreground/70",
                )}
              >
                {item.subtitle}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
