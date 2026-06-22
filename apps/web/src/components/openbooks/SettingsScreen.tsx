"use client";

import { useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, LockKeyhole } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { useActiveEntity, useActiveScope } from "@/lib/openbooks/active-entity";
import { cn } from "@/lib/utils";
import { SETTINGS_NAV_GROUPS, SETTINGS_SECTIONS, type SettingsSectionId } from "@/lib/openbooks/settings-sections";
import { SettingsSectionShell } from "@/components/openbooks/settings/_shell";
import { AiSection } from "@/components/openbooks/settings/AiSection";
import { AuditSection } from "@/components/openbooks/settings/AuditSection";
import { BusinessesSection } from "@/components/openbooks/settings/BusinessesSection";
import { CategoriesSection } from "@/components/openbooks/settings/CategoriesSection";
import { ConnectionsSection } from "@/components/openbooks/settings/ConnectionsSection";
import { DataSection } from "@/components/openbooks/settings/DataSection";
import { NotificationsSection } from "@/components/openbooks/settings/NotificationsSection";
import { ProfileScreen } from "@/components/openbooks/ProfileScreen";
import { RulesSection } from "@/components/openbooks/settings/RulesSection";
import { TaxSection } from "@/components/openbooks/settings/TaxSection";
import { TeamSection } from "@/components/openbooks/settings/TeamSection";

export { SETTINGS_SECTIONS };
export type { SettingsSectionId };

const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  profile: "Your identity, workspace access, role permissions, and password reset.",
  businesses: "The businesses in this workspace and their books.",
  tax: "Fiscal year, accounting basis, and tax identity per business.",
  connections: "Banks and Stripe — your keys, your data.",
  ai: "Your model, your key, and how much AI does on its own.",
  categories: "Your chart of accounts wearing plain clothes.",
  rules: "Top-down, first match wins — drag to reprioritize.",
  notifications: "What lands in your email and digest.",
  team: "People in this workspace and what they can do.",
  data: "Export everything, any time. Your data is a file you own.",
  audit: "Every posting recorded — who or what did it, and why.",
};

function isSettingsSection(value: string): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

/**
 * Settings two-level layout (Epic E1): a left subnav of 10 sections and the
 * active section's content on the right. Deep-linkable at /settings/[section];
 * the active section is derived from the URL so real /settings/rules links work,
 * and clicking the subnav uses router navigation (shallow) to update the URL.
 * Mobile collapses to a section list that drills into a single section.
 */
