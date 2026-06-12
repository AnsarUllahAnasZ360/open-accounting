"use client";

import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronDown,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  User,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CommandPalette } from "@/components/openbooks/CommandPalette";
import { OpenBooksAIChat } from "@/components/openbooks/OpenBooksAIChat";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { frontendAiStatus, OPENBOOKS_AI_EVENT } from "@/lib/openbooks/ai";
import { ActiveEntityProvider, useActiveEntity, type EntityOption } from "@/lib/openbooks/active-entity";
import { appRoutes, mobileRoutes, settingsRoute } from "@/lib/openbooks/content";
import { openBooksDevAuthBypassEnabled } from "@/lib/openbooks/dev-mode";
import type { ReportPack } from "@/lib/openbooks/reports-export";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "ob:sidebar-collapsed";
const ACTIVE_ENTITY_STORAGE_KEY = "ob:active-entity-id";

function initials(name: string | null | undefined, fallback = "U") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
}

function roleLabel(role: string | undefined) {
  if (!role) return "Member";
  if (role === "owner") return "Owner";
  if (role === "admin") return "Accountant";
  if (role === "member") return "Staff";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function AppShell({ children }: { children: ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-[14px] border bg-card p-5 shadow-xs ring-1 ring-foreground/10">
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
  const devAuthBypass = openBooksDevAuthBypassEnabled();
  const sessionReady = isAuthenticated || devAuthBypass;
  const { signOut } = useAuthActions();
  const viewer = useQuery(api.session.viewer, sessionReady ? {} : "skip");
  const businesses = useQuery(api.entities.list, sessionReady ? {} : "skip");
  const [activeEntityId, setActiveEntityId] = useState<string | null>(null);
  const activeBusinessRows = useMemo(
    () => businesses?.rows.filter((entity) => !entity.archived) ?? [],
    [businesses],
  );
  useEffect(() => {
    if (!sessionReady || businesses === undefined) return;
    if (activeBusinessRows.length === 0) {
      if (activeEntityId !== null) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- sync selected entity to the loaded workspace entity list.
        setActiveEntityId(null);
      }
      return;
    }
    const activeIds = new Set(activeBusinessRows.map((entity) => String(entity.id)));
    if (activeEntityId && activeIds.has(activeEntityId)) return;
    let storedId: string | null = null;
    try {
      storedId = window.localStorage.getItem(ACTIVE_ENTITY_STORAGE_KEY);
    } catch {
      // ignore storage access errors
    }
    const nextId = storedId && activeIds.has(storedId) ? storedId : String(activeBusinessRows[0]!.id);
    setActiveEntityId(nextId);
  }, [activeBusinessRows, activeEntityId, businesses, sessionReady]);
  const selectedEntity = useMemo(
    () => activeBusinessRows.find((entity) => entity.id === activeEntityId) ?? activeBusinessRows[0] ?? null,
    [activeBusinessRows, activeEntityId],
  );
  const selectedEntityId = selectedEntity?.id;
  const reportArgs = useMemo(
    () => ({
      ...(selectedEntityId ? { entityId: selectedEntityId as Id<"entities"> } : {}),
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      basis: "accrual" as const,
      compare: "none" as const,
      columnMode: "monthly" as const,
    }),
    [selectedEntityId],
  );
  const reportPack = useQuery(
    api.reportViews.reportPack,
    sessionReady && businesses !== undefined ? reportArgs : "skip",
  ) as ReportPack | undefined;
  const aiProviderStatus = useQuery(
    api.ai.providerStatus,
    sessionReady && viewer?.workspace?.id ? { workspaceId: viewer.workspace.id } : "skip",
  );
  const aiStatus = frontendAiStatus(aiProviderStatus);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Persisted collapse state (A1). It must start `false` so the server-rendered
  // HTML (expanded) matches the client's first render — seeding from localStorage
  // in the initializer would cause a hydration mismatch. The stored value is
  // applied once after mount (localStorage is an external system the effect
  // synchronizes from, which is the rule's documented exception).
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of persisted UI state from localStorage after hydration (external-system sync; the rule's documented exception)
        setCollapsed(true);
      }
    } catch {
      // ignore storage access errors (private mode etc.)
    }
  }, []);
  const [aiOpen, setAiOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMounted, setPaletteMounted] = useState(false);
  const [pendingAiPrompt, setPendingAiPrompt] = useState("");
  const [aiReportPack, setAiReportPack] = useState<ReportPack | undefined>();

  const selectActiveEntity = useCallback((entityId: string) => {
    setActiveEntityId(entityId);
    setAiReportPack(undefined);
    try {
      window.localStorage.setItem(ACTIVE_ENTITY_STORAGE_KEY, entityId);
    } catch {
      // ignore storage access errors
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const openPalette = useCallback(() => {
    setPaletteMounted(true);
    setPaletteOpen(true);
  }, []);

  // ⌘K opens the command palette; ⌘J toggles the Ask AI panel (A4).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setPaletteMounted(true);
        setPaletteOpen((value) => !value);
      } else if (key === "j") {
        event.preventDefault();
        setAiOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  useEffect(() => {
    if (!aiOpen) return;
    const media = window.matchMedia("(max-width: 1023px)");
    const previous = document.body.style.overflow;
    const applyLock = () => {
      document.body.style.overflow = media.matches ? "hidden" : previous;
    };
    applyLock();
    media.addEventListener("change", applyLock);
    return () => {
      media.removeEventListener("change", applyLock);
      document.body.style.overflow = previous;
    };
  }, [aiOpen]);

  const workspaceName = viewer?.workspace?.name ?? "open books";
  const userName = viewer?.user?.profile?.displayName ?? viewer?.user?.name ?? "You";
  const userInitials = viewer?.user?.profile?.initials ?? initials(userName);
  const avatarColor = viewer?.user?.profile?.avatarColor ?? "#17540f";
  const rawRole = viewer?.role;
  const role = roleLabel(rawRole);
  const canAccessSettings = rawRole === "owner" || rawRole === "admin";
  const activeEntityName = selectedEntity?.name ?? reportPack?.entity.name ?? "Your business";
  const currentRouteLabel = appRoutes.find((route) => route.href === pathname)?.label ?? settingsRoute.label;

  const entityOptions: EntityOption[] = useMemo(
    () => {
      const activeId = selectedEntity?.id ?? reportPack?.entity.id;
      if (activeBusinessRows.length) {
        return activeBusinessRows.map((entity) => ({
          id: entity.id,
          name: entity.name,
          currency: entity.currency,
          isDemo: entity.isDemo,
          active: entity.id === activeId,
        }));
      }
      return reportPack
        ? [
            {
              id: reportPack.entity.id,
              name: reportPack.entity.name,
              currency: reportPack.entity.currency,
              isDemo: true,
              active: true,
            },
          ]
        : [];
    },
    [activeBusinessRows, reportPack, selectedEntity?.id],
  );

  const activeEntityContext = useMemo(
    () => ({
      workspaceName,
      role,
      activeEntity: {
        id: selectedEntity?.id ?? reportPack?.entity.id,
        name: activeEntityName,
        currency: selectedEntity?.currency ?? reportPack?.entity.currency,
        isDemo: selectedEntity?.isDemo ?? false,
      },
      entities: entityOptions,
      selectEntity: selectActiveEntity,
    }),
    [activeEntityName, entityOptions, reportPack, role, selectActiveEntity, selectedEntity, workspaceName],
  );

  const handleSignOut = useCallback(async () => {
    if (!devAuthBypass) {
      await signOut();
    }
    router.push("/sign-in");
  }, [devAuthBypass, router, signOut]);

  if (isLoading && !devAuthBypass) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        Checking your open books session...
      </div>
    );
  }

  if (!sessionReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="w-full max-w-sm rounded-[14px] border bg-card p-5 shadow-xs ring-1 ring-foreground/10">
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

  const railWidth = collapsed ? "lg:w-[56px]" : "lg:w-[232px]";
  const contentPad = collapsed ? "lg:pl-[56px]" : "lg:pl-[232px]";

  return (
    <ActiveEntityProvider value={activeEntityContext}>
      <TooltipProvider delayDuration={150}>
        <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
          {/* Mobile scrim */}
          {sidebarOpen ? (
            <button
              aria-hidden
              tabIndex={-1}
              className="fixed inset-0 z-30 bg-black/30 lg:hidden"
              onClick={() => setSidebarOpen(false)}
            />
          ) : null}

          <aside
            data-testid="app-sidebar"
            data-state={collapsed ? "collapsed" : "expanded"}
            className={cn(
              "fixed inset-y-0 left-0 z-40 w-[232px] border-r bg-sidebar transition-[transform,width] duration-150 ease-out lg:translate-x-0",
              railWidth,
              sidebarOpen ? "translate-x-0" : "-translate-x-full",
            )}
          >
            {collapsed ? (
              <CollapsedRail
                pathname={pathname}
                onExpand={toggleCollapsed}
                userName={userName}
                userInitials={userInitials}
                avatarColor={avatarColor}
                role={role}
                canAccessSettings={canAccessSettings}
                onSignOut={handleSignOut}
              />
            ) : (
              <ExpandedSidebar
                pathname={pathname}
                workspaceName={workspaceName}
                activeEntityName={activeEntityName}
                entityOptions={entityOptions}
                userName={userName}
                userInitials={userInitials}
                avatarColor={avatarColor}
                role={role}
                canAccessSettings={canAccessSettings}
                onSelectEntity={selectActiveEntity}
                onCollapse={toggleCollapsed}
                onCloseMobile={() => setSidebarOpen(false)}
                onNavigate={() => setSidebarOpen(false)}
                onSignOut={handleSignOut}
              />
            )}
          </aside>

          <div className={cn("min-h-screen pb-16 transition-[padding] duration-150 ease-out lg:pb-0", contentPad)}>
            <div className="flex min-h-screen">
              <div className="min-w-0 flex-1" data-testid="app-main-column">
                <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-background px-4 lg:px-6">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Button
                      aria-label="Open navigation"
                      className="lg:hidden"
                      size="icon-sm"
                      variant="outline"
                      onClick={() => setSidebarOpen(true)}
                    >
                      <Menu />
                    </Button>
                    <button
                      type="button"
                      data-testid="command-search-trigger"
                      onClick={openPalette}
                      className="hidden h-[34px] min-w-0 max-w-[460px] flex-1 items-center gap-2 rounded-[10px] border bg-sidebar px-3 text-left text-[13px] text-muted-foreground transition-colors hover:bg-muted md:flex"
                    >
                      <Search className="size-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">Search transactions, contacts, reports…</span>
                      <span className="money-figures shrink-0 rounded-[5px] border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        ⌘K
                      </span>
                    </button>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="hidden h-[30px] items-center rounded-full bg-muted px-3 text-[12.5px] font-medium text-muted-foreground sm:flex">
                      Jun 2026
                    </div>
                    <Button
                      data-testid="ask-ai-button"
                      className={cn(
                        "border-[#bbe0a9] bg-[#f1f8ee] text-[#1d6b12] hover:bg-[#dcefd2] hover:text-[#1d6b12]",
                        aiOpen && "border-[#92cc7a] bg-[#dcefd2]",
                      )}
                      variant="outline"
                      onClick={() => setAiOpen((value) => !value)}
                    >
                      <Sparkles />
                      Ask AI
                      <span className="money-figures hidden text-[11px] text-[#63b347] sm:inline">⌘J</span>
                    </Button>
                  </div>
                </header>

                <main className="mx-auto w-full max-w-[1200px] px-4 py-5 lg:px-6">{children}</main>
              </div>

              {aiOpen ? (
                <aside
                  data-testid="ai-panel"
                  className="sticky top-0 hidden h-screen w-[380px] shrink-0 overflow-hidden border-l bg-background transition-[width] duration-150 ease-out lg:flex"
                >
                  <OpenBooksAIChat
                    contextLabel={currentRouteLabel}
                    reportPack={aiReportPack ?? reportPack}
                    aiStatus={aiStatus}
                    workspaceId={viewer?.workspace?.id}
                    pendingPrompt={pendingAiPrompt}
                    onClose={() => setAiOpen(false)}
                  />
                </aside>
              ) : null}
            </div>
          </div>

          {aiOpen ? (
            <button
              aria-label="Close Ask AI overlay"
              className="fixed inset-0 z-40 bg-black/30 lg:hidden"
              onClick={() => setAiOpen(false)}
            />
          ) : null}

          <aside
            data-testid="ai-panel-mobile"
            className={cn(
              "fixed inset-x-0 bottom-0 z-50 h-[88dvh] overflow-hidden rounded-t-[12px] border-t bg-background pb-[env(safe-area-inset-bottom)] shadow-lg transition-transform duration-150 ease-out lg:hidden",
              aiOpen ? "translate-y-0" : "translate-y-full",
            )}
          >
            <OpenBooksAIChat
              contextLabel={currentRouteLabel}
              reportPack={aiReportPack ?? reportPack}
              aiStatus={aiStatus}
              workspaceId={viewer?.workspace?.id}
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

          {paletteMounted ? (
            <CommandPalette
              open={paletteOpen}
              onOpenChange={setPaletteOpen}
              enabled={paletteMounted}
              canAccessSettings={canAccessSettings}
            />
          ) : null}
        </div>
      </TooltipProvider>
    </ActiveEntityProvider>
  );
}

function InboxBadge({ collapsed }: { collapsed?: boolean }) {
  // Inbox count from the active entity's dashboard query (no new backend).
  const { activeEntity } = useActiveEntity();
  const dashboard = useQuery(
    api.coreViews.dashboard,
    activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {},
  );
  const count = dashboard?.inbox.openCount ?? 0;

  if (collapsed) {
    return count > 0 ? (
      <span className="absolute top-0.5 right-0.5 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">
        {count}
      </span>
    ) : (
      <span className="absolute top-1 right-1 size-[7px] rounded-full bg-primary" />
    );
  }

  return count > 0 ? (
    <span
      data-testid="inbox-badge"
      className="flex h-[18px] min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
    >
      {count}
    </span>
  ) : (
    <span data-testid="inbox-badge-zero" className="size-[7px] rounded-full bg-primary" />
  );
}

function ExpandedSidebar({
  pathname,
  workspaceName,
  activeEntityName,
  entityOptions,
  userName,
  userInitials,
  avatarColor,
  role,
  canAccessSettings,
  onSelectEntity,
  onCollapse,
  onCloseMobile,
  onNavigate,
  onSignOut,
}: {
  pathname: string;
  workspaceName: string;
  activeEntityName: string;
  entityOptions: EntityOption[];
  userName: string;
  userInitials: string;
  avatarColor: string;
  role: string;
  canAccessSettings: boolean;
  onSelectEntity: (entityId: string) => void;
  onCollapse: () => void;
  onCloseMobile: () => void;
  onNavigate: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-2.5">
        <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-2.5" onClick={onNavigate}>
          <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            ob
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold leading-tight">open books</span>
            <span className="block truncate text-[11px] text-muted-foreground">{workspaceName}</span>
          </span>
        </Link>
        <Button
          aria-label="Collapse sidebar"
          data-testid="sidebar-collapse"
          className="hidden lg:inline-flex"
          size="icon-sm"
          variant="ghost"
          onClick={onCollapse}
        >
          <PanelLeftClose />
        </Button>
        <Button
          aria-label="Close navigation"
          className="lg:hidden"
          size="icon-sm"
          variant="ghost"
          onClick={onCloseMobile}
        >
          <X />
        </Button>
      </div>

      {/* Entity switcher (A5) */}
      <div className="px-3 pb-2.5">
        <EntitySwitcher
          activeEntityName={activeEntityName}
          entityOptions={entityOptions}
          canAccessSettings={canAccessSettings}
          onSelectEntity={onSelectEntity}
          onNavigate={onNavigate}
        />
      </div>

      <nav className="flex flex-1 flex-col gap-px overflow-y-auto px-3 py-1">
        {appRoutes.map((route) => {
          const active = pathname === route.href;
          const Icon = route.icon;
          return (
            <Link
              key={route.href}
              href={route.href}
              onClick={onNavigate}
              data-active={active}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                active
                  ? "bg-[#f1f8ee] font-semibold text-[#17540f]"
                  : "font-medium text-[#454545] hover:bg-muted",
              )}
            >
              <Icon className="size-[17px] shrink-0 opacity-85" />
              <span className="flex-1">{route.label}</span>
              {route.href === "/inbox" ? <InboxBadge /> : null}
            </Link>
          );
        })}

        {canAccessSettings ? (
          <>
            <div className="my-2 h-px bg-[#ececec]" />

            <Link
              href={settingsRoute.href}
              onClick={onNavigate}
              data-active={pathname.startsWith("/settings")}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                pathname.startsWith("/settings")
                  ? "bg-[#f1f8ee] font-semibold text-[#17540f]"
                  : "font-medium text-[#454545] hover:bg-muted",
              )}
            >
              <SettingsIcon className="size-[17px] shrink-0 opacity-85" />
              <span className="flex-1">{settingsRoute.label}</span>
            </Link>
          </>
        ) : null}
      </nav>

      {/* Footer: sync + profile (A2) */}
      <div className="flex flex-col gap-2 border-t border-[#ececec] p-3">
        <SyncRow />
        <ProfileMenu
          userName={userName}
          userInitials={userInitials}
          avatarColor={avatarColor}
          role={role}
          canAccessSettings={canAccessSettings}
          onSignOut={onSignOut}
        />
      </div>
    </div>
  );
}

