"use client";

import type { ReactNode } from "react";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useIsMobile } from "./use-is-mobile";

export type DetailTab = { value: string; label: string; content: ReactNode };

/**
 * The one slide-over for a record's full detail. Closed by default; opened only
 * by a table row click. A right-side Sheet on lg+, a bottom Drawer on mobile.
 * The body scrolls inside a ScrollArea, and an optional Tabs row carries
 * sub-views (e.g. the accounting view). Always renders a Title for a11y.
 */
export function DetailSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  attention,
  tabs,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  subtitle?: ReactNode;
  attention?: ReactNode;
  tabs?: DetailTab[];
  children?: ReactNode;
  footer?: ReactNode;
}) {
  const isMobile = useIsMobile();

  const body = (
    <ScrollArea className="min-h-0 flex-1">
      <div className="flex flex-col gap-4 px-4 pb-4">
        {attention ? <div className="flex flex-wrap gap-2">{attention}</div> : null}
        {tabs && tabs.length > 0 ? (
          <Tabs defaultValue={tabs[0].value}>
            <TabsList>
              {tabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((tab) => (
              <TabsContent key={tab.value} value={tab.value} className="pt-3">
                {tab.content}
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          children
        )}
      </div>
    </ScrollArea>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[88dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            {subtitle ? <DrawerDescription>{subtitle}</DrawerDescription> : null}
          </DrawerHeader>
          {body}
          {footer ? <div className="flex items-center justify-end gap-2 border-t p-4">{footer}</div> : null}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
        </SheetHeader>
        {body}
        {footer ? <div className="flex items-center justify-end gap-2 border-t p-4">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
