"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, PanelRightClose, Search, Sparkles, X } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { appRoutes, mobileRoutes } from "@/lib/openbooks/content";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 w-[232px] border-r bg-sidebar transition-transform lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-full flex-col">
          <div className="border-b px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <Link href="/dashboard" className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  OB
                </span>
                <span>
                  <span className="block text-sm font-semibold">OpenBooks</span>
                  <span className="block text-xs text-muted-foreground">Acme Studio LLC</span>
                </span>
              </Link>
              <Button
                aria-label="Close navigation"
                className="lg:hidden"
                size="icon-sm"
                variant="ghost"
                onClick={() => setSidebarOpen(false)}
              >
                <X />
              </Button>
            </div>
            <button className="mt-4 flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2 text-left text-sm">
              <span>Acme Studio LLC</span>
              <span className="text-muted-foreground">Demo</span>
            </button>
          </div>

          <nav className="flex-1 space-y-1 px-3 py-4">
            {appRoutes.map((route) => {
              const active = pathname === route.href;
              const Icon = route.icon;
              return (
                <Link
                  key={route.href}
                  href={route.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  <span>{route.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t px-4 py-4 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>Sync status</span>
              <span className="text-foreground">Ready</span>
            </div>
            <div className="mt-1">Seed and sandbox connections pending.</div>
          </div>
        </div>
      </aside>

      <div className={cn("min-h-screen pb-16 transition-[padding] lg:pb-0 lg:pl-[232px]", aiOpen && "xl:pr-[380px]")}>
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur-none lg:px-6">
          <div className="flex items-center gap-3">
            <Button
              aria-label="Open navigation"
              className="lg:hidden"
              size="icon-sm"
              variant="outline"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu />
            </Button>
            <button className="hidden h-8 min-w-[260px] items-center gap-2 rounded-lg border px-3 text-sm text-muted-foreground md:flex">
              <Search className="size-4" />
              <span>Search transactions, contacts, reports</span>
            </button>
          </div>
          <Button variant="outline" onClick={() => setAiOpen((value) => !value)}>
            <Sparkles />
            Ask AI
          </Button>
        </header>

        <main className="mx-auto w-full max-w-[1200px] px-4 py-5 lg:px-6">{children}</main>
      </div>

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-40 w-full max-w-[380px] border-l bg-background transition-transform",
          aiOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-primary" />
            Ask AI
          </div>
          <Button aria-label="Close Ask AI" size="icon-sm" variant="ghost" onClick={() => setAiOpen(false)}>
            <PanelRightClose />
          </Button>
        </div>
        <div className="flex h-[calc(100%-3.5rem)] flex-col justify-between p-4">
          <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            Chat activates in M10 after the read tools and propose-to-confirm actions are wired.
          </div>
          <div className="rounded-lg border bg-background p-3 text-sm text-muted-foreground">
            Context: {appRoutes.find((route) => route.href === pathname)?.label ?? "OpenBooks"}
          </div>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t bg-background lg:hidden">
        {mobileRoutes.map((route) => {
          const Icon = route.icon;
          return (
            <Link
              key={route.href}
              href={route.href}
              className={cn(
                "flex flex-col items-center gap-1 px-2 py-2 text-[11px]",
                pathname === route.href ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
              {route.label}
            </Link>
          );
        })}
        <button
          className={cn("flex flex-col items-center gap-1 px-2 py-2 text-[11px]", aiOpen ? "text-primary" : "text-muted-foreground")}
          onClick={() => setAiOpen(true)}
        >
          <Sparkles className="size-4" />
          Ask AI
        </button>
      </nav>
    </div>
  );
}
