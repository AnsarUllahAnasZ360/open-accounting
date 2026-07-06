import { AppShell } from "@/components/openbooks/AppShell";
import { PayrollRunPage } from "@/components/openbooks/ModuleScreens";

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return (
    <AppShell>
      <PayrollRunPage runId={runId} />
    </AppShell>
  );
}
