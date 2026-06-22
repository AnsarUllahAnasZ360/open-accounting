export type ContactHistoryItem = {
  id: string;
  kind: string;
  date: string;
  label: string;
  amountMinor: number;
  status: string;
};

export type ContactProfileData = ContactRow & {
  history: ContactHistoryItem[];
  mergeFlow: { status: string; reason: string; suggestion: string };
};

export type ModuleOverview = {
  entity: { id: string; name: string; currency: string; businessType: string; isDemo: boolean } | null;
  contacts: {
    rows: ContactRow[];
    selectedProfile: ContactProfileData | null;
    kpis: {
      openReceivableMinor: number;
      openPayableMinor: number;
      contactsCount: number;
      overdueReceivableCount: number;
    };
  };
  invoices: {
    kpis: { openMinor: number; overdueMinor: number; paidLast30Minor: number; averageDaysToPay: number };
    rows: InvoiceRow[];
    aging: AgingBucket;
    composer: { saveDraftStatus: string; sendViaStripeStatus: string; manualRecordStatus: string };
  };
  bills: {
    kpis: {
      openMinor: number;
      dueThisWeekMinor: number;
      dueSoonMinor: number;
      overdueMinor: number;
      paidThisPeriodMinor: number;
      missingEvidenceMinor: number;
      missingEvidenceCount: number;
      avgDaysToPay: number;
    };
    groups: Array<{ key: string; label: string; rows: BillRow[] }>;
    matchCandidates: Array<{ id: string; date: string; merchant: string; amountMinor: number; currency: string }>;
    uploadPdf: {
      status: string;
      reason: string;
      documents: Array<{
        id: string;
        kind: string;
        vendor: string;
        date: string;
        totalMinor: number;
        currency: string;
        status: string;
        fileName: string | null;
        fileUrl: string | null;
        extractionSource: string;
        extractionConfidence: number;
        extractionNotes: string;
        candidateTransaction: {
          id: string;
          merchant: string;
          date: string;
          amountMinor: number;
          currency: string;
        } | null;
        matchedTransaction: {
          id: string;
          merchant: string;
          date: string;
          amountMinor: number;
          currency: string;
        } | null;
      }>;
    };
  };
  payroll: {
    employees: EmployeeRow[];
    runs: PayrollRunRow[];
    currencyTotals: Array<{ currency: string; localMinor: number; baseMinor: number }>;
    unmatchedCount: number;
    statementRows: Array<{
      employeeName: string;
      country: string;
      currency: string;
      localMinor: number;
      baseMinor: number;
      fxDisplay: string;
    }>;
    statementCsv: string;
    // E10-T5: one statement block + one CSV export PER currency.
    statementsByCurrency: Array<{
      currency: string;
      isBaseCurrency: boolean;
      rows: Array<{
        employeeName: string;
        country: string;
        currency: string;
        localMinor: number;
        baseMinor: number;
        fxDisplay: string;
      }>;
      localMinor: number;
      baseMinor: number;
      fxDisplay: string;
      csv: string;
      csvFilename: string;
    }>;
    // E10-T6: the single payroll page insight (run-rate / headcount / FX).
    insight: {
      runRateBaseMinor: number;
      runRateBasedOnApprovedRun: boolean;
      latestApprovedPeriod: string | null;
      headcount: number;
      baseCurrency: string;
      hasFxExposure: boolean;
      fxExposureSharePct: number;
      fxExposureBaseMinor: number;
      nonBaseCurrencies: string[];
    };
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
  notes: string | null;
  archived: boolean;
  openReceivableMinor: number;
  openPayableMinor: number;
  overdueReceivableMinor: number;
  moneyInYtdMinor: number;
  moneyOutYtdMinor: number;
  totalThisYearMinor: number;
  lastActivity?: number;
  lastActivityDate: string | null;
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

export type BillLedgerLine = {
  account: string;
  accountNumber: string;
  debitMinor: number;
  creditMinor: number;
  currency: string;
};

export type BillRow = {
  id: string;
  vendorName: string;
  contactId: string;
  status: string;
  issueDate: string;
  dueDate: string;
  createdAt: number;
  totalMinor: number;
  currency: string;
  daysUntilDue: number;
  isOverdue: boolean;
  isDueSoon: boolean;
  source: "pdf" | "manual";
  paymentMatch: "matched" | "scheduled" | "expected";
  /** The bank transaction that settled a paid bill, when resolvable; else null. */
  matchedTransactionId: string | null;
  attention: "overdue" | "missing-evidence" | null;
  hasEvidence: boolean;
  extractionConfidence: number | null;
  extractionNotes: string | null;
  extractionSource: string | null;
  category: string | null;
  ledgerEntryIds: string[];
  ledgerLines: BillLedgerLine[];
  document: {
    id: string;
    vendor: string;
    status: string;
    totalMinor: number;
    fileName: string | null;
    date: string;
  } | null;
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
  /** "manual" (owner-started) or "auto-draft" (drafted by the schedule). */
  source: "manual" | "auto-draft";
  totalBaseMinor: number;
  headcount: number;
  currencyTotals: Array<{ currency: string; localMinor: number; baseMinor: number }>;
  /** Approved-but-unsettled lines awaiting a bank match (0 for drafts/paid). */
  unmatchedCount: number;
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
