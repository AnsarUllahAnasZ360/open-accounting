"use client";

import { useMutation } from "convex/react";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Amount, formatMinorMoney } from "@/components/openbooks/primitives";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type PayrollRun = {
  id: Id<"payrollRuns">;
  period: string;
  status: string;
  reconciliationStatus?: string;
  settlementTxnId?: Id<"transactions">;
  expectedTotalMinor?: number;
  totalBaseMinor: number;
};

export function PayrollSettlementEditor({
  run,
  onSettlementConfirmed,
}: {
  run: PayrollRun;
  onSettlementConfirmed?: (entryId: Id<"journalEntries">) => void;
}) {
  const confirmSettlement = useMutation(api.payroll.confirmPayrollSettlement);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If no settlement, show appropriate message
  if (run.reconciliationStatus === "match_confirmed") {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            ✓ This payroll run is already settled
            {run.settlementTxnId ? " (matched to bank transaction)" : " (variance recorded)"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!run.settlementTxnId || run.reconciliationStatus !== "match_proposed") {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">
            No settlement proposal found. The auto-matcher will run when this run is approved.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Placeholder for settlement proposal
  // In full implementation, this would fetch the transaction and show splits
  const expectedTotal = run.expectedTotalMinor ?? run.totalBaseMinor;

  const handleConfirm = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await confirmSettlement({
        payrollRunId: run.id,
        transactionId: run.settlementTxnId!,
      });
      toast.success("Payroll settlement confirmed!");
      onSettlementConfirmed?.(result.entryId);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to confirm settlement");
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const getCategoryBadgeColor = (category: string) => {
    switch (category) {
      case "payroll":
        return "bg-ob-green-50 text-ob-green-800 border-ob-green-200";
      case "payroll_fee":
      case "bank_fee":
        return "bg-orange-50 text-orange-800 border-orange-200";
      case "tax_withholding":
        return "bg-blue-50 text-blue-800 border-blue-200";
      default:
        return "bg-gray-50 text-gray-800 border-gray-200";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settlement & Reconciliation</CardTitle>
        <CardDescription>
          Match this payroll run to the bank outflow and reconcile any discrepancies
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          </div>
        )}

        {/* Expected Payroll Summary */}
        <div className="rounded-lg bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground mb-2">Expected payroll total for {run.period}</p>
          <p className="text-2xl font-semibold font-mono">
            {formatMinorMoney(expectedTotal)}
          </p>
        </div>

        {/* Info text */}
        <p className="text-sm text-muted-foreground">
          When a matching bank outflow is detected, the system will calculate splits for payroll, fees, and taxes.
          You'll be able to review and confirm the settlement here.
        </p>

        {/* Action Button */}
        <Button
          onClick={handleConfirm}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? "Processing…" : "Review & Confirm Settlement"}
        </Button>
      </CardContent>
    </Card>
  );
}
