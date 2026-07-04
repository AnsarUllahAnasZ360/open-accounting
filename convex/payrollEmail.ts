"use node";

import { randomBytes } from "crypto";

import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import type { ResolvedPlunkConfig } from "./plunk";

/**
 * Payslip email delivery (payroll extension). Employees do not log in — they
 * receive their payslip by email (Plunk) with a link to a printable/downloadable
 * payslip page. Authorization + demo-blocking live in the internal query
 * `payroll.payslipSendData` (payroll.manage); this "use node" action only
 * resolves the Plunk key and sends. Mirrors weeklyDigest's raw-fetch sender so
 * there's no cross-package bundle dependency.
 */
async function deliverPlunkEmail(input: {
  to: string;
  subject: string;
  body: string;
  secretKey: string;
  from?: string;
  fromName?: string;
}): Promise<void> {
  const baseUrl = (process.env.PLUNK_API_BASE_URL ?? "https://api.plunk.zikrainfotech.com").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/v1/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: input.to,
      subject: input.subject,
      body: input.body,
      from: input.from ?? process.env.PLUNK_FROM_EMAIL,
      fromName: input.fromName ?? process.env.PLUNK_FROM_NAME,
    }),
  });
  if (!response.ok) {
    throw new Error(`Plunk email send failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { success?: boolean; error?: { message?: string } };
  if (payload.success === false) {
    throw new Error(payload.error?.message ?? "Plunk email send failed");
  }
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(minor / 100);
}

export const sendPayslip = action({
  args: { lineId: v.id("payrollRunLines"), appOrigin: v.string() },
  handler: async (ctx, args): Promise<{ ok: true; to: string }> => {
    const data = await ctx.runQuery(internal.payroll.payslipSendData, { lineId: args.lineId });
    if (!data.to) {
      throw new ConvexError("This employee has no email on file. Add one on their profile first.");
    }
    const plunk: ResolvedPlunkConfig | null = await ctx.runAction(internal.plunk.resolvePlunkConfig, {
      workspaceId: data.workspaceId,
    });
    if (!plunk) {
      throw new ConvexError("No email provider is configured. Add a Plunk key in Settings → Connections first.");
    }

    // Mint a capability token so the emailed link works without a login. Reuses
    // any existing token so previously-sent links stay valid.
    const { token } = await ctx.runMutation(internal.payroll.setPayslipToken, {
      lineId: args.lineId,
      token: randomBytes(24).toString("hex"),
    });
    const link = `${args.appOrigin.replace(/\/+$/, "")}/payroll/payslip/${args.lineId}${token ? `?t=${token}` : ""}`;
    const rows = [
      ["Base salary", money(data.baseSalaryMinor, data.currency)],
      ...(data.bonusMinor > 0 ? [["Bonus", money(data.bonusMinor, data.currency)]] : []),
      ...(data.deductionMinor > 0 ? [["Deduction", `− ${money(data.deductionMinor, data.currency)}`]] : []),
      ["Net pay", money(data.finalLocalMinor, data.currency)],
    ]
      .map(
        ([label, value]) =>
          `<tr><td style="padding:6px 0;color:#555">${label}</td><td style="padding:6px 0;text-align:right;font-weight:600">${value}</td></tr>`,
      )
      .join("");
    const body = `
      <div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:520px;margin:0 auto;color:#111">
        <h2 style="margin:0 0 4px">Payslip — ${data.periodLabel}</h2>
        <p style="margin:0 0 16px;color:#555">${data.entityName} · ${data.employeeName}</p>
        <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee;border-bottom:1px solid #eee">${rows}</table>
        <p style="margin:20px 0 0"><a href="${link}" style="color:#2ca01c;font-weight:600">View / download your payslip</a></p>
      </div>`;

    await deliverPlunkEmail({
      to: data.to,
      subject: `Payslip — ${data.periodLabel} · ${data.entityName}`,
      body,
      secretKey: plunk.secretKey,
      from: plunk.fromEmail,
      fromName: plunk.fromName,
    });

    return { ok: true, to: data.to };
  },
});
