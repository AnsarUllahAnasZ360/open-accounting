"use node";

import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction } from "./_generated/server";
import type { DigestComposition, DigestDelta } from "./weeklyDigestData";
import type { ResolvedPlunkConfig } from "./plunk";

/**
 * Send one HTML email through Plunk. Mirrors packages/email/src/plunk.ts and
 * convex/auth.ts (raw fetch) so the digest job has no cross-package bundle
 * dependency. The resolved BYO secret is preferred; from-email/from-name come
 * from the resolved Plunk config when present.
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

/**
 * Weekly digest SEND job (Epic E9-T6). E9 OWNS the send job; the preference and
 * honest-status surface live in E12 (decisions Q47/Q65).
 *
 * A weekly cron (Monday 13:00 UTC) calls `runAll`, which iterates the workspaces
 * with the digest toggle ON and sends ONE combined portfolio email per workspace
 * (intercompany eliminated for multi-entity; see weeklyDigestData.composeDigest).
 *
 * Hard guarantees:
 *   - NO-OP, no throw, logged "skipped" when no Plunk key is configured (the
 *     unified `credentials` store OR env) or no recipient — so an env-only or
 *     unconfigured deployment is unaffected.
 *   - Idempotent per (workspace, ISO week) via the digestLog table: a second run
 *     in the same week sends nothing.
 *   - Every number in the email traces to the E9-T3 aggregate (reuse only).
 */

// USD minor units -> "$1,234" display string. Display-only; never stored.
function usd(amountMinor: number): string {
  const major = Math.round(amountMinor / 100);
  const sign = major < 0 ? "-$" : "$";
  return `${sign}${Math.abs(major).toLocaleString("en-US")}`;
}

function deltaLabel(label: string, delta: DigestDelta): string {
  const arrow = delta.deltaPct === null ? "" : delta.deltaPct > 0 ? " +" : delta.deltaPct < 0 ? " " : " ";
  const pct = delta.deltaPct === null ? "" : `${arrow}${delta.deltaPct}%`;
  return `${label}: ${usd(delta.currentMinor)}${pct ? ` (${pct.trim()} vs last month)` : ""}`;
}

// Compact, plain-English subject. Example: "OpenBooks weekly: revenue +8%, runway 4.1mo".
function buildSubject(composition: DigestComposition): string {
  const parts: string[] = [];
  if (composition.revenue.deltaPct !== null) {
    const sign = composition.revenue.deltaPct >= 0 ? "+" : "";
    parts.push(`revenue ${sign}${composition.revenue.deltaPct}%`);
  }
  if (composition.runwayMonths !== null) parts.push(`runway ${composition.runwayMonths.toFixed(1)}mo`);
  const tail = parts.length ? `: ${parts.join(", ")}` : "";
  return `OpenBooks weekly${tail}`;
}

