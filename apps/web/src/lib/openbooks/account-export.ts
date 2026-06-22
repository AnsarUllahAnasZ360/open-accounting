// Full-account export serialization (Epic E11-T9). Turns the secret-free
// snapshot from `api.exportAccount.fullAccount` into a downloadable JSON file
// PLUS a zip of per-table CSVs (including a CPA-readable journal-lines CSV).
//
// The zip writer is a dependency-free STORED (uncompressed) ZIP — valid per the
// PKZIP spec (local file headers + CRC32 + central directory). No new npm
// dependency is added; the file stays small relative to a full book.

export type AccountSnapshot = {
  meta: { entity: { name: string; currency: string }; rowCounts: Record<string, number> };
  entity: Record<string, unknown>;
  accounts: Array<Record<string, unknown>>;
  journalEntries: Array<Record<string, unknown>>;
  journalLines: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  contacts: Array<Record<string, unknown>>;
  invoices: Array<Record<string, unknown>>;
  bills: Array<Record<string, unknown>>;
  employees: Array<Record<string, unknown>>;
  payrollRuns: Array<Record<string, unknown>>;
  payrollRunLines: Array<Record<string, unknown>>;
  rules: Array<Record<string, unknown>>;
  connections: {
    bankAccounts: Array<Record<string, unknown>>;
    stripeAccounts: Array<Record<string, unknown>>;
    financialConnections: Array<Record<string, unknown>>;
  };
};

type CsvCell = string | number | boolean | null | undefined;

function csvEscape(value: CsvCell) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** Serialize an array of flat row objects to CSV (header = union of keys). */
function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "\n";
  const headers: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!headers.includes(key)) headers.push(key);
    }
  }
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((key) => {
          const value = row[key];
          // Flatten objects/arrays to JSON so they survive a single CSV cell.
          if (value !== null && typeof value === "object") return csvEscape(JSON.stringify(value));
          return csvEscape(value as CsvCell);
        })
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

// --- Minimal STORED-mode ZIP writer (no dependency) -------------------------

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i]!;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipEntry = { name: string; data: Uint8Array };

export function buildZip(files: Array<{ name: string; content: string }>): Blob {
  const encoder = new TextEncoder();
  const entries: ZipEntry[] = files.map((file) => ({
    name: file.name,
    data: encoder.encode(file.content),
  }));

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header (30 bytes + name) — STORED (compression method 0).
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // signature
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0, true); // flags
    local.setUint16(8, 0, true); // method = stored
    local.setUint16(10, 0, true); // mod time
    local.setUint16(12, 0, true); // mod date
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size
    local.setUint32(22, size, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra length
    localParts.push(new Uint8Array(local.buffer), nameBytes, entry.data);

    // Central directory header (46 bytes + name).
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true); // signature
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, size, true);
    central.setUint32(24, size, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true); // local header offset
    centralParts.push(new Uint8Array(central.buffer), nameBytes);

    offset += 30 + nameBytes.length + size;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // EOCD signature
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true);

  return new Blob(
    [...localParts, ...centralParts, new Uint8Array(end.buffer)] as BlobPart[],
    { type: "application/zip" },
  );
}

function slugForFile(name: string): string {
  return (name || "account").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "account";
}

/** The JSON snapshot file (one click → full account as a file the owner owns). */
export function accountJsonFile(snapshot: AccountSnapshot): { path: string; content: string } {
  const base = slugForFile(snapshot.meta.entity.name);
  return {
    path: `openbooks-${base}-account.json`,
    content: JSON.stringify(snapshot, null, 2),
  };
}

/** The per-table CSV set (each becomes a file inside the zip). */
export function accountCsvFiles(snapshot: AccountSnapshot): Array<{ name: string; content: string }> {
  return [
    { name: "entity.csv", content: rowsToCsv([snapshot.entity]) },
    { name: "chart-of-accounts.csv", content: rowsToCsv(snapshot.accounts) },
    { name: "journal-entries.csv", content: rowsToCsv(snapshot.journalEntries) },
    // The CPA-readable journal-lines CSV (every debit/credit leg).
    { name: "journal-lines.csv", content: rowsToCsv(snapshot.journalLines) },
    { name: "transactions.csv", content: rowsToCsv(snapshot.transactions) },
    { name: "contacts.csv", content: rowsToCsv(snapshot.contacts) },
    { name: "invoices.csv", content: rowsToCsv(snapshot.invoices) },
    { name: "bills.csv", content: rowsToCsv(snapshot.bills) },
    { name: "employees.csv", content: rowsToCsv(snapshot.employees) },
    { name: "payroll-runs.csv", content: rowsToCsv(snapshot.payrollRuns) },
    { name: "payroll-run-lines.csv", content: rowsToCsv(snapshot.payrollRunLines) },
    { name: "rules.csv", content: rowsToCsv(snapshot.rules) },
    { name: "connections-bank-accounts.csv", content: rowsToCsv(snapshot.connections.bankAccounts) },
    { name: "connections-stripe-accounts.csv", content: rowsToCsv(snapshot.connections.stripeAccounts) },
    { name: "connections.csv", content: rowsToCsv(snapshot.connections.financialConnections) },
  ];
}

export function accountZipFileName(snapshot: AccountSnapshot): string {
  return `openbooks-${slugForFile(snapshot.meta.entity.name)}-account-csv.zip`;
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadTextFile(file: { path: string; content: string }, mimeType = "application/json") {
  downloadBlob(new Blob([file.content], { type: mimeType }), file.path);
}
