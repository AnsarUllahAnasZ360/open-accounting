import { notFound } from "next/navigation";

import { AppScreen } from "@/components/openbooks/AppScreen";
import { AppShell } from "@/components/openbooks/AppShell";
import { allAppRoutes } from "@/lib/openbooks/content";

export function generateStaticParams() {
  return allAppRoutes.map((route) => ({ section: route.href.slice(1) }));
}

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
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