function buildPlainTextBody(composition: DigestComposition): string {
  const lines: string[] = [];
  lines.push(`Your OpenBooks weekly summary for ${composition.workspaceName} (as of ${composition.asOf}).`);
  if (composition.entityCount > 1) {
    lines.push(`Combined across ${composition.entityCount} businesses, in USD.`);
  }
  lines.push("");
  lines.push(deltaLabel("Revenue", composition.revenue));
  lines.push(deltaLabel("Expenses", composition.expense));
  lines.push(deltaLabel("Profit", composition.profit));
  lines.push(`Cash on hand: ${usd(composition.cashPositionMinor)}`);
  if (composition.runwayMonths !== null) {
    lines.push(`Runway: about ${composition.runwayMonths.toFixed(1)} months at current burn.`);
  }
  if (composition.topCards.length > 0) {
    lines.push("");
    lines.push("What to look at:");
    for (const card of composition.topCards) lines.push(`- ${card.title}`);
  }
  lines.push("");
  lines.push("These figures come straight from your ledger. AI-generated estimate, review before relying.");
  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildHtmlBody(composition: DigestComposition): string {
  const row = (label: string, delta: DigestDelta) => {
    const pct =
      delta.deltaPct === null
        ? ""
        : ` <span style="color:#6b7280">(${delta.deltaPct > 0 ? "+" : ""}${delta.deltaPct}% vs last month)</span>`;
    return `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">${escapeHtml(label)}</td><td style="padding:4px 0;font-variant-numeric:tabular-nums">${usd(delta.currentMinor)}${pct}</td></tr>`;
  };
  const cards = composition.topCards
    .map((card) => `<li style="margin:4px 0">${escapeHtml(card.title)}</li>`)
    .join("");
  return [
    `<div style="font-family:Geist,system-ui,sans-serif;color:#111827;max-width:560px">`,
    `<h2 style="font-size:16px;margin:0 0 4px">OpenBooks weekly — ${escapeHtml(composition.workspaceName)}</h2>`,
    `<p style="color:#6b7280;margin:0 0 12px">As of ${escapeHtml(composition.asOf)}${composition.entityCount > 1 ? ` · combined across ${composition.entityCount} businesses (USD)` : ""}</p>`,
    `<table style="border-collapse:collapse;font-size:14px">`,
    row("Revenue", composition.revenue),
    row("Expenses", composition.expense),
    row("Profit", composition.profit),
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Cash on hand</td><td style="padding:4px 0;font-variant-numeric:tabular-nums">${usd(composition.cashPositionMinor)}</td></tr>`,
    composition.runwayMonths !== null
      ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Runway</td><td style="padding:4px 0">~${composition.runwayMonths.toFixed(1)} months</td></tr>`
      : "",
    `</table>`,
    cards ? `<p style="margin:16px 0 4px;font-weight:600">What to look at</p><ul style="margin:0;padding-left:18px">${cards}</ul>` : "",
    `<p style="color:#9ca3af;font-size:12px;margin-top:16px">These figures come straight from your ledger. AI-generated estimate, review before relying.</p>`,
    `</div>`,
  ].join("");
}

/**
 * ISO-week key like "2026-W25" (Monday-anchored) for the supplied date.
 * Idempotency key for digestLog — one digest per (workspace, ISO week).
 */
export function isoWeekKey(date: Date): string {
  // Copy and shift to the nearest Thursday (ISO-8601 week definition).
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (target.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  target.setUTCDate(target.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** True when `date` falls in the first Monday-anchored week of its month. */
export function isFirstMondayWeek(date: Date): boolean {
  return date.getUTCDate() <= 7;
}

/**
 * Send the combined weekly digest for ONE workspace. Idempotent per ISO week;
 * a clean no-op when no Plunk key / recipient is configured or digest is off.
 * Returns a small status so the cron + tests can assert behavior without leaking
 * any secret.
 */
export const sendWeeklyDigest = internalAction({
  args: { workspaceId: v.id("workspaces"), today: v.optional(v.string()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ status: "sent" | "skipped"; reason?: string; recipient?: string | null }> => {
    const today = args.today ?? new Date(Date.now()).toISOString().slice(0, 10);
    const weekKey = isoWeekKey(new Date(`${today}T00:00:00.000Z`));

    // Idempotency: claim the (workspace, week). A second run in the same week is a
    // no-op (no claim, no send).
    const claim = await ctx.runMutation(internal.weeklyDigestData.claimDigestWeek, {
      workspaceId: args.workspaceId,
      weekKey,
    });
    if (!claim.claimed) return { status: "skipped", reason: "already-sent-this-week" };

    const finish = async (
      status: "sent" | "skipped",
      reason: string | undefined,
      recipient: string | null,
    ) => {
      await ctx.runMutation(internal.weeklyDigestData.recordDigestOutcome, {
        rowId: claim.rowId,
        status,
        ...(recipient ? { recipient } : {}),
        ...(reason ? { detail: reason } : {}),
      });
      return { status, reason, recipient };
    };

    const composition: DigestComposition | null = await ctx.runQuery(
      internal.weeklyDigestData.composeDigest,
      { workspaceId: args.workspaceId, today },
    );
    if (!composition) return finish("skipped", "no-active-entity", null);
    if (!composition.digestEnabled) return finish("skipped", "digest-disabled", composition.recipient);
    if (!composition.recipient) return finish("skipped", "no-recipient", null);

    // Resolve the Plunk key (BYO unified credential preferred, else env). No key
    // configured anywhere -> clean no-op (decisions Q14).
    const plunk: ResolvedPlunkConfig | null = await ctx.runAction(internal.plunk.resolvePlunkConfig, {
      workspaceId: args.workspaceId,
    });
    if (!plunk) {
      console.log(`[weeklyDigest] skipped ${args.workspaceId}: no Plunk key configured`);
      return finish("skipped", "no-plunk-key", composition.recipient);
    }

    try {
      await deliverPlunkEmail({
        to: composition.recipient,
        subject: buildSubject(composition),
        body: buildHtmlBody(composition),
        secretKey: plunk.secretKey,
        ...(plunk.fromEmail ? { from: plunk.fromEmail } : {}),
        ...(plunk.fromName ? { fromName: plunk.fromName } : {}),
      });
      return finish("sent", undefined, composition.recipient);
    } catch (error) {
      const message = error instanceof Error ? error.message : "send failed";
      console.log(`[weeklyDigest] send failed for ${args.workspaceId}: ${message.slice(0, 120)}`);
      return finish("skipped", "send-failed", composition.recipient);
    }
  },
});

// Plain-text composer is exported for tests/inspection without sending.
export function composeDigestText(composition: DigestComposition): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: buildSubject(composition),
    text: buildPlainTextBody(composition),
    html: buildHtmlBody(composition),
  };
}

/**
 * Cron entrypoint (Monday 13:00 UTC): iterate digest-enabled workspaces and send
 * one combined portfolio email each. Monthly subscribers are skipped on
 * non-first-Monday weeks. A single workspace failing never aborts the run.
 */
export const runAll = internalAction({
  args: { today: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ attempted: number; sent: number; skipped: number }> => {
    const today = args.today ?? new Date(Date.now()).toISOString().slice(0, 10);
    const firstMonday = isFirstMondayWeek(new Date(`${today}T00:00:00.000Z`));
    const workspaces: Array<{ workspaceId: Id<"workspaces">; cadence: "weekly" | "monthly" }> =
      await ctx.runQuery(internal.weeklyDigestData.digestEnabledWorkspaces, {
        isFirstMondayWeek: firstMonday,
      });

    let sent = 0;
    let skipped = 0;
    for (const workspace of workspaces) {
      try {
        const result = await ctx.runAction(internal.weeklyDigest.sendWeeklyDigest, {
          workspaceId: workspace.workspaceId,
          today,
        });
        if (result.status === "sent") sent += 1;
        else skipped += 1;
      } catch {
        skipped += 1;
      }
    }
    return { attempted: workspaces.length, sent, skipped };
  },
});
