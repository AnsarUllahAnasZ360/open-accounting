/// <reference types="vite/client" />
import { describe, expect, it } from "vitest";

import type { Doc, Id } from "./_generated/dataModel";
import { computeCfoAnomalies } from "./aiCfoAnomalies";

// E9-T9 — anomaly + duplicate detection. Pure function over loaded transactions:
// flag duplicate-charge candidates, amount spikes, and new-large-vendors; never
// flag legitimate recurring charges or internal transfers.

let counter = 0;
function txn(overrides: Partial<Doc<"transactions">>): Doc<"transactions"> {
  counter += 1;
  return {
    _id: `txn_${counter}` as Id<"transactions">,
    _creationTime: 0,
    entityId: "entity_1" as Id<"entities">,
    date: "2026-06-10",
    amountMinor: -100_00,
    currency: "USD",
    merchant: "Vendor",
    rawDescription: "vendor charge",
    status: "posted",
    review: "auto",
    source: "bank",
    externalId: `ext_${counter}`,
    evalSet: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Doc<"transactions">;
}

describe("CFO anomaly detection (E9-T9)", () => {
  it("flags a duplicate charge pair and a spike, but NOT recurring or transfers", () => {
    const transactions: Doc<"transactions">[] = [
      // Duplicate: same merchant + amount within 3 days, non-recurring (appears
      // only in June).
      txn({ merchant: "Dupe Co", amountMinor: -250_00, date: "2026-06-03" }),
      txn({ merchant: "Dupe Co", amountMinor: -250_00, date: "2026-06-05" }),

      // Spike: a merchant with a steady baseline (3 charges above the $50 floor)
      // then one much bigger charge.
      txn({ merchant: "Cloud", amountMinor: -60_00, date: "2026-06-01" }),
      txn({ merchant: "Cloud", amountMinor: -60_00, date: "2026-06-08" }),
      txn({ merchant: "Cloud", amountMinor: -60_00, date: "2026-06-15" }),
      txn({ merchant: "Cloud", amountMinor: -500_00, date: "2026-06-22" }),

      // Recurring subscription: same amount across 3 distinct months → NOT a
      // duplicate/spike even though it repeats.
      txn({ merchant: "Saas Inc", amountMinor: -99_00, date: "2026-04-01" }),
      txn({ merchant: "Saas Inc", amountMinor: -99_00, date: "2026-05-01" }),
      txn({ merchant: "Saas Inc", amountMinor: -99_00, date: "2026-06-01" }),

      // A flagged transfer with a same-amount close pair → must be ignored.
      txn({ merchant: "Move Money", amountMinor: -1000_00, date: "2026-06-02", transferPairId: "pair-1" }),
      txn({ merchant: "Move Money", amountMinor: -1000_00, date: "2026-06-03", transferPairId: "pair-1" }),
    ];

    const cards = computeCfoAnomalies({ transactions, asOf: "2026-06-25" });

    const duplicates = cards.filter((c) => c.kind === "duplicate");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].txnIds).toHaveLength(2);
    expect(duplicates[0].metricMinor).toBe(250_00);

    const spikes = cards.filter((c) => c.kind === "spike");
    expect(spikes).toHaveLength(1);
    expect(spikes[0].metricMinor).toBe(500_00);
    expect(spikes[0].comparatorMinor).toBe(60_00);

    // Recurring SaaS NOT flagged anywhere.
    expect(cards.some((c) => c.txnIds.some((id) => transactions.find((t) => t._id === id)?.merchant === "Saas Inc"))).toBe(false);
    // Transfer NOT flagged.
    expect(cards.some((c) => c.txnIds.some((id) => transactions.find((t) => t._id === id)?.merchant === "Move Money"))).toBe(false);
  });

  it("flags a new large vendor and ignores small new vendors", () => {
    const transactions: Doc<"transactions">[] = [
      txn({ merchant: "Big New Vendor", amountMinor: -1500_00, date: "2026-06-10" }),
      txn({ merchant: "Tiny New Vendor", amountMinor: -40_00, date: "2026-06-11" }),
    ];
    const cards = computeCfoAnomalies({ transactions, asOf: "2026-06-25" });
    const newVendor = cards.filter((c) => c.kind === "new_large_vendor");
    expect(newVendor).toHaveLength(1);
    expect(newVendor[0].metricMinor).toBe(1500_00);
  });
});
