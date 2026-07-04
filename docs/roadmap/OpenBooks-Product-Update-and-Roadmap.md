# OpenBooks — Product Update & Roadmap

**26 June 2026 · Founder brief**

OpenBooks is open-source, AI-assisted, double-entry bookkeeping for small businesses and multi-LLC owners — a QuickBooks alternative where **AI proposes and the ledger engine posts.** A hidden double-entry ledger is the source of truth; money flows in (banks, Stripe, CSV, invoices, bills, receipts, manual), an AI pipeline posts the confident items and sends the rest to an Inbox for one-click review, and reports read from journal lines.

---

## Where the product is today

**The money loop works end-to-end:** ingest → AI classify (transfer → rule → memory → embedding → AI → review) → post through one ledger mutation → review uncertain items in the Inbox → report.

**Built & shipping:** Dashboard (per-business or portfolio), Transactions, Income/Expenses, Inbox, Contacts, Invoices (A/R, Stripe send + PDF), Bills (A/P), Reports (P&L / Balance Sheet / cash flow), Settings (Team, BYO-AI, Connections, Rules, Tax, Audit). **AI engine:** bring-your-own keys (OpenAI-compatible, OpenRouter, Bedrock…), confidence calibration, semantic memory, a grounded copilot, and CFO advisories (runway, burn, concentration, tax set-aside).

**Guardrails:** posted entries are immutable (corrections reverse-and-repost); money is integer minor-units; AI autonomy is one setting — Suggest / Balanced (≥90%) / Autopilot (≥75%).

---

## What we've delivered since taking on the project

- **Got it running locally (Windows)** — fixed setup/spawn/auth-bypass/env issues, repaired the **credential vault** (Convex-compatible HKDF), and wired **bring-your-own AI** (OpenRouter/Fireworks) so the chatbot and categorizer use the owner's own model.
- **UI modernization ("quiet futurism")** — full **dark mode** + toggle, refined depth/elevation, subtle **motion** (count-up KPIs, page entrance, reduced-motion safe), and a **density toggle**.
- **Workflow features** — per-business dashboard, "where money came from" income donut, red-expense/green-income color scheme, Inbox **AI-review filters** + "Run AI on selected," **Run AI catch-up**, contact linking, single-screen Transactions, search across tables, CSV file upload, professional **invoice PDF** + calendar due-dates.
- **Reliability & fixes** — system-wide clean error handling, removed hard-coded demo dates (expenses/invoices/aging), verified the **team-invite flow** and fixed the invite URL (`SITE_URL`), plus many UI/layout fixes (table fit, dropdown alignment, button cursor, Inbox rows).
- **Cleanup & docs** — removed unused files and dead Convex functions; produced this update &amp; roadmap.

---

## Next up — finish Payroll

Payroll has a data model and a screen but isn't yet end-to-end. It's the priority build because it touches the ledger, taxes, and compliance.

- Employees & contractors (W-2 / 1099), pay schedules, gross-to-net pay runs with **tax withholding**.
- **Ledger posting** of wages, payroll-tax liabilities, and net pay; remittance tracking; direct deposit; filings (941, W-2, 1099).
- **AI assist** — anomaly checks and plain-English run summaries.

*Recommended: API-backed tax tables & filings, native ledger posting — the fastest compliant path.*

---

## Roadmap — QuickBooks parity + AI differentiation

| Theme | Close the QuickBooks gap | The AI differentiator |
|---|---|---|
| **Receivables** | Estimates → invoice, recurring invoices, **sales-tax automation**, ACH payments | AR automation: predict pay dates, auto-dunning, risk-ranked collections |
| **Payables** | Vendor **bill pay**, purchase orders → 2/3-way match, 1099s | AP automation: read bills from email, OCR + PO match, schedule payments |
| **Banking & close** | Finish **bank reconciliation**, credit-card feeds, budgets vs actual | **AI month-end close**: auto-reconcile, propose accruals/depreciation, write the close summary |
| **Operations** | Products/light inventory, project & time tracking | Anomaly + duplicate detection; receipt/invoice OCR auto-match |
| **Platform** | Mobile app, multi-currency (FX), customizable reports | Natural-language reporting; agentic "close my books / chase overdue" (confirmable, never silent) |

**Suggested sequence:** **Now** → finish Payroll. **Next** → AI month-end close + AP/AR automation (biggest edge over QuickBooks). **Then** → sales tax, recurring invoices, bank reconciliation. **Later** → multi-currency, mobile, projects/inventory, agentic copilot.

---

*The principle holds at every step: **AI proposes, the ledger engine posts.***