export function SettingsScreen({ section }: { section?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { activeEntity, entities, selectScope } = useActiveEntity();
  const { scope } = useActiveScope();

  // Active section: explicit prop (from the route) wins; otherwise parse the URL
  // (/settings/<id>); default to businesses.
  const active: SettingsSectionId = useMemo(() => {
    if (section && isSettingsSection(section)) return section;
    const parts = pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    if (parts[0] === "settings" && last && isSettingsSection(last)) return last;
    return "businesses";
  }, [pathname, section]);

  const onMobileDrill = parts(pathname);

  const navigate = useCallback(
    (id: SettingsSectionId) => {
      router.push(`/settings/${id}`);
    },
    [router],
  );

  // Active entity for the entity-scoped sections. The workspace's primary
  // (demo) entity is the report subject; sections that need an entity use it.
  const viewer = useQuery(api.session.viewer, {});
  const canAccessSettings = viewer?.role === "owner" || viewer?.role === "accountant" || viewer?.role === "admin";
  const moduleEntityId = useQuery(
    api.moduleViews.activeEntityId,
    canAccessSettings
      ? activeEntity.id
        ? { entityId: activeEntity.id as Id<"entities"> }
        : {}
      : "skip",
  ) as Id<"entities"> | null | undefined;

  // E12-T8: Categories/Rules are inherently per-entity. When the shell scope is
  // 'All businesses' there is no single entity to edit, so the server falls back
  // to the primary (default) business and we surface an honest hint telling the
  // owner which business they're editing and how to switch (decisions Q63) — not
  // a forced business picker.
  const portfolioFallback =
    scope === "all"
      ? {
          entityName:
            entities.find((entity) => entity.id && entity.id === moduleEntityId)?.name ??
            entities.find((entity) => entity.active)?.name ??
            "the primary business",
          otherEntity: entities.find(
            (entity) => entity.active && entity.id !== moduleEntityId,
          ),
          selectEntityScope: (entityId: string) => selectScope({ entityId }),
        }
      : null;

  if (viewer && !canAccessSettings) {
    return (
      <div
        data-testid="settings-access-denied"
        className="rounded-[14px] border bg-card p-5 shadow-xs"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <LockKeyhole className="size-4" />
          </span>
          <div>
            <h2 className="text-[18px] font-semibold tracking-tight">Settings require Owner or Accountant access</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              HR users can manage payroll from Payroll, but workspace settings, keys, team access, and accounting
              controls stay with Owners and Accountants.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="settings-screen">
      {/* Mobile: when at /settings (no drill), show the section list. */}
      <div className={cn("lg:hidden", onMobileDrill ? "hidden" : "block")} data-testid="settings-mobile-list">
        <div className="divide-y rounded-[14px] border bg-card shadow-xs">
          {SETTINGS_SECTIONS.map((sec) => (
            <button
              key={sec.id}
              type="button"
              data-testid={`settings-mobile-nav-${sec.id}`}
              onClick={() => navigate(sec.id)}
              className="flex w-full items-center justify-between px-4 py-3.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span>
                <span className="block font-medium">{sec.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{SECTION_DESCRIPTIONS[sec.id]}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>

      {/* Mobile drill-in: a back link + the active section. */}
      <div className={cn("lg:hidden", onMobileDrill ? "block" : "hidden")}>
        <button
          type="button"
          data-testid="settings-mobile-back"
          onClick={() => router.push("/settings")}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground"
        >
          <ChevronLeft className="size-4" /> All settings
        </button>
        <SectionBody
          active={active}
          entityId={moduleEntityId ?? null}
          workspaceId={viewer?.workspace?.id ?? null}
          portfolioFallback={portfolioFallback}
        />
      </div>

      {/* Desktop: sticky grouped subnav + content. The subnav pins under the
          56px shell header (top-[72px] = header + the shell's py-5 top padding)
          and scrolls internally so it never leaves the viewport on long
          sections. */}
      <div className="hidden gap-7 lg:flex lg:items-start">
        <nav
          data-testid="settings-subnav"
          className="flex w-[200px] min-w-[200px] flex-col gap-4 lg:sticky lg:top-[72px] lg:max-h-[calc(100vh-88px)] lg:self-start lg:overflow-y-auto"
          aria-label="Settings sections"
        >
          {SETTINGS_NAV_GROUPS.map((group) => (
            <div key={group.label} className="flex flex-col gap-px">
              <div className="px-[11px] pb-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">
                {group.label}
              </div>
              {group.items.map((id) => {
                const sec = SETTINGS_SECTIONS.find((s) => s.id === id)!;
                const isActive = id === active;
                return (
                  <button
                    key={id}
                    type="button"
                    data-testid={`settings-nav-${id}`}
                    data-active={isActive ? "true" : "false"}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => navigate(id)}
                    className={cn(
                      "flex w-full items-center rounded-[8px] px-[11px] py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                      isActive
                        ? "bg-ob-green-50 font-semibold text-ob-green-800"
                        : "font-medium text-foreground/70 hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {sec.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          <SectionBody
            active={active}
            entityId={moduleEntityId ?? null}
            workspaceId={viewer?.workspace?.id ?? null}
            portfolioFallback={portfolioFallback}
          />
        </div>
      </div>
    </div>
  );
}

// Whether the URL points at a specific section (mobile drill-in) vs the bare
// /settings index (mobile list).
function parts(pathname: string) {
  const segs = pathname.split("/").filter(Boolean);
  return segs[0] === "settings" && segs.length >= 2 && isSettingsSection(segs[1] ?? "");
}

type PortfolioFallback = {
  entityName: string;
  otherEntity?: { id?: string; name: string };
  selectEntityScope: (entityId: string) => void;
} | null;

function SectionBody({
  active,
  entityId,
  workspaceId,
  portfolioFallback,
}: {
  active: SettingsSectionId;
  entityId: Id<"entities"> | null;
  workspaceId: Id<"workspaces"> | null;
  portfolioFallback: PortfolioFallback;
}) {
  const label = SETTINGS_SECTIONS.find((section) => section.id === active)?.label ?? "";
  // Categories/Rules are per-entity; under the 'All businesses' scope we edit the
  // primary business and say so (E12-T8 / decisions Q63).
  const showFallbackHint = portfolioFallback && (active === "categories" || active === "rules");
  return (
    // Shared shell header (E12-T1): every section gets one consistent title +
    // one-line description frame instead of a bare <p>, so spacing and headings
    // match across all 11 sections and deep links land on a labelled surface.
    <SettingsSectionShell title={label} description={SECTION_DESCRIPTIONS[active]}>
      {showFallbackHint ? (
        <PortfolioFallbackHint
          section={active}
          fallback={portfolioFallback!}
        />
      ) : null}
      {active === "profile" ? <ProfileScreen embedded /> : null}
      {active === "businesses" ? <BusinessesSection /> : null}
      {active === "tax" ? <TaxSection /> : null}
      {active === "connections" ? <ConnectionsSection workspaceId={workspaceId} /> : null}
      {active === "ai" ? <AiSection entityId={entityId} workspaceId={workspaceId} /> : null}
      {active === "categories" ? <CategoriesSection entityId={entityId} /> : null}
      {active === "rules" ? <RulesSection entityId={entityId} /> : null}
      {active === "notifications" ? <NotificationsSection /> : null}
      {active === "team" ? <TeamSection /> : null}
      {active === "data" ? <DataSection /> : null}
      {active === "audit" ? <AuditSection /> : null}
    </SettingsSectionShell>
  );
}

function PortfolioFallbackHint({
  section,
  fallback,
}: {
  section: "categories" | "rules";
  fallback: NonNullable<PortfolioFallback>;
}) {
  const noun = section === "categories" ? "categories" : "rules";
  return (
    <div
      data-testid="settings-scope-fallback-hint"
      className="mb-3 rounded-[10px] border border-ob-green-100 bg-ob-green-50 px-3.5 py-2.5 text-[12.5px] text-ob-green-800"
    >
      Editing {noun} for <span className="font-semibold">{fallback.entityName}</span>.{" "}
      {fallback.otherEntity?.id ? (
        <button
          type="button"
          data-testid="settings-scope-fallback-switch"
          className="font-medium underline underline-offset-2"
          onClick={() => fallback.selectEntityScope(fallback.otherEntity!.id!)}
        >
          Switch to {fallback.otherEntity.name}
        </button>
      ) : (
        <span className="text-ob-green-800/80">Pick a business in the switcher to edit another.</span>
      )}
    </div>
  );
}
