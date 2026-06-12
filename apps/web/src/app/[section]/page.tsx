import { notFound } from "next/navigation";

import { AppScreen } from "@/components/openbooks/AppScreen";
import { AppShell } from "@/components/openbooks/AppShell";
import { allAppRoutes } from "@/lib/openbooks/content";

export function generateStaticParams() {
  // `/settings` (and its nested sections) are owned by the dedicated
  // `app/settings/` routes, so exclude it from this catch-all to avoid a
  // duplicate-route conflict.
  return allAppRoutes
    .filter((route) => route.href !== "/settings")
    .map((route) => ({ section: route.href.slice(1) }));
}

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  // Defer the settings tree to app/settings/*.
  if (section === "settings") {
    notFound();
  }
  const route = allAppRoutes.find((item) => item.href === `/${section}`);

  if (!route) {
    notFound();
  }

  // Pass only serializable fields across the server→client boundary (the route's
  // lucide icon is a function component and cannot cross it).
  return (
    <AppShell>
      <AppScreen route={{ href: route.href, label: route.label, summary: route.summary }} />
    </AppShell>
  );
}
