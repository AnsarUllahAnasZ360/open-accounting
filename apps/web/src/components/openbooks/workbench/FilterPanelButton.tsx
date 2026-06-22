"use client";

import { ChevronRight, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

import { AmountFilter, isAmountActive, type AmountValue } from "./AmountFilter";
import type { FacetOption } from "./FilterBar";
import { KeywordFilter } from "./KeywordFilter";
import { useIsMobile } from "./use-is-mobile";

export type FilterFacetSpec =
  | {
      kind: "options";
      key: string;
      label: string;
      icon?: LucideIcon;
      mode?: "single" | "multi";
      options: FacetOption[];
    }
  | { kind: "amount"; key: string; label: string; icon?: LucideIcon }
  | { kind: "keyword"; key: string; label: string; icon?: LucideIcon; recent?: string[] }
  | {
      kind: "custom";
      key: string;
      label: string;
      icon?: LucideIcon;
      active?: boolean;
      render: () => ReactNode;
    };

export type FilterPanelValue = Record<string, unknown>;

function specActive(spec: FilterFacetSpec, value: FilterPanelValue): boolean {
  if (spec.kind === "custom") return Boolean(spec.active);
  const current = value[spec.key];
  if (spec.kind === "amount") return isAmountActive(current as AmountValue | undefined);
  return Array.isArray(current) && current.length > 0;
}

function OptionsEditor({
  spec,
  value,
  onChange,
}: {
  spec: Extract<FilterFacetSpec, { kind: "options" }>;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  if (spec.mode === "single") {
    return (
      <ToggleGroup
        type="single"
        value={value[0] ?? ""}
        onValueChange={(next) => onChange(next ? [next] : [])}
        spacing={0}
        variant="outline"
        size="sm"
        className="flex-wrap justify-start"
      >
        {spec.options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value} variant="outline" size="sm">
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  }
  return (
    <ToggleGroup
      type="multiple"
      value={value}
      onValueChange={(next) => onChange(next)}
      spacing={0}
      variant="outline"
      size="sm"
      className="flex-wrap justify-start"
    >
      {spec.options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} variant="outline" size="sm">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function FacetEditor({
  spec,
  value,
  onChange,
}: {
  spec: FilterFacetSpec;
  value: FilterPanelValue;
  onChange: (key: string, next: unknown) => void;
}) {
  if (spec.kind === "custom") return <>{spec.render()}</>;
  if (spec.kind === "amount") {
    return (
      <AmountFilter
        value={(value[spec.key] as AmountValue) ?? {}}
        onChange={(next) => onChange(spec.key, next)}
      />
    );
  }
  if (spec.kind === "keyword") {
    return (
      <KeywordFilter
        value={(value[spec.key] as string[]) ?? []}
        onChange={(next) => onChange(spec.key, next)}
        recent={spec.recent}
      />
    );
  }
  return (
    <OptionsEditor
      spec={spec}
      value={(value[spec.key] as string[]) ?? []}
      onChange={(next) => onChange(spec.key, next)}
    />
  );
}

/**
 * The mega Filters panel: a left rail of facet names (each flagged when active)
 * driving a right-hand editor, mirroring Mercury's filter sheet. On desktop it's
 * a wide popover; on mobile it's a bottom drawer with the facets stacked. The
 * panel owns no state — every facet edits the page's filter value via onChange.
 */
export function FilterPanelButton({
  facets,
  value,
  onChange,
  onClearAll,
  align = "start",
}: {
  facets: FilterFacetSpec[];
  value: FilterPanelValue;
  onChange: (key: string, next: unknown) => void;
  onClearAll?: () => void;
  align?: "start" | "center" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [activeKey, setActiveKey] = useState(facets[0]?.key ?? "");
  const isMobile = useIsMobile();
  const activeCount = facets.filter((facet) => specActive(facet, value)).length;
  const selected = facets.find((facet) => facet.key === activeKey) ?? facets[0];

  const trigger = (
    <Button variant={activeCount > 0 ? "secondary" : "outline"} size="sm" className="w-fit">
      <SlidersHorizontal data-icon="inline-start" />
      Filters
      {activeCount > 0 ? (
        <Badge variant="outline" className="money-figures">
          {activeCount}
        </Badge>
      ) : null}
    </Button>
  );

  const footer = (
    <div className="flex items-center justify-between border-t px-3 py-2">
      <Button variant="ghost" size="sm" onClick={() => onClearAll?.()} disabled={activeCount === 0}>
        Clear all
      </Button>
      <Button size="sm" onClick={() => setOpen(false)}>
        Done
      </Button>
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={setOpen}>
        <div onClick={() => setOpen(true)}>{trigger}</div>
        <DrawerContent className="max-h-[88dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>Filter this view</DrawerTitle>
          </DrawerHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-4 px-4 pb-4">
              {facets.map((facet) => (
                <div key={facet.key} className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    {facet.icon ? <facet.icon className="size-3.5" /> : null}
                    {facet.label}
                    {specActive(facet, value) ? (
                      <span className="size-1.5 rounded-full bg-primary" aria-hidden />
                    ) : null}
                  </span>
                  <FacetEditor spec={facet} value={value} onChange={onChange} />
                </div>
              ))}
            </div>
          </ScrollArea>
          {footer}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        collisionPadding={16}
        sideOffset={6}
        className="w-[min(36rem,calc(100vw-2rem))] p-0"
      >
        <div className="grid grid-cols-[10rem_1fr]">
          <div className="flex flex-col gap-0.5 border-r p-2">
            {facets.map((facet) => {
              const isActive = facet.key === selected?.key;
              const Icon = facet.icon;
              return (
                <button
                  key={facet.key}
                  type="button"
                  onClick={() => setActiveKey(facet.key)}
                  className={cn(
                    "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none",
                    isActive ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {Icon ? <Icon className="size-4 shrink-0" /> : null}
                  <span className="min-w-0 flex-1 truncate">{facet.label}</span>
                  {specActive(facet, value) ? (
                    <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="min-w-0 p-3">
            {selected ? (
              <div className="flex flex-col gap-2">
                <div className="text-sm font-medium">{selected.label}</div>
                <FacetEditor spec={selected} value={value} onChange={onChange} />
              </div>
            ) : null}
          </div>
        </div>
        {footer}
      </PopoverContent>
    </Popover>
  );
}
