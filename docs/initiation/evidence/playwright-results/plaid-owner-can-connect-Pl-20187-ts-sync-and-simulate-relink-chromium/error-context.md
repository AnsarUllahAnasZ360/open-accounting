# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: plaid.spec.ts >> owner can connect Plaid sandbox bypass, select accounts, sync, and simulate relink
- Location: tests/e2e/plaid.spec.ts:86:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('plaid-recent-transactions')
Expected pattern: /Notion|Client ACH|Plaid Sandbox Bank/i
Timeout: 30000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 30000ms
  - waiting for getByTestId('plaid-recent-transactions')

```

```yaml
- complementary:
  - link "OB OpenBooks Ansar's workspace":
    - /url: /dashboard
  - button "Ansar's workspace owner"
  - navigation:
    - link "Dashboard":
      - /url: /dashboard
    - link "Inbox":
      - /url: /inbox
    - link "Transactions":
      - /url: /transactions
    - link "Invoices":
      - /url: /invoices
    - link "Bills":
      - /url: /bills
    - link "Contacts":
      - /url: /contacts
    - link "Payroll":
      - /url: /payroll
    - link "Reports":
      - /url: /reports
    - link "Settings":
      - /url: /settings
  - text: Sync status Ready Seed and sandbox connections pending.
- banner:
  - button "Search transactions, contacts, reports"
  - button "Ask AI"
  - button "Sign out"
