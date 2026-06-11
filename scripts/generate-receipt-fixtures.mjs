import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const outputDir = join(process.cwd(), "tests", "fixtures", "receipts");

const receipts = [
  { vendor: "Amazon Business", slug: "amazon-business", date: "2026-04-12", total: "128.45", category: "Office supplies" },
  { vendor: "Figma", slug: "figma", date: "2026-05-14", total: "99.00", category: "Software" },
  { vendor: "Delta Air Lines", slug: "delta-air-lines", date: "2026-06-08", total: "640.00", category: "Travel" },
  { vendor: "Unknown Parking", slug: "unknown-parking", date: "2026-06-10", total: "42.00", category: "Parking" },
  { vendor: "Client Lunch", slug: "client-lunch", date: "2026-06-11", total: "88.00", category: "Meals" },
];

function receiptHtml(receipt) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body {
        margin: 0;
        background: #f6f7f4;
        font-family: Arial, sans-serif;
      }
      .receipt {
        width: 360px;
        min-height: 520px;
        box-sizing: border-box;
        margin: 0;
        padding: 28px;
        background: #ffffff;
        color: #111827;
      }
      .brand {
        border-bottom: 2px solid #2ca01c;
        padding-bottom: 16px;
      }
      h1 {
        margin: 0;
        font-size: 24px;
        letter-spacing: 0;
      }
      .meta,
      .line,
      .total,
      .foot {
        display: flex;
        justify-content: space-between;
        gap: 16px;
      }
      .meta {
        margin-top: 18px;
        font-size: 14px;
        color: #4b5563;
      }
      .items {
        margin-top: 28px;
        border-top: 1px solid #e5e7eb;
        border-bottom: 1px solid #e5e7eb;
      }
      .line {
        padding: 13px 0;
        font-size: 15px;
      }
      .muted {
        color: #6b7280;
      }
      .total {
        margin-top: 24px;
        font-weight: 700;
        font-size: 20px;
      }
      .foot {
        margin-top: 34px;
        font-size: 12px;
        color: #6b7280;
      }
    </style>
  </head>
  <body>
    <main class="receipt">
      <section class="brand">
        <h1>${receipt.vendor}</h1>
        <div class="muted">Receipt</div>
      </section>
      <section class="meta">
        <span>Date</span>
        <strong>${receipt.date}</strong>
      </section>
      <section class="items">
        <div class="line">
          <span>${receipt.category}</span>
          <span>$${receipt.total}</span>
        </div>
        <div class="line muted">
          <span>Tax included</span>
          <span>$0.00</span>
        </div>
      </section>
      <section class="total">
        <span>Total</span>
        <span>$${receipt.total}</span>
      </section>
      <section class="foot">
        <span>OpenBooks fixture</span>
        <span>USD</span>
      </section>
    </main>
  </body>
</html>`;
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 520 }, deviceScaleFactor: 2 });

const manifest = [];
for (const receipt of receipts) {
  const cents = receipt.total.replace(".", "");
  const fileName = `receipt-${receipt.slug}-${receipt.date}-${receipt.total}.png`;
  await page.setContent(receiptHtml(receipt), { waitUntil: "networkidle" });
  await page.screenshot({ path: join(outputDir, fileName), fullPage: true });
  manifest.push({
    fileName,
    vendor: receipt.vendor,
    date: receipt.date,
    totalMinor: Number(cents),
    currency: "USD",
    category: receipt.category,
  });
}

await browser.close();
await writeFile(join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${manifest.length} receipt fixtures to ${outputDir}`);
