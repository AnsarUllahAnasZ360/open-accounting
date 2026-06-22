"use client";

import { MoreHorizontal, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type ActionItem = {
  label: string;
  icon?: LucideIcon;
  onClick?: () => void;
  disabled?: boolean;
};

/**
 * The right-aligned page action cluster. The primary action stays a solid
 * button; secondary actions show as outline buttons on desktop and collapse
 * into a single overflow menu below md so the bar never wraps under the title.
 * ExportMenu and any other control can be dropped in as children.
 */
export function PageActionBar({
  primary,
  actions = [],
  children,
  className,
}: {
  primary?: { label: string; icon?: LucideIcon; onClick?: () => void; disabled?: boolean; testId?: string };
  actions?: ActionItem[];
  children?: ReactNode;
  className?: string;
}) {
  const PrimaryIcon = primary?.icon;
  const hasOverflow = actions.length > 0;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {children}

      {/* Secondary actions: inline on desktop, overflow menu on mobile. */}
      {hasOverflow ? (
        <>
          <div className="hidden items-center gap-2 md:flex">
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Button
                  key={action.label}
                  variant="outline"
                  size="sm"
                  onClick={action.onClick}
                  disabled={action.disabled}
                >
                  {Icon ? <Icon data-icon="inline-start" /> : null}
                  {action.label}
                </Button>
              );
            })}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-sm" className="md:hidden" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {actions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <DropdownMenuItem
                      key={action.label}
                      onClick={action.onClick}
                      disabled={action.disabled}
                    >
                      {Icon ? <Icon /> : null}
                      {action.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}

      {primary ? (
        <Button size="sm" onClick={primary.onClick} disabled={primary.disabled} data-testid={primary.testId}>
          {PrimaryIcon ? <PrimaryIcon data-icon="inline-start" /> : null}
          {primary.label}
        </Button>
      ) : null}
    </div>
  );
}
