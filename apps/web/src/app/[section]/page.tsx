import { notFound } from "next/navigation";

import { AppScreen } from "@/components/openbooks/AppScreen";
import { AppShell } from "@/components/openbooks/AppShell";
import { appRoutes } from "@/lib/openbooks/content";

export function generateStaticParams() {
  return appRoutes.map((route) => ({ section: route.href.slice(1) }));
}

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const route = appRoutes.find((item) => item.href === `/${section}`);

  if (!route) {
    notFound();
  }

  return (
    <AppShell>
      <AppScreen route={route} />
    </AppShell>
  );
}
