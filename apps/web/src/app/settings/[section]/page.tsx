import { notFound } from "next/navigation";

import { AppScreen } from "@/components/openbooks/AppScreen";
import { AppShell } from "@/components/openbooks/AppShell";
import { SETTINGS_SECTIONS } from "@/lib/openbooks/settings-sections";
import { settingsRoute } from "@/lib/openbooks/content";

export function generateStaticParams() {
  return SETTINGS_SECTIONS.map((section) => ({ section: section.id }));
}

// Deep-linkable /settings/<section>. The section is validated here and passed to
// the Settings shell so a hard navigation lands on the right section.
export default async function SettingsSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!SETTINGS_SECTIONS.some((item) => item.id === section)) {
    notFound();
  }

  return (
    <AppShell>
      <AppScreen
        route={{ href: settingsRoute.href, label: settingsRoute.label, summary: settingsRoute.summary }}
        settingsSection={section}
      />
    </AppShell>
  );
}
