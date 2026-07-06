import { ConvexError } from "convex/values";

// A single stream allocation on a transaction / invoice / bill.
export type StreamLine = { streamLabel: string; amountMinor: number };

/**
 * Validate + normalize a stream split for a record whose total is `totalMinor`
 * (streams redesign). Rules:
 *  - Empty / undefined → returns `undefined` (the record is simply untagged).
 *  - Labels are trimmed; blank-label or zero-amount lines are dropped.
 *  - Duplicate labels are merged (summed).
 *  - The remaining amounts MUST sum EXACTLY to `totalMinor` (integer minor
 *    units — no float drift), else a ConvexError is thrown. This is the
 *    "amounts always sum to the transaction amount" invariant enforced on save.
 * `totalMinor` is the record's signed total (a transaction's amountMinor may be
 * negative for outflows; invoices/bills are positive), so a split matches the
 * sign of the amount it divides.
 */
export function normalizeStreamSplit(
  streams: StreamLine[] | undefined,
  totalMinor: number,
): StreamLine[] | undefined {
  if (!streams || streams.length === 0) return undefined;

  const merged = new Map<string, number>();
  for (const line of streams) {
    const label = line.streamLabel.trim();
    const amount = Math.round(line.amountMinor);
    if (!label || amount === 0) continue;
    merged.set(label, (merged.get(label) ?? 0) + amount);
  }
  const cleaned: StreamLine[] = [...merged.entries()]
    .filter(([, amount]) => amount !== 0)
    .map(([streamLabel, amountMinor]) => ({ streamLabel, amountMinor }));

  if (cleaned.length === 0) return undefined;

  const sum = cleaned.reduce((acc, line) => acc + line.amountMinor, 0);
  if (sum !== totalMinor) {
    throw new ConvexError(
      `Stream split must sum to the total (${totalMinor}); the entered amounts sum to ${sum}.`,
    );
  }
  return cleaned;
}

/**
 * Expand a rule's basis-point split (sum 10000) to concrete minor-unit amounts
 * for a record of `totalMinor`, guaranteeing the parts sum EXACTLY to the total
 * (the rounding remainder lands on the largest share). Used by the rule engine
 * and any "apply this split" path.
 */
export function splitFromBps(
  split: ReadonlyArray<{ streamLabel: string; bps: number }>,
  totalMinor: number,
): StreamLine[] {
  const clean = split.filter((part) => part.streamLabel.trim() && part.bps > 0);
  if (clean.length === 0) return [];
  const lines = clean.map((part) => ({
    streamLabel: part.streamLabel.trim(),
    amountMinor: Math.trunc((totalMinor * part.bps) / 10000),
  }));
  const allocated = lines.reduce((acc, line) => acc + line.amountMinor, 0);
  const remainder = totalMinor - allocated;
  if (remainder !== 0) {
    // Put the rounding remainder on the largest-magnitude share.
    let idx = 0;
    for (let i = 1; i < lines.length; i += 1) {
      if (Math.abs(lines[i].amountMinor) > Math.abs(lines[idx].amountMinor)) idx = i;
    }
    lines[idx].amountMinor += remainder;
  }
  return lines;
}
