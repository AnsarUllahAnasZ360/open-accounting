import { AppScreen } from "@/components/openbooks/AppScreen";
import { AppShell } from "@/components/openbooks/AppShell";
import { settingsRoute } from "@/lib/openbooks/content";

// Bare /settings → the Settings shell defaulting to the Businesses section.
export default function SettingsPage() {
  return (
    <AppShell>
      <AppScreen route={{ href: settingsRoute.href, label: settingsRoute.label, summary: settingsRoute.summary }} />
    </AppShell>
  );
}