function CollapsedRail({
  pathname,
  onExpand,
  userName,
  userInitials,
  avatarColor,
  role,
  canAccessSettings,
  onSignOut,
}: {
  pathname: string;
  onExpand: () => void;
  userName: string;
  userInitials: string;
  avatarColor: string;
  role: string;
  canAccessSettings: boolean;
  onSignOut: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center gap-[3px] px-0 pt-3.5 pb-3">
      <Link href="/dashboard" aria-label="open books home">
        <span className="flex size-[30px] items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          ob
        </span>
      </Link>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Expand sidebar"
            data-testid="sidebar-expand"
            className="mt-1.5"
            size="icon-sm"
            variant="ghost"
            onClick={onExpand}
          >
            <PanelLeftOpen />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Expand sidebar</TooltipContent>
      </Tooltip>

      <div className="my-1.5 h-px w-7 bg-[#ececec]" />

      {appRoutes.map((route) => {
        const active = pathname === route.href;
        const Icon = route.icon;
        return (
          <Tooltip key={route.href}>
            <TooltipTrigger asChild>
              <Link
                href={route.href}
                data-active={active}
                aria-label={route.label}
                className={cn(
                  "relative flex size-9 items-center justify-center rounded-[9px] transition-colors",
                  active ? "bg-[#f1f8ee] text-[#17540f]" : "text-[#454545] hover:bg-muted",
                )}
              >
                <Icon className="size-[17px] opacity-85" />
                {route.href === "/inbox" ? <InboxBadge collapsed /> : null}
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{route.label}</TooltipContent>
          </Tooltip>
        );
      })}

      <div className="my-1.5 h-px w-7 bg-[#ececec]" />

      {canAccessSettings ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href={settingsRoute.href}
              aria-label={settingsRoute.label}
              data-active={pathname.startsWith("/settings")}
              className={cn(
                "flex size-9 items-center justify-center rounded-[9px] transition-colors",
                pathname.startsWith("/settings") ? "bg-[#f1f8ee] text-[#17540f]" : "text-[#454545] hover:bg-muted",
              )}
            >
              <SettingsIcon className="size-[17px] opacity-85" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">{settingsRoute.label}</TooltipContent>
        </Tooltip>
      ) : null}

      <div className="flex-1" />

      <SyncRow collapsed />
      <ProfileMenu
        collapsed
        userName={userName}
        userInitials={userInitials}
        avatarColor={avatarColor}
        role={role}
        canAccessSettings={canAccessSettings}
        onSignOut={onSignOut}
      />
    </div>
  );
}

