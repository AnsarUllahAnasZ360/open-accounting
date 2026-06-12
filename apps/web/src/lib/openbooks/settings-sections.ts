// The 10 Settings sections (Epic E). Kept in a plain (non-"use client") module
// so the server-side `generateStaticParams` for /settings/[section] can import
// the real array — importing it from the "use client" SettingsScreen turns it
// into a client-reference proxy at build time (`.map is not a function`).

export const SETTINGS_SECTIONS = [
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
