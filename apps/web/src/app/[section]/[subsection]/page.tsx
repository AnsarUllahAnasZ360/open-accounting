import { notFound } from "next/navigation";

import { AppScreen } from "@/components/openbooks/AppScreen";
import { AppShell } from "@/components/openbooks/AppShell";
import { allAppRoutes } from "@/lib/openbooks/content";
import { SECTION_SUBTABS, isValidSubsection } from "@/lib/openbooks/section-subtabs";

export function generateStaticParams() {
  // Enumerate every NON-default sub-tab (e.g. /income/invoices, /income/insights,
  // /transactions/insights). The default cash-movement sub-tab lives at the bare
  // /[section] URL (owned by app/[section]/page.tsx), so it is excluded here.
  return SECTION_SUBTABS.flatMap((entry) =>
    entry.subtabs
      .filter((tab) => !tab.isDefault)
      .map((tab) => ({ section: entry.section, subsection: tab.id })),
  );
}

// Deep-linkable /[section]/[subsection]. The section must be a real app route and
// the subsection must be a registered (non-default) sub-tab for it; anything else
// 404s — mirroring the app/settings/[section] precedent.
export default async function SectionSubsectionPage({
  params,
}: {
  params: Promise<{ section: string; subsection: string }>;
}) {
  const { section, subsection } = await params;

  if (section === "settings") {
    notFound();
  }

  const route = allAppRoutes.find((item) => item.href === `/${section}`);
  if (!route) {
    notFound();
  }

  if (!isValidSubsection(section, subsection)) {
    notFound();
  }

  // Pass only serializable fields across the server→client boundary (the route's
  // lucide icon is a function component and cannot cross it).
  return (
    <AppShell>
      <AppScreen
        route={{ href: route.href, label: route.label, summary: route.summary }}
        subsection={subsection}
      />
    </AppShell>
  );
}
