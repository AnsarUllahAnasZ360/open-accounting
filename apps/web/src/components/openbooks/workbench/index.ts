export { AttentionState, attentionMeta, type AttentionKind } from "./AttentionState";
export { WorkbenchPage } from "./WorkbenchPage";
export { PageActionBar, type ActionItem } from "./PageActionBar";
export {
  DateRangeControl,
  dateRangeValueToISO,
  type DateRangePreset,
  type DateRangeValue,
} from "./DateRangeControl";
export {
  FilterBar,
  type FacetDef,
  type FacetOption,
  type FacetValue,
  type ActiveChip,
} from "./FilterBar";
export { AccountMultiSelect, type AccountOption } from "./AccountMultiSelect";
export { KpiStrip, type KpiItem } from "./KpiStrip";
export { OpenBooksDataTable, type ColumnDef, type SortState } from "./OpenBooksDataTable";
export {
  evaluateSplitBalance,
  parseMoneyToMinor,
  type SplitBalance,
} from "./register-split";
export { DetailSheet, type DetailTab } from "./DetailSheet";
export { AiInsightBadge } from "./AiInsightBadge";
export { EvidenceUpload, type EvidenceDocument } from "./EvidenceUpload";
export { ExportMenu, type ExportFormat } from "./ExportMenu";
export { useIsMobile } from "./use-is-mobile";
// E7-2: the single provenance chip (Rule / Memory / Matched / Imported / AI N% /
// Needs review / Manual) that replaces the AI-only badge in the register.
export { ProvenanceChip, type Provenance, type ProvenanceKind } from "./ProvenanceChip";

// Mercury-style workbench toolbar + insights (Transactions reference surface).
export { WorkbenchToolbar } from "./WorkbenchToolbar";
export { FacetPill } from "./FacetPill";
export {
  AmountFilter,
  AmountFilterPill,
  isAmountActive,
  type AmountValue,
  type AmountDirection,
} from "./AmountFilter";
export { KeywordFilter, KeywordFilterPill } from "./KeywordFilter";
export {
  FilterPanelButton,
  type FilterFacetSpec,
  type FilterPanelValue,
} from "./FilterPanelButton";
export { SavedViews, type SavedViewSummary } from "./SavedViews";
export {
  useSavedViews,
  loadSavedViews,
  saveSavedViews,
  createViewId,
  type SavedView,
} from "./saved-views";
export { GroupByMenu, type GroupByKey } from "./GroupByMenu";
export { SortMenu } from "./SortMenu";
export { DisplaySettingsMenu, type DisplaySettings } from "./DisplaySettingsMenu";
// E8-T7: the legacy InsightsBand / MiniCashflowStrip / InsightsDashboard
// components were RETIRED (decided Q41) — superseded by the E1 Insights kit and
// the E8 InsightBanner. `AiNarrativePanel` stays as the banner's Explain backend
// type seam (`InsightsSection`) and `aiInsights` action.
export { AiNarrativePanel, type InsightsSection } from "./AiNarrativePanel";
export { AddMenu, type ExportChoice, type AddMenuExtraItem } from "./AddMenu";
export { InlineCategoryCombobox, type CategoryOption } from "./InlineCategoryCombobox";

// E8 — the single per-page insight banner + its pure builder registry, plus the
// opt-in AI "Explain" affordance (E8-T8) pages pass into the banner's slot.
export { InsightBanner } from "./InsightBanner";
export { InsightBannerExplain } from "./InsightBannerExplain";
export {
  buildPageInsight,
  pageInsightBuilders,
  compactMoney,
  type PageId,
  type PageInsight,
  type PageReadModel,
  type InsightTone,
  type InsightIcon,
  type InsightChip,
  type TransactionsInsightsModel,
  type IncomeOverviewModel,
  type ExpensesOverviewModel,
  type ContactsOverviewModel,
  type PayrollOverviewModel,
  type BillsOverviewModel,
  type DashboardModel,
} from "./page-insights";

// E0 shared-chrome scaffolding: the config contract, the section sub-tab bar,
// and the URL-synced toolbar state hook.
export {
  type WorkbenchConfig,
  type WorkbenchSubtab,
  type SubtabKind,
  type WorkbenchPrimaryAction,
  type WorkbenchBulkAction,
  type WorkbenchSortableColumn,
} from "./workbench-config";
export { SectionTabs, type SectionTabItem } from "./SectionTabs";
export { useWorkbenchUrlState } from "./use-workbench-url-state";
export { WorkbenchSurface, type WorkbenchTableGroup } from "./WorkbenchSurface";

// E1 — the reusable Insights component system (scope bar, KPI cards, chart
// wrapper with drill, AI observation cards, drill drawer, per-widget states).
export {
  type CompareMode,
  type ResolvedScope,
  type ResolvedRange,
  resolveScope,
  formatResolvedRange,
  safeDeltaPct,
  InsightsScope,
  InsightsPanel,
  InsightsKpiCard,
  InsightsKpiGrid,
  type InsightsKpiCardProps,
  type KpiTone,
  type KpiStatus,
  InsightsChart,
  type InsightsChartSeries,
  type InsightsChartPoint,
  type ChartSeriesType,
  AiObservationCard,
  AiObservationColumn,
  NothingNotable,
  type AiObservation,
  type ObservationEntity,
  TransactionsDrillDrawer,
  type DrillTarget,
  InsightsWidgetState,
  InsightsPanelSkeleton,
  InsightsChartCard,
  type WidgetStateKind,
  usePrefersReducedMotion,
} from "./insights";
