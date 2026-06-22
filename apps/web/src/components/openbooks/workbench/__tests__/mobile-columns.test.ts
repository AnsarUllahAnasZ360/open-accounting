import { describe, expect, it } from "vitest";

import { assignMobileColumnSlots, type MobileColumnMeta } from "../mobile-columns";

// E7-5: the mobile register card is a deliberate minimal layout —
// merchant headline + trailing amount, a single compact meta line (category +
// date), secondary fields hidden (reachable via the expand strip), never a long
// label/value stack that risks horizontal overflow.
const registerColumns: MobileColumnMeta[] = [
  { key: "date", mobileMeta: true },
  { key: "merchant", mobilePrimary: true },
  { key: "category", mobileMeta: true },
  { key: "contact", mobileHidden: true },
  { key: "account", mobileHidden: true },
  { key: "amount", mobileTrailing: true },
  { key: "attachment", mobileHidden: true },
  { key: "status", mobileHidden: true },
];

describe("assignMobileColumnSlots — register", () => {
  const slots = assignMobileColumnSlots(registerColumns);

  it("uses merchant as the headline and amount as the trailing emphasis", () => {
    expect(slots.primary?.key).toBe("merchant");
    expect(slots.trailing?.key).toBe("amount");
  });

  it("folds category + date into the compact meta line", () => {
    expect(slots.meta.map((c) => c.key)).toEqual(["date", "category"]);
  });

  it("keeps secondary fields off the verbose list (they are mobileHidden)", () => {
    expect(slots.rest).toHaveLength(0);
    for (const hidden of ["contact", "account", "attachment", "status"]) {
      expect(slots.meta.some((c) => c.key === hidden)).toBe(false);
      expect(slots.rest.some((c) => c.key === hidden)).toBe(false);
    }
  });
});

describe("assignMobileColumnSlots — fallback behavior", () => {
  it("falls back to the first column as headline and verbose rest when nothing opts in", () => {
    const cols: MobileColumnMeta[] = [{ key: "name" }, { key: "value" }, { key: "note" }];
    const slots = assignMobileColumnSlots(cols);
    expect(slots.primary?.key).toBe("name");
    expect(slots.trailing).toBeNull();
    expect(slots.meta).toHaveLength(0);
    // No field is silently lost — the non-headline columns go to the verbose list.
    expect(slots.rest.map((c) => c.key)).toEqual(["value", "note"]);
  });

  it("never duplicates the headline or trailing column into meta/rest", () => {
    const slots = assignMobileColumnSlots(registerColumns);
    const all = [...slots.meta, ...slots.rest];
    expect(all.some((c) => c.key === "merchant")).toBe(false);
    expect(all.some((c) => c.key === "amount")).toBe(false);
  });
});
