import type { ReactNode } from "react";

import { PageHeader } from "@/components/openbooks/primitives";
import { cn } from "@/lib/utils";

/**
 * The standard scaffold every non-shell surface renders into. It wraps the
 * existing PageHeader, holds the page's action cluster, KPI strip, and an
 * optional attention banner, and keeps a single content frame so every page
 * shares the same width and vertical rhythm.
 */
export function WorkbenchPage({
  eyebrow,
  title,
  description,
  actions,
  kpis,
  attention,
  hideHeader = false,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  kpis?: ReactNode;
  attention?: ReactNode;
  hideHeader?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex w-full flex-col gap-5", className)}>
      {hideHeader ? (
        actions ? <div className="flex items-center justify-end">{actions}</div> : null
      ) : (
        <PageHeader
          eyebrow={eyebrow}
          title={title}
          description={description}
          actions={actions}
        />
      )}
      {attention ? <div>{attention}</div> : null}
      {kpis ? <div>{kpis}</div> : null}
      {children}
    </div>
  );
}