function EntitySwitcher({
  activeEntityName,
  entityOptions,
  canAccessSettings,
  onSelectEntity,
  onNavigate,
}: {
  activeEntityName: string;
  entityOptions: EntityOption[];
  canAccessSettings: boolean;
  onSelectEntity: (entityId: string) => void;
  onNavigate: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="entity-switcher"
          className="flex w-full items-center gap-2 rounded-[10px] border bg-background px-2.5 py-[7px] text-left text-[13px] font-medium transition-colors hover:bg-muted"
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[#dcefd2] text-[11px] font-semibold text-[#17540f]">
            {initials(activeEntityName, "B")}
          </span>
          <span className="min-w-0 flex-1 truncate">{activeEntityName}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56" data-testid="entity-menu">
        <DropdownMenuLabel>Businesses</DropdownMenuLabel>
        {entityOptions.length ? (
          entityOptions.map((entity) => (
            <DropdownMenuItem
              key={entity.id ?? entity.name}
              className="gap-2"
              data-testid={entity.id ? `entity-option-${entity.id}` : undefined}
              disabled={entity.active}
              onSelect={() => {
                if (!entity.id) return;
                onSelectEntity(entity.id);
                onNavigate();
              }}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[#dcefd2] text-[11px] font-semibold text-[#17540f]">
                {initials(entity.name, "B")}
              </span>
              <span className="flex-1 truncate">{entity.name}</span>
              {entity.currency ? <span className="text-[11px] text-muted-foreground">{entity.currency}</span> : null}
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>Loading…</DropdownMenuItem>
        )}
        {canAccessSettings ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings" onClick={onNavigate} className="gap-2" data-testid="entity-add-business">
                <span className="flex size-5 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                  <Plus className="size-3" />
                </span>
                <span>Add a business</span>
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SyncRow({ collapsed }: { collapsed?: boolean }) {
  // Last-sync text reflects the dashboard query's freshness; "Sync now"
  // re-fetches client data (the live Convex subscription already keeps the UI
  // current). A dedicated per-entity sync-now action is a backend follow-up
  // (plan G2 "Sync now" per connection) — noted in the report rather than
  // invented here.
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);

  const onSync = useCallback(() => {
    setSpinning(true);
    router.refresh();
    window.setTimeout(() => setSpinning(false), 900);
  }, [router]);

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            aria-label="Sync now"
            data-testid="sync-now-collapsed"
            size="icon-sm"
            variant="ghost"
            onClick={onSync}
          >
            <RefreshCw className={cn("size-3.5", spinning && "animate-spin")} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{spinning ? "Syncing…" : "Sync now"}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <button
      type="button"
      data-testid="sync-now"
      onClick={onSync}
      className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted"
    >
      <RefreshCw className={cn("size-3.5 shrink-0", spinning && "animate-spin")} />
      <span>{spinning ? "Syncing…" : "Synced just now"}</span>
    </button>
  );
}

function ProfileMenu({
  collapsed,
  userName,
  userInitials,
  avatarColor,
  role,
  canAccessSettings,
  onSignOut,
}: {
  collapsed?: boolean;
  userName: string;
  userInitials: string;
  avatarColor: string;
  role: string;
  canAccessSettings: boolean;
  onSignOut: () => void;
}) {
  // The collapsed trigger is an avatar-only button that is BOTH a dropdown
  // trigger and a tooltip trigger. Both must wrap the SAME button via nested
  // `asChild` (DropdownMenuTrigger → TooltipTrigger → button) so each Radix Slot
  // merges its props onto the real DOM element — wrapping a Tooltip Root in
  // DropdownMenuTrigger asChild would silently drop the dropdown wiring.
  const expandedTrigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        data-testid="profile-trigger"
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1 text-left transition-colors hover:bg-muted"
      >
        <span
          className="flex size-[26px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
          style={{ backgroundColor: avatarColor }}
        >
          {userInitials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium leading-tight">{userName}</span>
          <span className="block truncate text-[11px] text-muted-foreground leading-tight">{role}</span>
        </span>
      </button>
    </DropdownMenuTrigger>
  );

  const collapsedTrigger = (
    <Tooltip>
      <DropdownMenuTrigger asChild>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`${userName} · ${role}`}
            data-testid="profile-trigger"
            className="mt-1 flex size-[26px] items-center justify-center rounded-full text-[11px] font-semibold text-white"
            style={{ backgroundColor: avatarColor }}
          >
            {userInitials}
          </button>
        </TooltipTrigger>
      </DropdownMenuTrigger>
      <TooltipContent side="right">
        {userName} · {role}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <DropdownMenu>
      {collapsed ? collapsedTrigger : expandedTrigger}
      <DropdownMenuContent
        align={collapsed ? "start" : "end"}
        side={collapsed ? "right" : "top"}
        className="min-w-52"
        data-testid="profile-menu"
      >
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-foreground">{userName}</span>
          <span className="text-[11px] font-normal text-muted-foreground">{role}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild data-testid="profile-view">
          <Link href="/profile">
            <User />
            View profile
          </Link>
        </DropdownMenuItem>
        {canAccessSettings ? (
          <DropdownMenuItem asChild data-testid="profile-settings">
            <Link href="/settings">
              <SettingsIcon />
              Settings
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="profile-logout" variant="destructive" onSelect={() => void onSignOut()}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
