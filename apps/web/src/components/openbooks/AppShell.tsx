"use client";

import { useAuthActions, useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  HelpCircle,
  Info,
  Layers,
  LogOut,
  Menu,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
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
import { AskAIWidget } from "@/components/openbooks/AskAIWidget";
import { CommandPalette } from "@/components/openbooks/CommandPalette";
import { OnboardingScreen } from "@/components/openbooks/OnboardingScreen";
import { useIsMobile } from "@/components/openbooks/workbench";
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
import {
  ActiveEntityProvider,
  useActiveEntity,
  type EntityOption,
  type Scope,
} from "@/lib/openbooks/active-entity";
import { allAppRoutes, appRoutes, mobileRoutes, settingsRoute } from "@/lib/openbooks/content";
import { openBooksDevAuthBypassEnabled } from "@/lib/openbooks/dev-mode";
import type { ReportPack } from "@/lib/openbooks/reports-export";
import { getSectionSubtabs } from "@/lib/openbooks/section-subtabs";
import { cn } from "@/lib/utils";

const SIDEBAR_STORAGE_KEY = "ob:sidebar-collapsed";
const ACTIVE_ENTITY_STORAGE_KEY = "ob:active-entity-id";
// Portfolio scope persistence (Epic E5-T2). Stores "all" or an entity id so the
// 'All businesses' choice survives a reload, independently of the single-entity
// selection which still lives under ACTIVE_ENTITY_STORAGE_KEY.
const ACTIVE_SCOPE_STORAGE_KEY = "ob:active-scope";

function initials(name: string | null | undefined, fallback = "U") {
  if (!name) return fallback;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  if (parts.length === 1) return parts[0]!.slice(0, 1).toUpperCase();
  return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
}

function isLaunchSprintFixtureEntity(name: string) {
  return /^E1 Insights \d+ LLC$/i.test(name.trim());
}

function roleLabel(role: string | null | undefined) {
  if (!role) return "Member";
  if (role === "owner") return "Owner";
  if (role === "accountant" || role === "admin") return "Accountant";
  if (role === "hr" || role === "member") return "HR";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function routesForRole(role: string | null | undefined) {
  if (role === "hr" || role === "member") {
    return appRoutes.filter((route) => route.href === "/payroll");
  }
  if (role === "accountant" || role === "admin") {
    return appRoutes.filter((route) => route.href !== "/payroll");
  }
  return appRoutes;
}

function isRouteActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function sidebarChildLinks(sectionHref: string) {
  const section = sectionHref.slice(1);
  return getSectionSubtabs(section)
    .filter((tab) => !tab.isDefault)
    .map((tab) => ({
      href: `/${section}/${tab.id}`,
      label: tab.label,
      subtitle: tab.subtitle,
    }));
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
            Configure `NEXT_PUBLIC_CONVEX_URL` to activate OpenBooks locally.
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
  const rawRole = viewer?.role;
  const canViewBooks = rawRole !== "hr" && rawRole !== "member";
  const workspaceReady = viewer?.status === "ready" && Boolean(viewer.workspace?.id);
  const businesses = useQuery(api.entities.list, sessionReady && workspaceReady ? {} : "skip");
  // Guided first-run progress (Epic E4). While a workspace exists but onboarding
  // has not reached the 'done' phase, keep the wizard mounted so the integration,
  // opening-balance, sync, and review steps can finish their real work AFTER the
  // workspace+businesses are created mid-wizard. Owners only; invited teammates
  // never enter the wizard (handled below).
  const onboardingProgress = useQuery(
    api.onboarding.getProgress,
    sessionReady && workspaceReady && rawRole === "owner" ? {} : "skip",
  );
  const [activeEntityId, setActiveEntityId] = useState<string | null>(null);
  // Portfolio scope (Epic E5-T2). `true` = 'All businesses' is selected. Stored
  // separately from the single-entity selection so switching back to a business
  // restores the last entity. Starts `false` so SSR/first render is deterministic;
  // the persisted choice is applied once after mount.
  const [portfolioActive, setPortfolioActive] = useState(false);
  const activeBusinessRows = useMemo(
    () => businesses?.rows.filter((entity) => !entity.archived && !isLaunchSprintFixtureEntity(entity.name)) ?? [],
    [businesses],
  );
  useEffect(() => {
    try {
      if (window.localStorage.getItem(ACTIVE_SCOPE_STORAGE_KEY) === "all") {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of persisted scope from localStorage after hydration (external-system sync)
        setPortfolioActive(true);
      }
    } catch {
      // ignore storage access errors
    }
  }, []);
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
    // Deterministic default selection (Epic E5-T1): the persisted workspace
    // default business first, then the stored localStorage id, then the first
    // active row. NEVER a workspace-name `.includes()` match. The explicit
    // workspace default outranks the last-used localStorage id so that setting a
    // new default in Settings lands the shell there on the next reload.
    const defaultEntityId = viewer?.defaultEntityId ? String(viewer.defaultEntityId) : null;
    const nextId =
      defaultEntityId && activeIds.has(defaultEntityId)
        ? defaultEntityId
        : storedId && activeIds.has(storedId)
          ? storedId
          : String(activeBusinessRows[0]!.id);
    setActiveEntityId(nextId);
  }, [activeBusinessRows, activeEntityId, businesses, sessionReady, viewer?.defaultEntityId]);
  const selectedEntity = useMemo(
    () => activeBusinessRows.find((entity) => entity.id === activeEntityId) ?? activeBusinessRows[0] ?? null,
    [activeBusinessRows, activeEntityId],
  );
  const selectedEntityId = selectedEntity?.id;
  const routeForcesPortfolioScope = pathname === "/dashboard";
  const reportArgs = useMemo(
    () =>
      routeForcesPortfolioScope || portfolioActive
        ? {
            scope: "all" as const,
            startDate: "2026-01-01",
            endDate: "2026-12-31",
            basis: "accrual" as const,
            compare: "none" as const,
            columnMode: "monthly" as const,
          }
        : {
            ...(selectedEntityId ? { entityId: selectedEntityId as Id<"entities"> } : {}),
            startDate: "2026-01-01",
            endDate: "2026-12-31",
            basis: "accrual" as const,
            compare: "none" as const,
            columnMode: "monthly" as const,
          },
    [portfolioActive, routeForcesPortfolioScope, selectedEntityId],
  );
  const reportPack = useQuery(
    api.reportViews.reportPack,
    sessionReady && workspaceReady && canViewBooks && activeBusinessRows.length > 0 ? reportArgs : "skip",
  ) as ReportPack | undefined;
  const aiProviderStatus = useQuery(
    api.ai.providerStatus,
    sessionReady && workspaceReady && canViewBooks && viewer?.workspace?.id ? { workspaceId: viewer.workspace.id } : "skip",
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
  // The Ask AI surface switches from a reserved side column (md+) to a bottom
  // Sheet below md. The Sheet portals to <body>, so a CSS `md:hidden` wrapper
  // cannot hide it — gate its open state on the viewport instead.
  const isBelowMd = useIsMobile("(max-width: 767px)");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMounted, setPaletteMounted] = useState(false);
  const [pendingAiPrompt, setPendingAiPrompt] = useState<{ prompt: string; nonce: number }>();
  const [aiReportPack, setAiReportPack] = useState<ReportPack | undefined>();

  const selectActiveEntity = useCallback((entityId: string) => {
    setActiveEntityId(entityId);
    setPortfolioActive(false);
    setAiReportPack(undefined);
    try {
      window.localStorage.setItem(ACTIVE_ENTITY_STORAGE_KEY, entityId);
      window.localStorage.setItem(ACTIVE_SCOPE_STORAGE_KEY, entityId);
    } catch {
      // ignore storage access errors
    }
  }, []);

  // Scope switcher (Epic E5-T2/T3). `'all'` activates the portfolio roll-up;
  // the object form selects a single business (delegating to selectActiveEntity).
  const selectScope = useCallback(
    (scope: Scope) => {
      if (scope === "all") {
        setPortfolioActive(true);
        setAiReportPack(undefined);
        try {
          window.localStorage.setItem(ACTIVE_SCOPE_STORAGE_KEY, "all");
        } catch {
          // ignore storage access errors
        }
        return;
      }
      selectActiveEntity(scope.entityId);
    },
    [selectActiveEntity],
  );

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
      // Structured payload: the prompt and its nonce travel in separate fields,
      // so a prompt containing "::" (a time range, a ratio) is never truncated.
      if (detail?.prompt) setPendingAiPrompt({ prompt: detail.prompt, nonce: Date.now() });
    }

    window.addEventListener(OPENBOOKS_AI_EVENT, handleAskAi);
    return () => window.removeEventListener(OPENBOOKS_AI_EVENT, handleAskAi);
  }, []);

  // The mobile Ask AI surface is a shadcn Sheet. The desktop dock is a normal
  // layout column, so no manual body scroll lock is needed.

  const workspaceName = viewer?.workspace?.name ?? "open books";
  const userName = viewer?.user?.profile?.displayName ?? viewer?.user?.name ?? "You";
  const userInitials = viewer?.user?.profile?.initials ?? initials(userName);
  const avatarColor = viewer?.user?.profile?.avatarColor ?? "#17540f";
  const role = roleLabel(rawRole);
  const canAccessSettings = rawRole === "owner" || rawRole === "accountant" || rawRole === "admin";
  const visibleAppRoutes = useMemo(() => routesForRole(rawRole), [rawRole]);
  const visibleMobileRoutes = useMemo(
    () => {
      const filtered = mobileRoutes.filter((route) => visibleAppRoutes.some((allowed) => allowed.href === route.href));
      return filtered.length ? filtered : visibleAppRoutes.slice(0, 3);
    },
    [visibleAppRoutes],
  );
  // Portfolio scope is only meaningful once there is at least one business to
  // aggregate. Compute the effective scope + the switcher label here (Epic E5-T2).
  const scopeIsPortfolio = (routeForcesPortfolioScope || portfolioActive) && activeBusinessRows.length > 0;
  const selectedScopeEntityId = scopeIsPortfolio ? undefined : selectedEntity?.id;
  const scope: Scope = selectedScopeEntityId ? { entityId: selectedScopeEntityId } : "all";
  const activeEntityName = scopeIsPortfolio
    ? "All businesses"
    : selectedEntity?.name ?? reportPack?.entity.name ?? "Your business";
  const currentRoute =
    allAppRoutes.find((route) => pathname === route.href || pathname.startsWith(`${route.href}/`)) ??
    (pathname === "/profile"
      ? { label: "Profile", summary: "Your identity inside OpenBooks." }
      : pathname === "/ask-ai"
        ? { label: "Ask AI", summary: "Ask plain-English questions about the books." }
        : settingsRoute);
  const currentRouteLabel = currentRoute.label;
  // The Ask AI route is an edge-to-edge chat surface: drop the page padding and
  // let it fill the viewport below the app header, and never co-render the
  // docked/mobile panels on top of it.
  const onAskAiPage = pathname === "/ask-ai";
  const showTopbarBusinessSwitcher = !routeForcesPortfolioScope && !pathname.startsWith("/reports");

  // Leave fullscreen Ask AI: navigate back to the page the user expanded from
  // (remembered at expand time, falling back to the dashboard) and flag the dock
  // to reopen there. We persist the intent rather than calling setAiOpen because
  // the cross-route navigation remounts the shell and drops in-memory state.
  const handleExitFullscreen = useCallback(() => {
    let returnTo = "/dashboard";
    try {
      returnTo = window.sessionStorage.getItem("openbooks:ai-return") || "/dashboard";
      window.sessionStorage.removeItem("openbooks:ai-return");
      window.sessionStorage.setItem("openbooks:ai-open", "1");
    } catch {
      // ignore storage access errors
    }
    router.push(returnTo);
  }, [router]);

  // Honor a persisted "reopen dock" intent once we land on a normal route.
  useEffect(() => {
    if (onAskAiPage) return;
    try {
      if (window.sessionStorage.getItem("openbooks:ai-open") === "1") {
        window.sessionStorage.removeItem("openbooks:ai-open");
        // eslint-disable-next-line react-hooks/set-state-in-effect -- restore dock-open intent persisted across the fullscreen→shell navigation (external-system sync)
        setAiOpen(true);
      }
    } catch {
      // ignore storage access errors
    }
  }, [onAskAiPage]);

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
      activeEntity: scopeIsPortfolio
        ? { name: "All businesses", isPortfolio: true as const }
        : {
            id: selectedEntity?.id ?? reportPack?.entity.id,
            name: activeEntityName,
            currency: selectedEntity?.currency ?? reportPack?.entity.currency,
            isDemo: selectedEntity?.isDemo ?? false,
          },
      entities: entityOptions,
      selectEntity: selectActiveEntity,
      scope: selectedScopeEntityId ? { entityId: selectedScopeEntityId } : ("all" as const),
      selectScope,
    }),
    [
      activeEntityName,
      entityOptions,
      reportPack,
      role,
      scopeIsPortfolio,
      selectActiveEntity,
      selectScope,
      selectedEntity,
      selectedScopeEntityId,
      workspaceName,
    ],
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
              <div className="text-xs text-muted-foreground">Sign in required</div>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Sign in or request hosted access to view this workspace.
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

  if (viewer === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        Loading your open books workspace...
      </div>
    );
  }

  if (workspaceReady && businesses === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-muted-foreground">
        Loading your open books setup...
      </div>
    );
  }

  // An owner whose workspace exists but whose guided first-run has not reached
  // the 'done' phase stays in the wizard (Epic E4-T4..T9). The wizard is kept
  // mounted CONTINUOUSLY (never unmounted mid-flow) so the moment the business
  // step bootstraps the workspace (businesses go 0 -> N) the owner is not thrown
  // to the main app and the in-progress wizard state is never wiped. While
  // progress is still loading we ALSO keep the wizard, so a freshly-created
  // workspace never flashes the app before getProgress resolves; once progress
  // loads with phase 'done' (incl. legacy/already-onboarded owners), the wizard
  // exits. Invited teammates and needs_onboarding/empty cases are unchanged.
  const ownerOnboardingPossible =
    workspaceReady && rawRole === "owner" && !viewer.joinedViaInvite;
  const ownerMidOnboarding =
    ownerOnboardingPossible &&
    (onboardingProgress === undefined || onboardingProgress.phase !== "done");

  if (
    viewer.status === "needs_onboarding" ||
    (workspaceReady && activeBusinessRows.length === 0) ||
    ownerMidOnboarding
  ) {
    return (
      <OnboardingScreen
        workspaceName={viewer.workspace?.name}
        userName={viewer.user?.profile?.displayName ?? viewer.user?.name ?? viewer.user?.email}
        joinedViaInvite={viewer.joinedViaInvite}
        role={viewer.role}
      />
    );
  }

  const railWidth = collapsed ? "lg:w-[56px]" : "lg:w-[232px]";
  const contentPad = collapsed ? "lg:pl-[56px]" : "lg:pl-[232px]";

  return (
    <ActiveEntityProvider value={activeEntityContext}>
      <TooltipProvider delayDuration={150}>
        {/* overflow-x-clip (not hidden) prevents horizontal scroll WITHOUT
            promoting overflow-y to auto — `overflow-x: hidden` would create a
            scroll container that breaks `position: sticky` for descendants
            (e.g. the Settings subnav, G14). */}
        <div className="min-h-screen overflow-x-clip bg-background text-foreground">
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
                onAskAi={() => setAiOpen(true)}
                aiOpen={aiOpen}
                userName={userName}
                userInitials={userInitials}
                avatarColor={avatarColor}
                role={role}
                routes={visibleAppRoutes}
                canAccessSettings={canAccessSettings}
                onSignOut={handleSignOut}
              />
            ) : (
              <ExpandedSidebar
                pathname={pathname}
                workspaceName={workspaceName}
                isDemo={selectedEntity?.isDemo ?? false}
                userName={userName}
                userInitials={userInitials}
                avatarColor={avatarColor}
                role={role}
                routes={visibleAppRoutes}
                canAccessSettings={canAccessSettings}
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
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Button
                      aria-label="Open navigation"
                      className="lg:hidden"
                      size="icon-sm"
                      variant="outline"
                      onClick={() => setSidebarOpen(true)}
                    >
                      <Menu />
                    </Button>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <h1 className="truncate text-sm font-semibold leading-none">{currentRoute.label}</h1>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label={`${currentRoute.label} details`}
                            className="shrink-0 text-muted-foreground"
                            size="icon-xs"
                            variant="ghost"
                          >
                            <Info />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent align="start" className="max-w-72 text-xs leading-relaxed">
                          {currentRoute.summary}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {showTopbarBusinessSwitcher ? (
                      <BusinessSwitcher
                        activeEntityName={activeEntityName}
                        entities={entityOptions}
                        scope={scope}
                        onSelectScope={selectScope}
                        onManageBusinesses={() => router.push("/settings")}
                      />
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <div id="ob-topbar-page-actions" className="flex items-center gap-1.5" />
                    {/* Search is a compact affordance reachable at ALL widths
                        (the only ⌘K path on mobile), not a desktop-only pill. */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          aria-label="Search"
                          data-testid="command-search-trigger"
                          onClick={openPalette}
                          size="icon-sm"
                          variant="outline"
                        >
                          <Search />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        Search <span className="money-figures ml-1 text-muted-foreground">⌘K</span>
                      </TooltipContent>
                    </Tooltip>
                    {/* Ask AI is an icon-only Sparkles affordance (tokens, not
                        hexes) — the conversation owns its own chrome. */}
                    {onAskAiPage ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label="Exit full screen"
                            className="text-ai"
                            data-testid="ask-ai-exit-fullscreen"
                            onClick={handleExitFullscreen}
                            size="icon-sm"
                            variant="outline"
                          >
                            <Minimize2 />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Exit full screen · back to side panel</TooltipContent>
                      </Tooltip>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            aria-label="Ask AI"
                            aria-pressed={aiOpen}
                            className={cn("text-ai", aiOpen && "bg-ai-surface")}
                            data-testid="ask-ai-button"
                            onClick={() => setAiOpen((value) => !value)}
                            size="icon-sm"
                            variant="outline"
                          >
                            <Sparkles />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Ask AI <span className="money-figures ml-1 text-muted-foreground">⌘J</span>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                </header>

                <main
                  className={cn(
                    "w-full",
                    onAskAiPage ? "h-[calc(100dvh-3.5rem)] overflow-hidden" : "px-4 py-4 lg:px-6",
                  )}
                >
                  {children}
                </main>
              </div>

              {/* Docked Ask AI — a reserved side column from md up. It never
                  covers the active page, so dense ledger views remain readable. */}
              <AskAIWidget
                aiStatus={aiStatus}
                contextLabel={currentRouteLabel}
                mode="docked"
                onOpenChange={setAiOpen}
                open={aiOpen && !isBelowMd && !onAskAiPage}
                pendingNonce={pendingAiPrompt?.nonce}
                pendingPrompt={pendingAiPrompt?.prompt}
                reportPack={aiReportPack ?? reportPack}
                workspaceId={viewer?.workspace?.id}
              />
            </div>
          </div>

          {/* Mobile Ask AI — a shadcn Sheet (bottom) with a reachable thread
              switcher; gated on the viewport so it never co-renders with the
              desktop side column (the Sheet portals out of any CSS-hidden wrapper). */}
          <AskAIWidget
            aiStatus={aiStatus}
            contextLabel={currentRouteLabel}
            mode="mobile"
            onOpenChange={setAiOpen}
            open={aiOpen && isBelowMd && !onAskAiPage}
            pendingNonce={pendingAiPrompt?.nonce}
            pendingPrompt={pendingAiPrompt?.prompt}
            reportPack={aiReportPack ?? reportPack}
            workspaceId={viewer?.workspace?.id}
          />

          <nav
            aria-label="Primary"
            className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-background lg:hidden"
          >
            {visibleMobileRoutes.map((route) => {
              const Icon = route.icon;
              const active = isRouteActive(pathname, route.href);
              return (
                <Link
                  key={route.href}
                  href={route.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex flex-col items-center gap-1 px-2 py-2 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  {route.label}
                </Link>
              );
            })}
            <button
              className="flex flex-col items-center gap-1 px-2 py-2 text-[11px] text-muted-foreground"
              onClick={openPalette}
              type="button"
            >
              <Search className="size-4" />
              Search
            </button>
            <button
              className={cn("flex flex-col items-center gap-1 px-2 py-2 text-[11px]", aiOpen ? "text-ai" : "text-muted-foreground")}
              onClick={() => setAiOpen(true)}
              type="button"
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
  isDemo,
  userName,
  userInitials,
  avatarColor,
  role,
  routes,
  canAccessSettings,
  onCollapse,
  onCloseMobile,
  onNavigate,
  onSignOut,
}: {
  pathname: string;
  workspaceName: string;
  isDemo: boolean;
  userName: string;
  userInitials: string;
  avatarColor: string;
  role: string;
  routes: typeof appRoutes;
  canAccessSettings: boolean;
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
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="truncate">{workspaceName}</span>
              {isDemo ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      aria-label="Demo workspace"
                      data-testid="demo-indicator"
                      className="size-[6px] shrink-0 rounded-full bg-muted-foreground/50"
                    />
                  </TooltipTrigger>
                  <TooltipContent side="right">Demo workspace</TooltipContent>
                </Tooltip>
              ) : null}
            </span>
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

      {/* Workspace switcher. Businesses are managed inside workspace settings. */}
      <div className="px-3 pb-2.5">
        <WorkspaceSwitcher
          workspaceName={workspaceName}
          canAccessSettings={canAccessSettings}
          onNavigate={onNavigate}
        />
      </div>

      <nav className="flex flex-1 flex-col gap-px overflow-y-auto px-3 py-1">
        {routes.map((route) => {
          const active = isRouteActive(pathname, route.href);
          const Icon = route.icon;
          const childLinks = sidebarChildLinks(route.href);
          return (
            <div key={route.href} className="flex flex-col gap-px">
              <Link
                href={route.href}
                onClick={onNavigate}
                data-active={active}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13.5px] transition-colors",
                  active
                    ? "bg-ob-green-50 font-semibold text-ob-green-800"
                    : "font-medium text-foreground/70 hover:bg-muted",
                )}
              >
                <Icon className="size-[17px] shrink-0 opacity-85" />
                <span className="flex-1">{route.label}</span>
                {route.href === "/inbox" ? <InboxBadge /> : null}
              </Link>
              {active && childLinks.length > 0 ? (
                <div className="ml-7 flex flex-col gap-px border-l border-border pl-2">
                  {childLinks.map((child) => {
                    const childActive = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onNavigate}
                        data-active={childActive}
                        className={cn(
                          "rounded-md px-2 py-1.5 text-[12px] leading-tight transition-colors",
                          childActive
                            ? "bg-muted font-medium text-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <span className="block truncate">{child.label}</span>
                        {child.subtitle ? (
                          <span className="block truncate text-[10.5px] font-normal text-muted-foreground">
                            {child.subtitle}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      {/* Footer utility cluster: Sync + Profile. Settings stays in the profile menu. */}
      <div className="flex flex-col gap-1 border-t border-border p-3">
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
  onAskAi,
  aiOpen,
  userName,
  userInitials,
  avatarColor,
  role,
  routes,
  canAccessSettings,
  onSignOut,
}: {
  pathname: string;
  onExpand: () => void;
  onAskAi: () => void;
  aiOpen: boolean;
  userName: string;
  userInitials: string;
  avatarColor: string;
  role: string;
  routes: typeof appRoutes;
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

      <div className="my-1.5 h-px w-7 bg-border" />

      {routes.map((route) => {
        const active = isRouteActive(pathname, route.href);
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
                  active ? "bg-ob-green-50 text-ob-green-800" : "text-foreground/70 hover:bg-muted",
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

      <div className="my-1.5 h-px w-7 bg-border" />

      {/* Ask AI is reachable from the iconified rail (the header trigger is the
          primary one). Quiet, brand-green Sparkles — never purple. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label="Ask AI"
            aria-pressed={aiOpen}
            data-testid="ask-ai-rail-trigger"
            onClick={onAskAi}
            type="button"
            className={cn(
              "flex size-9 items-center justify-center rounded-[9px] text-ai transition-colors",
              aiOpen ? "bg-ai-surface" : "hover:bg-muted",
            )}
          >
            <Sparkles className="size-[17px]" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Ask AI · ⌘J</TooltipContent>
      </Tooltip>

      <div className="flex-1" />

      {/* Settings stays in the profile menu so account/admin controls live together. */}
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

/**
 * Scope switcher (Epic E5-T3). Replaces the single-select business switcher with
 * a first item — 'All businesses (Portfolio)' — above a separator, then one item
 * per active entity. Selecting 'All' sets the portfolio scope; selecting a
 * business sets that single entity. The data-testid is preserved for e2e
 * continuity and a data-scope attribute exposes the current mode.
 */
function BusinessSwitcher({
  activeEntityName,
  entities,
  scope,
  onSelectScope,
  onManageBusinesses,
}: {
  activeEntityName: string;
  entities: EntityOption[];
  scope: Scope;
  onSelectScope: (scope: Scope) => void;
  onManageBusinesses: () => void;
}) {
  if (entities.length === 0) return null;
  const isPortfolio = scope === "all";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="active-business-switcher"
          data-scope={isPortfolio ? "all" : "entity"}
          className="hidden min-w-0 max-w-[240px] items-center gap-2 rounded-[8px] border bg-background px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors hover:bg-muted sm:flex"
        >
          <span className="text-muted-foreground">Business</span>
          <span className="min-w-0 truncate text-foreground">{activeEntityName}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64" data-testid="active-business-menu">
        <DropdownMenuLabel>Viewing books for</DropdownMenuLabel>
        <DropdownMenuItem
          className="gap-2"
          data-scope-item="all"
          data-active={isPortfolio ? "true" : "false"}
          onClick={() => onSelectScope("all")}
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-ob-green-100 text-ob-green-800">
            <Layers className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate">All businesses</span>
            <span className="block text-[10px] text-muted-foreground">Portfolio · combined USD</span>
          </span>
          {isPortfolio ? <Check className="size-3.5 shrink-0 text-ob-green-700" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {entities.map((entity) => {
          const isActive = !isPortfolio && entity.active;
          return (
            <DropdownMenuItem
              key={String(entity.id)}
              className="gap-2"
              data-active={isActive ? "true" : "false"}
              onClick={() => entity.id && onSelectScope({ entityId: entity.id })}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-ob-green-100 text-[11px] font-semibold text-ob-green-800">
                {initials(entity.name, "B")}
              </span>
              <span className="min-w-0 flex-1 truncate">{entity.name}</span>
              <span className="text-[11px] text-muted-foreground">{entity.currency ?? "USD"}</span>
              {isActive ? <Check className="size-3.5 shrink-0 text-ob-green-700" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="gap-2 text-muted-foreground" onClick={onManageBusinesses}>
          <SettingsIcon className="size-3.5 shrink-0" />
          <span>Manage businesses · Set default</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceSwitcher({
  workspaceName,
  canAccessSettings,
  onNavigate,
}: {
  workspaceName: string;
  canAccessSettings: boolean;
  onNavigate: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="workspace-switcher"
          className="flex w-full items-center gap-2 rounded-[10px] border bg-background px-2.5 py-[7px] text-left text-[13px] font-medium transition-colors hover:bg-muted"
        >
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-ob-green-100 text-[11px] font-semibold text-ob-green-800">
            {initials(workspaceName, "W")}
          </span>
          <span className="min-w-0 flex-1 truncate">{workspaceName}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-56" data-testid="workspace-menu">
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <DropdownMenuItem disabled className="gap-2" data-testid="workspace-current">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-ob-green-100 text-[11px] font-semibold text-ob-green-800">
            {initials(workspaceName, "W")}
          </span>
          <span className="flex-1 truncate">{workspaceName}</span>
        </DropdownMenuItem>
        {canAccessSettings ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/settings/businesses" onClick={onNavigate} className="gap-2" data-testid="workspace-manage-businesses">
                <span className="flex size-5 items-center justify-center rounded-md border border-dashed text-muted-foreground">
                  <SettingsIcon className="size-3" />
                </span>
                <span>Manage businesses</span>
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
        {/* E15-T3: in-app entry point to the plain-English owner help center. */}
        <DropdownMenuItem asChild data-testid="profile-help">
          <Link href="/help">
            <HelpCircle />
            Guide &amp; help
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="profile-logout" variant="destructive" onSelect={() => void onSignOut()}>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
