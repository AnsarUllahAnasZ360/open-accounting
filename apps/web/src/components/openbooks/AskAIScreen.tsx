"use client";

import { useConvexAuth } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";

import { api } from "../../../../../convex/_generated/api";
import { AskAIWidget } from "@/components/openbooks/AskAIWidget";
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

  // No outer PageHeader and no provider badge — the widget owns its own chrome
  // in page mode (Epic 2: the conversational surface never names a vendor).
  return (
    <AskAIWidget
      aiStatus={aiStatus}
      contextLabel="Full-page assistant"
      mode="page"
      reportPack={reportPack}
      workspaceId={viewer?.workspace?.id}
    />
  );
}
