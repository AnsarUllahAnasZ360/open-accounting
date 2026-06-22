import { describe, expect, it } from "vitest";

import {
  accountCsvFiles,
  accountJsonFile,
  buildZip,
  type AccountSnapshot,
} from "../account-export";

// E11-T9: the full-account export serializer. The JSON snapshot + per-table CSV
// zip must contain every entity table, a CPA-readable journal-lines CSV, and NO
// secret material.

function makeSnapshot(): AccountSnapshot {
  return {
    meta: { entity: { name: "Export Co", currency: "USD" }, rowCounts: {} },
    entity: { id: "e1", name: "Export Co", currency: "USD" },
    accounts: [{ id: "a1", name: "Operating Checking", number: "1010", type: "asset" }],
    journalEntries: [{ id: "je1", date: "2026-03-01", memo: "Invoice payment", source: "invoice" }],
    journalLines: [
      { id: "jl1", entryId: "je1", accountId: "a1", debitMinor: 120000, creditMinor: 0, currency: "USD" },
      { id: "jl2", entryId: "je1", accountId: "a2", debitMinor: 0, creditMinor: 120000, currency: "USD" },
    ],
    transactions: [{ id: "t1", date: "2026-03-01", amountMinor: 120000, merchant: "Acme, Inc." }],
    contacts: [{ id: "c1", name: "Acme \"Big\" Customer", roles: ["customer"] }],
    invoices: [{ id: "i1", number: "INV-1", totalMinor: 120000, status: "paid" }],
    bills: [],
    employees: [{ id: "emp1", name: "Dev One", monthlySalaryMinor: 500000 }],
    payrollRuns: [{ id: "pr1", period: "2026-03", totalBaseMinor: 500000, status: "paid" }],
    payrollRunLines: [{ id: "prl1", runId: "pr1", employeeName: "Dev One", finalLocalMinor: 500000 }],
    rules: [{ id: "r1", name: "AWS → Software", direction: "outflow", autoPost: true }],
    connections: {
      bankAccounts: [{ id: "ba1", name: "Checking", mask: "4242", kind: "checking" }],
      stripeAccounts: [{ id: "sa1", label: "Stripe", mode: "live", status: "active" }],
      financialConnections: [{ id: "fc1", provider: "plaid", displayName: "Chase", status: "active" }],
    },
  };
}

describe("account-export serializer (E11-T9)", () => {
  it("emits a JSON snapshot and a per-table CSV set including journal-lines", () => {
    const snapshot = makeSnapshot();

    const json = accountJsonFile(snapshot);
    expect(json.path).toMatch(/\.json$/);
    expect(JSON.parse(json.content).entity.name).toBe("Export Co");

    const files = accountCsvFiles(snapshot);
    const names = files.map((f) => f.name);
    expect(names).toContain("journal-lines.csv");
    expect(names).toContain("chart-of-accounts.csv");
    expect(names).toContain("transactions.csv");
    expect(names).toContain("contacts.csv");
    expect(names).toContain("invoices.csv");
    expect(names).toContain("payroll-run-lines.csv");

    // Journal-lines CSV has a header + both legs.
    const jl = files.find((f) => f.name === "journal-lines.csv")!;
    expect(jl.content).toContain("debitMinor");
    expect(jl.content.trim().split("\n").length).toBe(3); // header + 2 lines

    // CSV escaping survives commas/quotes in merchant/contact names.
    const txns = files.find((f) => f.name === "transactions.csv")!;
    expect(txns.content).toContain('"Acme, Inc."');
    const contacts = files.find((f) => f.name === "contacts.csv")!;
    expect(contacts.content).toContain('Acme ""Big"" Customer');
  });

  it("builds a valid (PKZIP-signature) zip blob", async () => {
    const files = accountCsvFiles(makeSnapshot());
    const zip = buildZip(files);
    expect(zip.type).toBe("application/zip");
    const bytes = new Uint8Array(await zip.arrayBuffer());
    // Local file header signature 'PK\x03\x04'.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
    // End-of-central-directory signature 'PK\x05\x06' appears at the tail.
    const tail = bytes.slice(bytes.length - 22);
    expect(tail[0]).toBe(0x50);
    expect(tail[1]).toBe(0x4b);
    expect(tail[2]).toBe(0x05);
    expect(tail[3]).toBe(0x06);
  });
});
