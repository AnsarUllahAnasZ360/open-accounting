"use client";

import { useQuery } from "convex/react";
import { Printer } from "lucide-react";

import { Amount, formatMinorMoney } from "@/components/openbooks/primitives";
import { Button } from "@/components/ui/button";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { api } from "../../../../../convex/_generated/api";

/**
 * Standalone printable payslip. Employees don't log in — this page backs the
 * "download PDF" link in their payslip email (print to PDF). Rendered outside
 * the app shell so it prints clean. With a `token` (the emailed capability
 * link) it reads via the public token-authorized query; without one it falls
 * back to the session-authorized query (for managers viewing in-app).
 */
export function PayslipView({ lineId, token }: { lineId: string; token?: string }) {
  const byToken = useQuery(
    api.payroll.payslipByToken,
    token ? { lineId: lineId as Id<"payrollRunLines">, token } : "skip",
  );
  const bySession = useQuery(
    api.payroll.payslip,
    token ? "skip" : { lineId: lineId as Id<"payrollRunLines"> },
  );
  const payslip = token ? byToken : bySession;

  if (payslip === undefined) {
    return <div className="p-8 text-sm text-muted-foreground">Loading payslip…</div>;
  }
  if (payslip === null) {
    return <div className="p-8 text-sm text-muted-foreground">Payslip not found.</div>;
  }

  const location = [payslip.employee.country !== "—" ? payslip.employee.country : null, payslip.employee.city]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto max-w-xl p-6 sm:p-10">
      <div className="mb-6 flex items-center justify-between print:hidden">
        <span className="text-sm text-muted-foreground">Payslip</span>
        <Button size="sm" variant="outline" onClick={() => window.print()}>
          <Printer data-icon="inline-start" />
          Print / Save PDF
        </Button>
      </div>

      <div className="rounded-xl border p-6">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-lg font-semibold">{payslip.entity.name}</h1>
            <p className="text-sm text-muted-foreground">Payslip · {payslip.run?.periodLabel ?? ""}</p>
          </div>
          {payslip.paid ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">Paid</span>
          ) : null}
        </div>

        <div className="mb-6">
          <div className="text-base font-medium">{payslip.employee.name}</div>
          <div className="text-sm text-muted-foreground">
            {[payslip.employee.title, location].filter(Boolean).join(" · ")}
          </div>
        </div>

        <table className="w-full border-collapse text-sm">
          <tbody>
            <tr className="border-t">
              <td className="py-2 text-muted-foreground">Base salary</td>
              <td className="py-2 text-right tabular-nums">
                <Amount amountMinor={payslip.baseSalaryMinor} currency={payslip.currency} />
              </td>
            </tr>
            {payslip.bonusMinor > 0 ? (
              <tr className="border-t">
                <td className="py-2 text-muted-foreground">Bonus</td>
                <td className="py-2 text-right tabular-nums">
                  <Amount amountMinor={payslip.bonusMinor} currency={payslip.currency} />
                </td>
              </tr>
            ) : null}
            {payslip.deductionMinor > 0 ? (
              <tr className="border-t">
                <td className="py-2 text-muted-foreground">Deduction</td>
                <td className="py-2 text-right tabular-nums">
                  −<Amount amountMinor={payslip.deductionMinor} currency={payslip.currency} />
                </td>
              </tr>
            ) : null}
            <tr className="border-t border-b">
              <td className="py-2.5 font-semibold">Net pay</td>
              <td className="py-2.5 text-right font-semibold tabular-nums" data-testid="payslip-net">
                {formatMinorMoney(payslip.finalLocalMinor, { currency: payslip.currency })}
              </td>
            </tr>
          </tbody>
        </table>

        {payslip.run?.postingDate ? (
          <p className="mt-6 text-xs text-muted-foreground">Pay period ending {payslip.run.postingDate}</p>
        ) : null}
      </div>
    </div>
  );
}
