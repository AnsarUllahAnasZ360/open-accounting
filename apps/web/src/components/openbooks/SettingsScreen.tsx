"use client";

import { useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, LockKeyhole } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "@/lib/openbooks/settings-sections";
import { AiSection } from "@/components/openbooks/settings/AiSection";
import { AuditSection } from "@/components/openbooks/settings/AuditSection";
import { BusinessesSection } from "@/components/openbooks/settings/BusinessesSection";
import { CategoriesSection } from "@/components/openbooks/settings/CategoriesSection";
import { ConnectionsSection } from "@/components/openbooks/settings/ConnectionsSection";
import { DataSection } from "@/components/openbooks/settings/DataSection";
import { NotificationsSection } from "@/components/openbooks/settings/NotificationsSection";
import { RulesSection } from "@/components/openbooks/settings/RulesSection";
import { TaxSection } from "@/components/openbooks/settings/TaxSection";
import { TeamSection } from "@/components/openbooks/settings/TeamSection";

export { SETTINGS_SECTIONS };
export type { SettingsSectionId };

const SECTION_DESCRIPTIONS: Record<SettingsSectionId, string> = {
  businesses: "The businesses in this workspace and their books.",
  tax: "Fiscal year, accounting basis, and tax identity per business.",
  connections: "Banks, Stripe, and imports — your keys, your data.",
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
  const canAccessSettings = viewer?.role === "owner" || viewer?.role === "admin";
  const moduleEntityId = useQuery(api.moduleViews.activeEntityId, canAccessSettings ? {} : "skip") as Id<"entities"> | null | undefined;

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
              Staff users can work transactions, payroll, and bills, but workspace settings, keys, team access, and
              accounting controls stay with Owners and Accountants.
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
              className="flex w-full items-center justify-between px-4 py-3.5 text-left text-sm"
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
        />
      </div>

      {/* Desktop: subnav + content. */}
      <div className="hidden gap-7 lg:flex lg:items-start">
        <nav
          data-testid="settings-subnav"
          className="flex w-[190px] min-w-[190px] flex-col gap-px"
          aria-label="Settings sections"
        >
          {SETTINGS_SECTIONS.map((sec) => {
            const isActive = sec.id === active;
            return (
              <button
                key={sec.id}
                type="button"
                data-testid={`settings-nav-${sec.id}`}
                data-active={isActive ? "true" : "false"}
                aria-current={isActive ? "page" : undefined}
                onClick={() => navigate(sec.id)}
                className={cn(
                  "flex w-full items-center rounded-[8px] px-[11px] py-2 text-left text-[13px] transition-colors",
                  isActive
                    ? "bg-[#f1f8ee] font-semibold text-[#17540f]"
                    : "font-medium text-[#454545] hover:bg-muted",
                )}
              >
                {sec.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          <SectionBody
            active={active}
            entityId={moduleEntityId ?? null}
            workspaceId={viewer?.workspace?.id ?? null}
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

function SectionBody({
  active,
  entityId,
  workspaceId,
}: {
  active: SettingsSectionId;
  entityId: Id<"entities"> | null;
  workspaceId: Id<"workspaces"> | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="mb-1">
        <h2 className="text-[18px] font-semibold tracking-tight">
          {SETTINGS_SECTIONS.find((s) => s.id === active)?.label}
        </h2>
        <p className="text-[13px] text-muted-foreground">{SECTION_DESCRIPTIONS[active]}</p>
      </div>

      {active === "businesses" ? <BusinessesSection /> : null}
      {active === "tax" ? <TaxSection /> : null}
      {active === "connections" ? <ConnectionsSection /> : null}
      {active === "ai" ? <AiSection entityId={entityId} workspaceId={workspaceId} /> : null}
      {active === "categories" ? <CategoriesSection entityId={entityId} /> : null}
      {active === "rules" ? <RulesSection entityId={entityId} /> : null}
      {active === "notifications" ? <NotificationsSection /> : null}
      {active === "team" ? <TeamSection /> : null}
      {active === "data" ? <DataSection /> : null}
      {active === "audit" ? <AuditSection /> : null}
    </div>
  );
}
