"use client";

import { Archive } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Current books / Archived switch.
 *
 * When an owner re-bases their books to a start date, the earlier period is
 * taken OUT of their figures — but it is not deleted. Xero and QuickBooks both
 * keep pre-conversion data reachable (QuickBooks calls it "excluded"), and this
 * is OpenBooks' equivalent: the archive stays one click away, read-only.
 *
 * RULES THIS CONTROL OBEYS (plan §3.5):
 *
 *  - It renders ONLY when the business actually has a books-start date. A
 *    business that has never been re-based has no archive, and offering an empty
 *    view would invite the "where did my data go?" question this feature exists
 *    to prevent.
 *  - It is PER-SCREEN, never global. A switch that silently changed the
 *    Dashboard would recreate exactly the ambiguity we are removing.
 *  - It never appears on the Dashboard, Reports, the weekly digest or Ask AI.
 *    Those are headline financial positions and are always the working set.
 *
 * Design: neutral by default, quiet warning tint when archived is active.
 * Archived is a STATE, not an error — no alarm red, no badge colour.
 */
export function BooksWindowToggle({
  window,
  onChange,
  booksStartDate,
  className,
}: {
  window: "working" | "archived";
  onChange: (next: "working" | "archived") => void;
  /** Null when this business has never been re-based — the control hides itself. */
  booksStartDate: string | null;
  className?: string;
}) {
  if (!booksStartDate) return null;

  const options = [
    { value: "working" as const, label: "Current books" },
    { value: "archived" as const, label: "Archived" },
  ];

  return (
    <div
      className={cn("inline-flex items-center gap-2", className)}
      data-testid="books-window-toggle"
    >
      <div
        className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5"
        role="group"
        aria-label="Books period"
      >
        {options.map((option) => {
          const active = window === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              aria-pressed={active}
              data-testid={`books-window-${option.value}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1 text-[13px] font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.value === "archived" ? (
                <Archive className="size-3.5" aria-hidden="true" />
              ) : null}
              {option.label}
            </button>
          );
        })}
      </div>
      {/*
        Always say WHICH date the split is on. "Archived" alone leaves the owner
        guessing where the line falls, and the line is the whole point.
      */}
      <span className="text-[12.5px] text-muted-foreground">
        {window === "archived"
          ? `Before ${booksStartDate}`
          : `Since ${booksStartDate}`}
      </span>
    </div>
  );
}

/**
 * Banner shown above archived content.
 *
 * The archive is a genuinely different thing from the books, and a screen that
 * looks identical in both modes invites someone to read an archived total as
 * their real revenue. This says so in the header, not in a footnote.
 */
export function ArchivedBanner({ booksStartDate }: { booksStartDate: string }) {
  return (
    <section
      data-testid="archived-banner"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[14px] border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
    >
      <Archive className="size-4 shrink-0" aria-hidden="true" />
      <span>
        Showing activity from <span className="font-medium text-foreground">before {booksStartDate}</span>,
        when your books start. These figures are not part of your current books, and
        this view is read-only.
      </span>
    </section>
  );
}
