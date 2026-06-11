"use client";

import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, Search, Sparkles, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import { OpenBooksAIChat } from "@/components/openbooks/OpenBooksAIChat";
import { Button } from "@/components/ui/button";
import { frontendAiStatus, OPENBOOKS_AI_EVENT } from "@/lib/openbooks/ai";
import { appRoutes, mobileRoutes } from "@/lib/openbooks/content";
import type { ReportPack } from "@/lib/openbooks/reports-export";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-lg border bg-card p-5 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              ob
            </span>
            <div>
              <div className="text-sm font-semibold">open books</div>
              <div className="text-xs text-muted-foreground">Convex not configured</div>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Configure `NEXT_PUBLIC_CONVEX_URL` to activate invite-only access locally.
          </p>
          <Button asChild className="mt-4 w-full">
            <Link href="/sign-in">Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <AuthenticatedAppShell>{children}</AuthenticatedAppShell>;
}

function AuthenticatedAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const viewer = useQuery(api.session.viewer, isAuthenticated ? {} : "skip");
  const reportArgs = useMemo(
    () => ({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      basis: "accrual" as const,
      compare: "none" as const,
      columnMode: "monthly" as const,
    }),
    [],
  );
  const reportPack = useQuery(api.reportViews.reportPack, isAuthenticated ? reportArgs : "skip") as ReportPack | undefined;
  const aiProviderStatus = useQuery(
    api.ai.providerStatus,
    isAuthenticated && viewer?.workspace?.id ? { workspaceId: viewer.workspace.id } : "skip",
  );
  const aiStatus = frontendAiStatus(aiProviderStatus);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [pendingAiPrompt, setPendingAiPrompt] = useState("");
  const [aiReportPack, setAiReportPack] = useState<ReportPack | undefined>();

  useEffect(() => {
    function handleAskAi(event: Event) {
      const detail = (event as CustomEvent<{ prompt?: string; reportPack?: ReportPack }>).detail;
      setAiOpen(true);
      if (detail?.reportPack) setAiReportPack(detail.reportPack);
      if (detail?.prompt) setPendingAiPrompt(`${detail.prompt}::${Date.now()}`);
    }

    window.addEventListener(OPENBOOKS_AI_EVENT, handleAskAi);
    return () => window.removeEventListener(OPENBOOKS_AI_EVENT, handleAskAi);
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        Checking your OpenBooks session...
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-lg border bg-card p-5 shadow-xs">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              ob
            </span>
            <div>
              <div className="text-sm font-semibold">open books</div>
              <div className="text-xs text-muted-foreground">Invite-only access</div>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Sign in with an invited account to view this workspace.
          </p>
          <Button asChild className="mt-4 w-full">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild className="mt-2 w-full" variant="ghost">
            <Link href="/#request-access">Request access</Link>
          </Button>
        </div>
      </div>
    );
  }

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
                  <span className="block text-xs text-muted-foreground">
                    {viewer?.workspace?.name ?? "Loading workspace"}
                  </span>
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
              <span>{viewer?.workspace?.name ?? "Workspace"}</span>
              <span className="text-muted-foreground">{viewer?.role ?? "member"}</span>
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
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setAiOpen((value) => !value)}>
              <Sparkles />
              Ask AI
            </Button>
            <Button
              aria-label="Sign out"
              size="icon-sm"
              variant="ghost"
              onClick={async () => {
                await signOut();
                router.push("/sign-in");
              }}
            >
              <LogOut />
            </Button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1200px] px-4 py-5 lg:px-6">{children}</main>
      </div>

      <aside
        className={cn(
          "fixed inset-y-0 right-0 z-40 w-full max-w-[420px] border-l bg-background transition-transform",
          aiOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <OpenBooksAIChat
          contextLabel={appRoutes.find((route) => route.href === pathname)?.label ?? "OpenBooks"}
          reportPack={aiReportPack ?? reportPack}
          aiStatus={aiStatus}
          pendingPrompt={pendingAiPrompt}
          onClose={() => setAiOpen(false)}
        />
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
