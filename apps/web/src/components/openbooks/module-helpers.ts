export type ModuleOverview = {
  entity: { id: string; name: string; currency: string; businessType: string; isDemo: boolean } | null;
  contacts: {
    rows: ContactRow[];
    selectedProfile: (ContactRow & {
      history: Array<{ id: string; kind: string; date: string; label: string; amountMinor: number; status: string }>;
      mergeFlow: { status: string; reason: string; suggestion: string };
    }) | null;
  };
  invoices: {
    kpis: { openMinor: number; overdueMinor: number; paidLast30Minor: number; averageDaysToPay: number };
    rows: InvoiceRow[];
    aging: AgingBucket;
    composer: { saveDraftStatus: string; sendViaStripeStatus: string; manualRecordStatus: string };
  };
  bills: {
    kpis: { openMinor: number; dueThisWeekMinor: number; overdueMinor: number };
    groups: Array<{ key: string; label: string; rows: BillRow[] }>;
    matchCandidates: Array<{ id: string; date: string; merchant: string; amountMinor: number; currency: string }>;
    uploadPdf: { status: string; reason: string };
  };
  payroll: {
    employees: EmployeeRow[];
    runs: PayrollRunRow[];
    currencyTotals: Array<{ currency: string; localMinor: number; baseMinor: number }>;
    statementRows: Array<{
      employeeName: string;
      country: string;
      currency: string;
      localMinor: number;
      baseMinor: number;
      fxDisplay: string;
    }>;
    statementCsv: string;
  };
  settings: {
    businesses: {
      rows: Array<{
        id: string;
        name: string;
        slug: string;
        businessType: string;
        currency: string;
        isDemo: boolean;
        canArchive: boolean;
        archiveReason: string;
        isActive: boolean;
      }>;
      addEntity: {
        status: string;
        recommendedName: string;
        recommendedCurrency: string;
        liveSandboxEntityId: string | null;
      };
    };
    rules: {
      rows: Array<{
        id: string;
        order: number;
        name: string;
        summary: string;
        hitCount: number;
        active: boolean;
        autoPost: boolean;
        categoryName: string;
        createdBy: string;
      }>;
      pendingSuggestion: { status: string; title: string; summary: string };
    };
    audit: {
      rows: Array<{
        id: string;
        when: number;
        actor: string;
        action: string;
        entityType: string;
        summary: string;
        beforeAfter: string;
      }>;
    };
  };
};

export type ContactRow = {
  id: string;
  name: string;
  roles: string[];
  email: string | null;
  aliases: string[];
  openReceivableMinor: number;
  openPayableMinor: number;
  totalThisYearMinor: number;
  defaultCategory: { id: string; name: string; number: string } | null;
  defaultCategoryRule: { status: string; label: string };
};

export type InvoiceRow = {
  id: string;
  number: string;
  customerName: string;
  status: string;
  currency: string;
  issueDate: string;
  dueDate: string;
  totalMinor: number;
  amountPaidMinor: number;
  balanceMinor: number;
  daysPastDue: number;
};

export type BillRow = {
  id: string;
  vendorName: string;
  status: string;
  issueDate: string;
  dueDate: string;
  totalMinor: number;
  currency: string;
  daysUntilDue: number;
  document: { id: string; vendor: string; status: string; totalMinor: number } | null;
  postingAffordance: string;
};

export type EmployeeRow = {
  id: string;
  name: string;
  country: string;
  currency: string;
  monthlySalaryMinor: number;
  baseAmountMinor: number;
  fxDisplay: string;
  active: boolean;
  adjustmentMinor: number;
  finalAmountMinor: number;
};

export type PayrollRunRow = {
  id: string;
  period: string;
  status: string;
  totalBaseMinor: number;
  headcount: number;
  currencyTotals: Array<{ currency: string; localMinor: number; baseMinor: number }>;
  actionState: string;
};

export type AgingBucket = {
  currentMinor: number;
  days30Minor: number;
  days60Minor: number;
  days90Minor: number;
  totalMinor: number;
};

export function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}
