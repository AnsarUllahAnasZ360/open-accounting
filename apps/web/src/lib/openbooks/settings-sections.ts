// The 10 Settings sections (Epic E). Kept in a plain (non-"use client") module
// so the server-side `generateStaticParams` for /settings/[section] can import
// the real array — importing it from the "use client" SettingsScreen turns it
// into a client-reference proxy at build time (`.map is not a function`).

export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "businesses", label: "Businesses" },
  { id: "tax", label: "Tax & fiscal year" },
  { id: "connections", label: "Connections" },
  { id: "ai", label: "AI" },
  { id: "categories", label: "Categories" },
  { id: "rules", label: "Rules" },
  { id: "notifications", label: "Notifications" },
  { id: "team", label: "Team" },
  { id: "data", label: "Data" },
  { id: "audit", label: "Audit log" },
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTIONS)[number]["id"];

// Quiet eyebrow groupings for the subnav. The flat SETTINGS_SECTIONS array
// stays the source of truth (so /settings/[section] static params keep working);
// these groups only drive the desktop subnav presentation, named by the owner's
// mental model — what they manage, not how the system is wired.
export const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  label: string;
  items: ReadonlyArray<SettingsSectionId>;
}> = [
  { label: "Workspace", items: ["profile", "businesses", "tax"] },
  { label: "Automation", items: ["ai", "rules", "categories"] },
  { label: "Connections", items: ["connections"] },
  { label: "People", items: ["team", "notifications"] },
  { label: "Data", items: ["data", "audit"] },
];