- main:
  - paragraph: Acme Studio LLC
  - heading "Settings" [level=1]
  - paragraph: Businesses, connections, rules, AI, accounting, audit log, and exports.
  - text: Demo entity Data
  - paragraph: Reset Acme Studio LLC to the deterministic ledger-backed demo books.
  - button "Export CSV bundle"
  - button "Export JSON"
  - button "Reset demo data"
  - text: Transactions 922 Posted 915 Open Inbox 12 Eval labels 120 Trial balance difference $0.00 Last seeded 6/11/2026, 8:31:21 AM
  - heading "Accounting" [level=2]
  - paragraph: Chart of accounts, manual journal entry, General Ledger, and Trial Balance.
  - button "Initialize chart"
  - text: Manual journal entry Date
  - textbox "Date": 2026-06-11
  - text: Amount
  - textbox "Amount": "100.00"
  - text: Debit
  - combobox: 1000 · Cash on Hand
  - text: Credit
  - combobox: 3000 · Owner's Equity
  - text: Memo
  - textbox "Memo": Manual owner contribution
  - button "Post entry"
  - text: Period lock
  - paragraph: "Current lock: 2026-03-31"
  - text: Locked through
  - textbox "Locked through"
  - button "Update lock"
  - text: Chart of accounts editor Account
  - combobox: 1000 · Cash on Hand
  - text: Friendly name
  - textbox "Friendly name": Cash on Hand
  - checkbox "Archived"
  - text: Archived 1000 · asset · cash
  - button "Save account"
  - heading "Trial Balance" [level=3]
  - paragraph: "Difference: $0.00"
  - table:
    - rowgroup:
      - row "Account Type Debit Credit":
        - columnheader "Account"
        - columnheader "Type"
        - columnheader "Debit"
        - columnheader "Credit"
    - rowgroup:
      - row "1000 · Cash on Hand asset $864.15 $0.00":
        - cell "1000 · Cash on Hand"
        - cell "asset"
        - cell "$864.15"
        - cell "$0.00"
      - row "1010 · Operating Checking asset $1,551.80 $0.00":
        - cell "1010 · Operating Checking"
        - cell "asset"
        - cell "$1,551.80"
        - cell "$0.00"
      - row "1020 · Savings asset $0.00 $0.00":
        - cell "1020 · Savings"
        - cell "asset"
        - cell "$0.00"
        - cell "$0.00"
      - row "1030 · Plaid Sandbox Checking asset $0.00 $0.00":
        - cell "1030 · Plaid Sandbox Checking"
        - cell "asset"
        - cell "$0.00"
        - cell "$0.00"
      - row "1100 · Accounts Receivable asset $20.00 $0.00":
        - cell "1100 · Accounts Receivable"
        - cell "asset"
        - cell "$20.00"
        - cell "$0.00"
      - row "1150 · Stripe Clearing asset $131,026.17 $0.00":
        - cell "1150 · Stripe Clearing"
        - cell "asset"
        - cell "$131,026.17"
        - cell "$0.00"
      - row "1200 · Prepaid Expenses asset $0.00 $0.00":
        - cell "1200 · Prepaid Expenses"
        - cell "asset"
        - cell "$0.00"
        - cell "$0.00"
      - row "1500 · Equipment asset $0.00 $0.00":
        - cell "1500 · Equipment"
        - cell "asset"
        - cell "$0.00"
        - cell "$0.00"
      - row "2000 · Credit Card liability $0.00 $0.00":
        - cell "2000 · Credit Card"
        - cell "liability"
        - cell "$0.00"
        - cell "$0.00"
      - row "2001 · Plaid Sandbox Credit Card liability $0.00 $0.00":
        - cell "2001 · Plaid Sandbox Credit Card"
        - cell "liability"
        - cell "$0.00"
        - cell "$0.00"
      - row "2100 · Accounts Payable liability $0.00 $0.00":
        - cell "2100 · Accounts Payable"
        - cell "liability"
        - cell "$0.00"
        - cell "$0.00"
      - row "2200 · Payroll Payable liability $0.00 $0.00":
        - cell "2200 · Payroll Payable"
        - cell "liability"
        - cell "$0.00"
        - cell "$0.00"
      - row "2300 · Sales Tax Payable liability $0.00 $0.00":
        - cell "2300 · Sales Tax Payable"
        - cell "liability"
        - cell "$0.00"
        - cell "$0.00"
      - row "2500 · Loans Payable liability $0.00 $0.00":
        - cell "2500 · Loans Payable"
        - cell "liability"
        - cell "$0.00"
        - cell "$0.00"
      - row "3000 · Owner's Equity equity $0.00 $864.15":
        - cell "3000 · Owner's Equity"
        - cell "equity"
        - cell "$0.00"
        - cell "$864.15"
      - row "3100 · Owner's Draw equity $0.00 $0.00":
        - cell "3100 · Owner's Draw"
        - cell "equity"
        - cell "$0.00"
        - cell "$0.00"
      - row "3200 · Retained Earnings equity $0.00 $0.00":
        - cell "3200 · Retained Earnings"
        - cell "equity"
        - cell "$0.00"
        - cell "$0.00"
      - row "3900 · Opening Balance Equity equity $0.00 $0.00":
        - cell "3900 · Opening Balance Equity"
        - cell "equity"
        - cell "$0.00"
        - cell "$0.00"
      - row "4000 · Sales income $0.00 $136,642.01":
        - cell "4000 · Sales"
        - cell "income"
        - cell "$0.00"
        - cell "$136,642.01"
      - row "4100 · Services income $0.00 $0.00":
        - cell "4100 · Services"
        - cell "income"
        - cell "$0.00"
        - cell "$0.00"
      - row "4200 · Other Income income $0.00 $0.00":
        - cell "4200 · Other Income"
        - cell "income"
        - cell "$0.00"
        - cell "$0.00"
      - row "4900 · Uncategorized Income income $0.00 $0.00":
        - cell "4900 · Uncategorized Income"
        - cell "income"
        - cell "$0.00"
        - cell "$0.00"
      - row "5000 · Payroll & Contractors expense $0.00 $0.00":
        - cell "5000 · Payroll & Contractors"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "5100 · Rent expense $0.00 $0.00":
        - cell "5100 · Rent"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "5200 · Software & SaaS expense $0.00 $0.00":
        - cell "5200 · Software & SaaS"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "5300 · Cloud/Infrastructure expense $0.00 $0.00":
        - cell "5300 · Cloud/Infrastructure"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "5400 · Marketing & Ads expense $0.00 $0.00":
        - cell "5400 · Marketing & Ads"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "5500 · Professional Services expense $0.00 $0.00":
        - cell "5500 · Professional Services"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "5600 · Payment Processing Fees expense $4,044.04 $0.00":
        - cell "5600 · Payment Processing Fees"
        - cell "expense"
        - cell "$4,044.04"
        - cell "$0.00"
      - row "5700 · Insurance expense $0.00 $0.00":
        - cell "5700 · Insurance"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "5800 · Meals expense $0.00 $0.00":
        - cell "5800 · Meals"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "5900 · Travel expense $0.00 $0.00":
        - cell "5900 · Travel"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "6000 · Office & Supplies expense $0.00 $0.00":
        - cell "6000 · Office & Supplies"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "6100 · Utilities expense $0.00 $0.00":
        - cell "6100 · Utilities"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "6200 · Bank Fees expense $0.00 $0.00":
        - cell "6200 · Bank Fees"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "6300 · Taxes & Licenses expense $0.00 $0.00":
        - cell "6300 · Taxes & Licenses"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "6900 · Uncategorized Expense expense $0.00 $0.00":
        - cell "6900 · Uncategorized Expense"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
      - row "6999 · Other Expense expense $0.00 $0.00":
        - cell "6999 · Other Expense"
        - cell "expense"
        - cell "$0.00"
        - cell "$0.00"
  - heading "General Ledger" [level=3]
  - text: M3 manual JE 1781184605941 2026-06-30 · manual 1000 · Cash on Hand $123.45 $0.00 3000 · Owner's Equity $0.00 $123.45 M3 manual JE 1781179983485 2026-06-30 · manual 1000 · Cash on Hand $123.45 $0.00 3000 · Owner's Equity $0.00 $123.45 M3 manual JE 1781178811979 2026-06-30 · manual 1000 · Cash on Hand $123.45 $0.00 3000 · Owner's Equity $0.00 $123.45 M3 manual JE 1781177054279 2026-06-30 · manual 1000 · Cash on Hand $123.45 $0.00 3000 · Owner's Equity $0.00 $123.45 M3 manual JE 1781176614606 2026-06-30 · manual 1000 · Cash on Hand $123.45 $0.00 3000 · Owner's Equity $0.00 $123.45 M3 manual JE 1781175081184 2026-06-30 · manual 1000 · Cash on Hand $123.45 $0.00 3000 · Owner's Equity $0.00 $123.45 M3 manual JE 1781174957957 2026-06-30 · manual 1000 · Cash on Hand $123.45 $0.00 3000 · Owner's Equity $0.00 $123.45 Northstar Studio Stripe processing fee 2026-06-11 · stripe 5600 · Payment Processing Fees $5.52 $0.00 1150 · Stripe Clearing $0.00 $5.52 Northstar Studio Stripe payment gross 2026-06-11 · stripe 1150 · Stripe Clearing $180.00 $0.00 4000 · Sales $0.00 $180.00 Juniper Health Stripe processing fee 2026-06-11 · stripe 5600 · Payment Processing Fees $7.64 $0.00 1150 · Stripe Clearing $0.00 $7.64 Juniper Health Stripe payment gross 2026-06-11 · stripe 1150 · Stripe Clearing $253.00 $0.00 4000 · Sales $0.00 $253.00 Atlas Advisory Stripe processing fee 2026-06-11 · stripe 5600 · Payment Processing Fees $9.75 $0.00 1150 · Stripe Clearing $0.00 $9.75 Atlas Advisory Stripe payment gross 2026-06-11 · stripe 1150 · Stripe Clearing $326.00 $0.00 4000 · Sales $0.00 $326.00 Brightline Dental Stripe processing fee 2026-06-11 · stripe 5600 · Payment Processing Fees $11.87 $0.00 1150 · Stripe Clearing $0.00 $11.87 Brightline Dental Stripe payment gross 2026-06-11 · stripe 1150 · Stripe Clearing $399.00 $0.00 4000 · Sales $0.00 $399.00 Foundry Labs Stripe processing fee 2026-06-11 · stripe 5600 · Payment Processing Fees $13.99 $0.00 1150 · Stripe Clearing $0.00 $13.99 Foundry Labs Stripe payment gross 2026-06-11 · stripe 1150 · Stripe Clearing $472.00 $0.00 4000 · Sales $0.00 $472.00 Cedar Market Stripe processing fee 2026-06-11 · stripe 5600 · Payment Processing Fees $16.11 $0.00 1150 · Stripe Clearing $0.00 $16.11 Cedar Market Stripe payment gross 2026-06-11 · stripe 1150 · Stripe Clearing $545.00 $0.00 4000 · Sales $0.00 $545.00 Pioneer Legal Stripe processing fee 2026-06-11 · stripe 5600 · Payment Processing Fees $18.22 $0.00 1150 · Stripe Clearing $0.00 $18.22 Pioneer Legal Stripe payment gross 2026-06-11 · stripe 1150 · Stripe Clearing $618.00 $0.00 4000 · Sales $0.00 $618.00 Signal Works Stripe processing fee 2026-06-11 · stripe 5600 · Payment Processing Fees $20.34 $0.00 1150 · Stripe Clearing $0.00 $20.34 Signal Works Stripe payment gross 2026-06-11 · stripe 1150 · Stripe Clearing $691.00 $0.00 4000 · Sales $0.00 $691.00 Riverbend Clinic Stripe processing fee 2026-06-11 · stripe 5600 · Payment Processing Fees $22.46 $0.00 1150 · Stripe Clearing $0.00 $22.46 Riverbend Clinic Stripe payment gross 2026-06-11 · stripe 1150 · Stripe Clearing $764.00 $0.00 4000 · Sales $0.00 $764.00
  - heading "Remaining settings" [level=2]
  - paragraph: Businesses, rules, and audit log are the trust/control surfaces that M8, M9, and M10 will depend on.
  - heading "Connections" [level=2]
  - paragraph: Sandbox services attach to the Live Sandbox entity so test payments and bank imports never pollute the demo books.
  - text: Stripe test mode
  - paragraph: Configured from environment. Stripe payments move through a clearing account first; payouts prove gross revenue minus fees before the bank deposit is matched.
  - button "Validate"
  - button "Seed test data"
  - button "Sync now"
  - text: Environment key Test secret key configured Test mode only
  - paragraph: "The browser never receives the key value. Convex actions read only `STRIPE_SECRET_KEY`."
  - text: Linked entity Live Sandbox
  - paragraph: USD books · live sandbox
  - text: Clearing account 1150 Stripe Clearing
  - paragraph: Gross charges debit clearing, fees credit clearing, and payouts credit clearing to zero drift.
  - text: Workspace access
  - paragraph: Current user can read this entity.
  - text: Entity
  - paragraph: Live Sandbox is selected.
  - text: Stripe test key
  - paragraph: Stripe test-mode key is present in the Convex environment.
  - text: Stripe clearing account
  - paragraph: 1150 Stripe Clearing exists.
  - text: Payout fixtures
  - paragraph: Fixture payout reconciliation remains available when Stripe test payouts are absent.
  - text: Payout reconciliation Recorded Stripe payouts are shown first. Fixture line details remain visible for drill-down until payout child rows are added.
  - group: po_1S0uXNGzLxUQ7bIMJe4GpGCY 2025-08-28 · recorded Gross $300.00 Fees $9.00 Deposit $291.00 $0 drift
  - group: po_1RqlGgGzLxUQ7bIMIuNMsRSG 2025-07-31 · recorded Gross $300.00 Fees $9.00 Deposit $291.00 $0 drift
  - group: po_1RfWS5GzLxUQ7bIM3QeFyYNc 2025-06-30 · recorded Gross $600.00 Fees $18.00 Deposit $582.00 $0 drift
  - group: po_1Rf9wTGzLxUQ7bIMUejNacAD 2025-06-30 · recorded Gross $1,405.00 Fees $41.35 Deposit $1,349.63 Drift
  - group: po_1RXXjuGzLxUQ7bIMvP7YA0RW 2025-06-09 · recorded Gross $300.00 Fees $9.00 Deposit $286.10 Drift
  - group: po_1RVjIpGzLxUQ7bIM1S7Xyppt 2025-06-03 · recorded Gross $400.00 Fees $12.20 Deposit $387.80 $0 drift
  - group: po_1RTuqBGzLxUQ7bIM3TH8D30I 2025-05-29 · recorded Gross $200.00 Fees $6.10 Deposit $177.10 Drift
  - group: po_1RTYUjGzLxUQ7bIMCFLGfthe 2025-05-28 · recorded Gross $2,250.00 Fees $70.05 Deposit $2,179.60 Drift
  - group: po_1RQee8GzLxUQ7bIMC1EtdqKo 2025-05-20 · recorded Gross $735.00 Fees $24.62 Deposit $710.22 Drift
  - group: po_1RQIAZGzLxUQ7bIMQkcdBWDA 2025-05-19 · recorded Gross $10.00 Fees $0.59 Deposit $4.37 Drift
  - text: Send via Stripe Customer
  - textbox "Customer": Northstar Studio
  - text: Email
  - textbox "Email": billing+northstar@example.com
  - text: Memo
  - textbox "Memo": OpenBooks setup services
  - text: Amount
  - textbox "Amount": "1200.00"
  - button "Send via Stripe"
  - text: Integration notes for the main thread
  - list:
    - listitem: "- Schema needs Stripe-native IDs on contacts and invoices for production-grade dedupe."
    - listitem: "- Webhook registration belongs in convex/http.ts or a new HTTP route outside this worker scope."
    - listitem: "- Settings must pass the shared Live Sandbox entity once the main thread wires the panel."
    - listitem: "- Checklist passes: 5 of 5"
  - text: Bank connection Plaid sandbox imports bank and card activity, then stages each item through the OpenBooks categorization pipeline. Sandbox ready Environment
  - paragraph: Plaid sandbox keys are configured
  - text: Link launch
  - paragraph: fixture token prepared
  - text: Pipeline sync
  - paragraph: Fixture sync sends Plaid-shaped transactions to stages 1-3.
  - button "Prepare Link"
  - button "Use sandbox bypass"
  - button "Simulate relink"
  - text: Account selection
  - paragraph: Included accounts get ledger accounts and bank-account records.
  - button "Create selected"
  - checkbox "Plaid Sandbox Checking checking ending 0000 $4,250.00" [checked]
  - text: Plaid Sandbox Checking checking ending 0000 $4,250.00
  - checkbox "Plaid Sandbox Credit Card credit card ending 1111 -$87.90" [checked]
  - text: Plaid Sandbox Credit Card credit card ending 1111 -$87.90 Transactions sync fixture
  - paragraph: Uses Plaid-shaped added transactions with personal finance category priors.
  - button "Sync fixture"
  - text: Plaid Sandbox Checking checking ending 0000 $4,250.00 Plaid Sandbox Credit Card credit ending 1111 -$87.90 Plaid Sandbox Bank needs you to sign in again. Relink item fixture-item-login-required in update mode. Synced 3; posted 0; inbox 0; duplicates 3; Plaid priors 3. AI
  - paragraph: Provider status, model display, and autonomy settings for the M10 AI layer.
  - text: Bedrock active Status Bedrock provider is configured
  - paragraph: OpenBooks can use Bedrock-backed categorization when pipeline actions request model proposals.
  - text: Provider bedrock
  - paragraph: Bedrock is the v1 target when env is present.
  - text: Chat model moonshotai.kimi-k2.5
  - paragraph: Loaded from AI_MODEL after backend provider wiring.
  - text: Embeddings amazon.titan-embed-text-v2:0
  - paragraph: Loaded from AI_EMBEDDINGS_MODEL for memory search.
  - text: Autonomy
  - radio "Suggest everything Never auto-post AI can explain and draft, but every bookkeeping change waits for owner approval."
  - text: Suggest everything Never auto-post AI can explain and draft, but every bookkeeping change waits for owner approval.
  - radio "Balanced Auto-post at 90% High-confidence classifications can post; uncertain items still go to the Inbox." [checked]
  - text: Balanced Auto-post at 90% High-confidence classifications can post; uncertain items still go to the Inbox.
  - radio "Autopilot Auto-post at 75% More work is automated, with lower-confidence decisions summarized for review."
  - text: Autopilot Auto-post at 75% More work is automated, with lower-confidence decisions summarized for review. Connection test
  - paragraph: This does not print keys. It only reports whether the server-side provider is available.
  - button "Test AI connection"
  - text: Businesses
  - button "Refresh Live Sandbox"
  - text: Live Sandbox refreshed; 0 missing chart accounts added. Acme Studio LLC services · USD Demo
  - button "Archive" [disabled]
  - paragraph: The current entity schema does not include an archived flag.
  - text: Live Sandbox services · USD Live
  - button "Archive" [disabled]
  - paragraph: The current entity schema does not include an archived flag.
  - text: Live Sandbox is ready for sandbox Stripe and Plaid data. Rules manager
  - button "New rule"
  - text: AI-suggested rule slot
  - paragraph: M10 will place drafted rules here after repeated corrections.
  - text: 1 Rent If merchant contains "Maple Yard" and money out -> Rent, auto-post 12 hits
  - button "Edit"
  - text: 2 Cloud infrastructure If description contains "AWS" and money out -> Cloud/Infrastructure, auto-post 34 hits
  - button "Edit"
  - text: 3 Marketing ads If merchant contains "Ads" and money out -> Marketing & Ads, auto-post 96 hits
  - button "Edit"
  - text: 4 Software subscriptions If description contains "subscription" and money out -> Software & SaaS, auto-post 86 hits
  - button "Edit"
  - text: 5 Bank fees If merchant contains "Mercury Bank Fee" and money out -> Bank Fees, auto-post 12 hits
  - button "Edit"
  - text: 6 Stripe fees If merchant contains "Stripe Fees" and money out -> Payment Processing Fees, auto-post 12 hits
  - button "Edit"
  - text: Audit log
  - paragraph: Filterable when, actor, action, and before-after table.
  - textbox "Filter audit log"
  - table:
    - rowgroup:
      - row "When Actor Action Before and after":
        - columnheader "When"
        - columnheader "Actor"
        - columnheader "Action"
        - columnheader "Before and after"
    - rowgroup:
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Bright Path Therapy - seeded category (47100 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Bright Path Therapy - seeded category (47100 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Bright Path Therapy - seeded category (136400 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Bright Path Therapy - seeded category (136400 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Cedar Works - seeded category (18500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Cedar Works - seeded category (18500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Northstar Dental - seeded category (70800 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Northstar Dental - seeded category (70800 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Riverbend Fitness - seeded category (18200 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Riverbend Fitness - seeded category (18200 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: OpenAI - seeded category (51700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: OpenAI - seeded category (51700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Lyft - seeded category (21600 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Lyft - seeded category (21600 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Delta Air Lines - seeded category (61300 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Delta Air Lines - seeded category (61300 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Figma - seeded category (27300 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Figma - seeded category (27300 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Staples - seeded category (3600 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Staples - seeded category (3600 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: OpenAI - seeded category (71900 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: OpenAI - seeded category (71900 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: The Lunch Room - seeded category (39500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: The Lunch Room - seeded category (39500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Linear - seeded category (50800 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Linear - seeded category (50800 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: OpenAI - seeded category (58300 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: OpenAI - seeded category (58300 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Notion - seeded category (34800 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Notion - seeded category (34800 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Notion - seeded category (44300 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Notion - seeded category (44300 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Figma - seeded category (4500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Figma - seeded category (4500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Figma - seeded category (50400 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Figma - seeded category (50400 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Linear - seeded category (3400 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Linear - seeded category (3400 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Delta Air Lines - seeded category (32200 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Delta Air Lines - seeded category (32200 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Figma - seeded category (50800 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Figma - seeded category (50800 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Linear - seeded category (9000 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Linear - seeded category (9000 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Lyft - seeded category (70000 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Lyft - seeded category (70000 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: OpenAI - seeded category (33700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: OpenAI - seeded category (33700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Google Ads - rule: Marketing ads (13500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Google Ads - rule: Marketing ads (13500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Meta Ads - rule: Marketing ads (27600 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Meta Ads - rule: Marketing ads (27600 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: LinkedIn Ads - rule: Marketing ads (26100 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: LinkedIn Ads - rule: Marketing ads (26100 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: LinkedIn Ads - rule: Marketing ads (12100 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: LinkedIn Ads - rule: Marketing ads (12100 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Google Ads - rule: Marketing ads (20600 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Google Ads - rule: Marketing ads (20600 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: LinkedIn Ads - rule: Marketing ads (15600 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: LinkedIn Ads - rule: Marketing ads (15600 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: LinkedIn Ads - rule: Marketing ads (87900 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: LinkedIn Ads - rule: Marketing ads (87900 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: LinkedIn Ads - rule: Marketing ads (46500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: LinkedIn Ads - rule: Marketing ads (46500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Vercel - rule: Software subscriptions (63400 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Vercel - rule: Software subscriptions (63400 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Supabase - rule: Software subscriptions (7000 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Supabase - rule: Software subscriptions (7000 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Google Workspace - rule: Software subscriptions (17700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Google Workspace - rule: Software subscriptions (17700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: AWS - rule: Cloud infrastructure (84700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: AWS - rule: Cloud infrastructure (84700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: AWS - rule: Cloud infrastructure (48300 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: AWS - rule: Cloud infrastructure (48300 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Google Workspace - rule: Software subscriptions (94800 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Google Workspace - rule: Software subscriptions (94800 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: AWS - rule: Cloud infrastructure (54500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: AWS - rule: Cloud infrastructure (54500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Google Workspace - rule: Software subscriptions (5600 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Google Workspace - rule: Software subscriptions (5600 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: AWS - rule: Cloud infrastructure (29100 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: AWS - rule: Cloud infrastructure (29100 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Google Workspace - rule: Software subscriptions (20700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Google Workspace - rule: Software subscriptions (20700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Visa Card Payment - transfer (240000 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Visa Card Payment - transfer (240000 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Operating Transfer - transfer (50000 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Operating Transfer - transfer (50000 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Mercury Bank Fee - rule: Bank fees (3500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Mercury Bank Fee - rule: Bank fees (3500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: TXU Energy - seeded category (20000 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: TXU Energy - seeded category (20000 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Maple Yard Studios - rule: Rent (280000 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Maple Yard Studios - rule: Rent (280000 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Northstar Dental - seeded category (245700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Northstar Dental - seeded category (245700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Riverbend Fitness - seeded category (225800 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Riverbend Fitness - seeded category (225800 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Summit Legal - seeded category (302100 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Summit Legal - seeded category (302100 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Bright Path Therapy - seeded category (162500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Bright Path Therapy - seeded category (162500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Bright Path Therapy - seeded category (108300 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Bright Path Therapy - seeded category (108300 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Northstar Dental - seeded category (294300 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Northstar Dental - seeded category (294300 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Atlas Advisory - seeded category (163600 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Atlas Advisory - seeded category (163600 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Riverbend Fitness - seeded category (150300 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Riverbend Fitness - seeded category (150300 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Riverbend Fitness - seeded category (287600 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Riverbend Fitness - seeded category (287600 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Summit Legal - seeded category (312700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Summit Legal - seeded category (312700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Atlas Advisory - seeded category (277700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Atlas Advisory - seeded category (277700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Juniper Labs - seeded category (159500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Juniper Labs - seeded category (159500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Northstar Dental - seeded category (242200 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Northstar Dental - seeded category (242200 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Juniper Labs - seeded category (339500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Juniper Labs - seeded category (339500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Invoice OB-1000 - matched record (180000 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Invoice OB-1000 - matched record (180000 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Stripe Payout - transfer (1070260 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Stripe Payout - transfer (1070260 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Stripe Fees - rule: Stripe fees (34240 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Stripe Fees - rule: Stripe fees (34240 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Riverbend Fitness - seeded category (102300 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Riverbend Fitness - seeded category (102300 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Riverbend Fitness - seeded category (13900 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Riverbend Fitness - seeded category (13900 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Cedar Works - seeded category (35200 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Cedar Works - seeded category (35200 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Cedar Works - seeded category (27700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Cedar Works - seeded category (27700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Riverbend Fitness - seeded category (176400 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Riverbend Fitness - seeded category (176400 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Bright Path Therapy - seeded category (101200 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Bright Path Therapy - seeded category (101200 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Juniper Labs - seeded category (67500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Juniper Labs - seeded category (67500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Northstar Dental - seeded category (15200 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Northstar Dental - seeded category (15200 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Cedar Works - seeded category (166700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Cedar Works - seeded category (166700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Pine Street Coffee - seeded category (68700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Pine Street Coffee - seeded category (68700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Cedar Works - seeded category (54500 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Cedar Works - seeded category (54500 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Cedar Works - seeded category (129700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Cedar Works - seeded category (129700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Northstar Dental - seeded category (36900 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Northstar Dental - seeded category (36900 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Bright Path Therapy - seeded category (76700 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Bright Path Therapy - seeded category (76700 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Atlas Advisory - seeded category (31900 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Atlas Advisory - seeded category (31900 USD)"'
      - 'row "6/11/2026 user ledger.entry.posted Before: previous recorded state. After: Lyft - seeded category (48000 USD)"':
        - cell "6/11/2026"
        - cell "user"
        - cell "ledger.entry.posted"
        - 'cell "Before: previous recorded state. After: Lyft - seeded category (48000 USD)"'
  - heading "Request-access leads" [level=2]
  - paragraph: Captured from the invite-only landing page.
  - text: m1-evidence@example.com M1 Evidence · Acme Studio LLC M1 request-access storage proof 6/11/2026 pending lead-1781161661855@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781161705165@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781161732095@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781162709940@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781162828810@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781162896733@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781163005263@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781164706456@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781164736891@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781164763939@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781166293524@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781167509540@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781169025862@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781169164911@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781171023448@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781171198701@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781171321396@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781171744856@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781172078669@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781172205072@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781172386658@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781174583420@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781174994508@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781176530396@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781176975472@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781178731285@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781179797927@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending lead-1781184420880@example.com M2 Lead · Access Review LLC Invite-only intake evidence. 6/11/2026 pending
- complementary:
  - text: Ask AI Bedrock active
  - button "Close Ask AI"
  - text: Bedrock provider is configured
  - paragraph: OpenBooks can use Bedrock-backed categorization when pipeline actions request model proposals.
  - text: "Context: Settings Ask a read-only question about reports, transactions, balances, contacts, or payroll. Write-like requests become confirmation cards."
  - button "How did we do last month vs. before?"
  - button "Top 5 expenses this quarter?"
  - button "Who owes me money right now?"
  - button "How much did Stripe take in fees this year?"
  - button "What's my monthly payroll cost in USD?"
  - textbox "Ask about your books"
  - button "Send question"
- alert
```

# Test source

```ts
  16  | }
  17  |
  18  | function readLocalEnv(names: string[]) {
  19  |   const env: Record<string, string> = {};
  20  |   const text = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  21  |   for (const line of text.split(/\r?\n/)) {
  22  |     const trimmed = line.trim();
  23  |     if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
  24  |     const index = trimmed.indexOf("=");
  25  |     const name = trimmed.slice(0, index).trim();
  26  |     if (!names.includes(name)) continue;
  27  |     env[name] = trimmed
  28  |       .slice(index + 1)
  29  |       .trim()
  30  |       .replace(/\s+#.*$/, "")
  31  |       .replace(/^['"]|['"]$/g, "");
  32  |   }
  33  |   return env;
  34  | }
  35  |
  36  | async function signInOwner(page: Page) {
  37  |   const env = readLocalEnv(["OWNER_EMAIL", "OWNER_PASSWORD"]);
  38  |   test.skip(!env.OWNER_EMAIL || !env.OWNER_PASSWORD, "OWNER_EMAIL/OWNER_PASSWORD missing locally");
  39  |
  40  |   await page.goto("/sign-in");
  41  |   await page.getByLabel("Work email").fill(env.OWNER_EMAIL);
  42  |   await page.getByLabel("Password").fill(env.OWNER_PASSWORD);
  43  |   await page.getByLabel("Name").fill("Ansar Ullah");
  44  |   await page.getByRole("button", { name: /Sign in/ }).click();
  45  |   await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
  46  |     timeout: 15000,
  47  |   });
  48  | }
  49  |
  50  | async function ensureLiveSandbox(page: Page) {
  51  |   await page.goto("/settings");
  52  |   await expect(page.getByTestId("live-sandbox-create")).toBeVisible({ timeout: 15000 });
  53  |   await page.getByTestId("live-sandbox-create").click();
  54  |   await expect(page.getByTestId("business-card-live-sandbox")).toContainText("Live Sandbox", {
  55  |     timeout: 120000,
  56  |   });
  57  | }
  58  |
  59  | test("Plaid fixture mode has sandbox-safe transaction coverage", async () => {
  60  |   const missingEnv: PlaidEnvState = {
  61  |     environment: "missing",
  62  |     hasClientId: false,
  63  |     hasSecret: false,
  64  |     ready: false,
  65  |     problems: ["PLAID_CLIENT_ID is missing.", "PLAID_SECRET is missing.", "PLAID_ENV must be sandbox."],
  66  |   };
  67  |
  68  |   expect(plaidModeTone(missingEnv)).toBe("fixture");
  69  |   expect(plaidEnvLabel(missingEnv)).toBe("Plaid sandbox keys are missing");
  70  |   expect(openBooksPlaidFixtureTransactions).toHaveLength(3);
  71  |   expect(openBooksPlaidFixtureTransactions.some((transaction) => transaction.amount > 0)).toBe(true);
  72  |   expect(openBooksPlaidFixtureTransactions.some((transaction) => transaction.amount < 0)).toBe(true);
  73  |   expect(openBooksPlaidFixtureTransactions.every((transaction) => transaction.personal_finance_category)).toBe(true);
  74  |
  75  |   writeEvidence("2026-06-11-m9-plaid-fixture-mode.json", {
  76  |     mode: "fixture",
  77  |     transactionCount: openBooksPlaidFixtureTransactions.length,
  78  |     coversInflow: openBooksPlaidFixtureTransactions.some((transaction) => transaction.amount < 0),
  79  |     coversOutflow: openBooksPlaidFixtureTransactions.some((transaction) => transaction.amount > 0),
  80  |     capturesPersonalFinanceCategory: openBooksPlaidFixtureTransactions.every(
  81  |       (transaction) => transaction.personal_finance_category,
  82  |     ),
  83  |   });
  84  | });
  85  |
  86  | test("owner can connect Plaid sandbox bypass, select accounts, sync, and simulate relink", async ({ page }) => {
  87  |   test.setTimeout(300_000);
  88  |
  89  |   await signInOwner(page);
  90  |   await ensureLiveSandbox(page);
  91  |
  92  |   const panel = page.getByTestId("plaid-connection-panel");
  93  |   await expect(panel).toBeVisible({ timeout: 15000 });
  94  |   await expect(panel.getByText("Bank connection")).toBeVisible();
  95  |   await expect(panel.getByRole("button", { name: /Prepare Link/ })).toBeVisible();
  96  |
  97  |   await panel.getByRole("button", { name: /Prepare Link/ }).click();
  98  |   await expect(page.getByTestId("plaid-panel-message")).toContainText(/Link token|Fixture Link token/i, {
  99  |     timeout: 30000,
  100 |   });
  101 |
  102 |   await panel.getByRole("button", { name: /Use sandbox bypass/ }).click();
  103 |   await expect(page.getByTestId("plaid-account-selection")).toBeVisible({ timeout: 120000 });
  104 |   await expect(page.getByTestId("plaid-account-selection").getByText(/ending/i).first()).toBeVisible();
  105 |
  106 |   await panel.getByRole("button", { name: /Create selected/ }).click();
  107 |   await expect(page.getByTestId("plaid-panel-message")).toContainText(/Plaid account|refreshed account selection/i, {
  108 |     timeout: 30000,
  109 |   });
  110 |   await expect(page.getByTestId("plaid-connected-accounts")).toBeVisible({ timeout: 30000 });
  111 |
  112 |   await panel.getByRole("button", { name: /Sync fixture/ }).click();
  113 |   await expect(page.getByTestId("plaid-panel-message")).toContainText(/Synced|duplicates/i, {
  114 |     timeout: 120000,
  115 |   });
> 116 |   await expect(page.getByTestId("plaid-recent-transactions")).toContainText(/Notion|Client ACH|Plaid Sandbox Bank/i, {
      |                                                               ^ Error: expect(locator).toContainText(expected) failed
  117 |     timeout: 30000,
  118 |   });
  119 |   await expect(page.getByTestId("plaid-recent-transactions")).toContainText("Plaid prior");
  120 |
  121 |   await panel.getByRole("button", { name: /Simulate relink/ }).click();
  122 |   await expect(page.getByTestId("plaid-connection-issues")).toContainText(/needs you to sign in again/i, {
  123 |     timeout: 30000,
  124 |   });
  125 |
  126 |   await page.screenshot({
  127 |     path: "docs/initiation/evidence/2026-06-11-m9-plaid-settings-e2e.png",
  128 |     fullPage: true,
  129 |   });
  130 | });
  131 |
```