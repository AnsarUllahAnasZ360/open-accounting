"use client";

import { useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";

import { api } from "../../../../../convex/_generated/api";
import { OpenBooksAIChat } from "@/components/openbooks/OpenBooksAIChat";
import { CategoryChip, PageHeader } from "@/components/openbooks/primitives";
import { useActiveEntity } from "@/lib/openbooks/active-entity";
import { frontendAiStatus } from "@/lib/openbooks/ai";
import { openBooksDevAuthBypassEnabled } from "@/lib/openbooks/dev-mode";
import type { ReportPack } from "@/lib/openbooks/reports-export";
import type { Id } from "../../../../../convex/_generated/dataModel";

export function AskAIScreen() {
  const { activeEntity } = useActiveEntity();
  const { isAuthenticated } = useConvexAuth();
  const sessionReady = isAuthenticated || openBooksDevAuthBypassEnabled();
  const viewer = useQuery(api.session.viewer, sessionReady ? {} : "skip");
  const reportPack = useQuery(
    api.reportViews.reportPack,
    sessionReady
      ? {
          ...(activeEntity.id ? { entityId: activeEntity.id as Id<"entities"> } : {}),
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          basis: "accrual",
          compare: "none",
          columnMode: "monthly",
        }
      : "skip",
  ) as ReportPack | undefined;
  const aiProviderStatus = useQuery(
    api.ai.providerStatus,
    sessionReady && viewer?.workspace?.id ? { workspaceId: viewer.workspace.id } : "skip",
  );
  const aiStatus = frontendAiStatus(aiProviderStatus);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={activeEntity.name}
        title="Ask AI"
        description="Ask questions against reports, transactions, balances, contacts, payroll, and confirmed bookkeeping context."
        actions={<CategoryChip active label={aiStatus.mode === "active" ? "Bedrock active" : "Degraded mode"} />}
      />

      <section className="min-h-[calc(100vh-13rem)]">
        <OpenBooksAIChat
          contextLabel="Full-page assistant"
          reportPack={reportPack}
          aiStatus={aiStatus}
          workspaceId={viewer?.workspace?.id}
          mode="page"
        />
      </section>
    </div>
  );
}
