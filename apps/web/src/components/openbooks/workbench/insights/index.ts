// The reusable Insights component system (Epic E1). Every section's Insights
// sub-tab (Transactions today; Income / Expenses / Bills / Contacts next)
// composes these so the experience is identical: one scope (period + compare),
// one KPI anatomy, one chart interaction model (crosshair + unified tooltip +
// click-to-drill + legend cross-filter + reduced-motion), monochrome AI
// observation cards with drillable entity chips, and consistent empty /
// first-run / low-data states.

export {
  type CompareMode,
  type ResolvedRange,
  type ResolvedScope,
  resolveScope,
  formatResolvedRange,
  safeDeltaPct,
  COMPARE_FRAME_LABELS,
} from "./insights-scope";
export { InsightsScope } from "./InsightsScope";
export { InsightsPanel } from "./InsightsPanel";
export {
  InsightsKpiCard,
  InsightsKpiGrid,
  type InsightsKpiCardProps,
  type KpiTone,
  type KpiStatus,
} from "./InsightsKpiCard";
export {
  InsightsChart,
  type InsightsChartSeries,
  type InsightsChartPoint,
  type ChartSeriesType,
} from "./InsightsChart";
export {
  AiObservationCard,
  AiObservationColumn,
  NothingNotable,
  type AiObservation,
  type ObservationEntity,
} from "./AiObservationCard";
export {
  TransactionsDrillDrawer,
  type DrillTarget,
} from "./TransactionsDrillDrawer";
export {
  InsightsWidgetState,
  InsightsPanelSkeleton,
  InsightsChartCard,
  type WidgetStateKind,
} from "./InsightsWidgetState";
export { usePrefersReducedMotion } from "./use-reduced-motion";
