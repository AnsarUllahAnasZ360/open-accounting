# H2 Acceptance Evidence Index

Date: 2026-06-12  
Status: PARTIAL, honesty-first index. This file maps the 18 initiation
acceptance rows to the current finishing-branch evidence. It is not a claim that
H2 is fully done: rows with external dependencies or missing real-click
coverage stay PARTIAL/BLOCKED.

| Row | Acceptance area | Current status | Evidence | Remaining gap |
|---|---|---|---|---|
| 1 | Landing / access | PARTIAL | `tests/e2e/landing.spec.ts`, `tests/e2e/auth.spec.ts` exist from initiation-era coverage. | Needs finishing evidence screenshot for current first-run/onboarding posture. |
| 2 | No public sign-up | SUPERSEDED | `docs/finishing/evidence/2026-06-12-F1-onboarding-dashboard-checklist.png` | Product changed: open-source first-run owner onboarding is now intentional. |
| 3 | Owner login | WORKING | Dev-auth harness green across current e2e; F1 no-bypass signup proof in `tests/e2e/onboarding.spec.ts`. | Production/password login is not re-proven in this no-deploy run. |
| 4 | Dashboard | WORKING | `docs/finishing/evidence/2026-06-11-D5-dashboard.png`, `docs/finishing/evidence/2026-06-12-H1-core-dashboard-disposable.png`, `docs/finishing/evidence/2026-06-12-H4-performance-limits.json` | Full H2 row screenshot pack still not generated in one pass. |
| 5 | Inbox | PARTIAL | `docs/finishing/evidence/2026-06-12-B6-csv-ai-batch-history.png`, `docs/finishing/evidence/2026-06-12-G4-receipts-pdf-image-chip.png` | General confirm/correct/rule/batch/keyboard flow still needs a disposable-business real-click acceptance spec. |
| 6 | Transactions | WORKING | `docs/finishing/evidence/2026-06-12-H1-core-register-real-clicks.png` | H2 should add filter/search/account/category screenshots. |
| 7 | Invoices & Bills | WORKING | `docs/finishing/evidence/2026-06-12-C1-income-invoices.png`, `docs/finishing/evidence/2026-06-12-C2-composer.png`, `docs/finishing/evidence/2026-06-12-C5-bill-match-picker.png`, `docs/finishing/evidence/2026-06-12-G4-create-expense-receipt.png` | Stripe-hosted invoice proof remains external-test-mode dependent. |
| 8 | Contacts | PARTIAL | Initiation evidence exists in `docs/initiation/evidence/2026-06-11-m6-contacts-e2e.png`. | Needs refreshed finishing screenshot and stronger contact-profile behavior assertion. |
| 9 | Payroll | WORKING | `docs/finishing/evidence/2026-06-11-D4-payroll-run-detail.png` | CSV/print export equality remains a later acceptance enhancement. |
| 10 | Reports | WORKING/PARTIAL | `docs/finishing/evidence/2026-06-11-D1-reports-home.png`, `docs/finishing/evidence/2026-06-11-D2-pnl-viewer.png`, `docs/finishing/evidence/2026-06-11-D3-monthly-review.png`, `docs/finishing/evidence/2026-06-12-H4-performance-limits.json` | CSV export equals screen is not automated yet. |
| 11 | Data export | PARTIAL | `docs/finishing/evidence/2026-06-12-E1-settings-sections.png` covers Settings navigation. | Needs export-bundle click/download proof. |
| 12 | Plaid sandbox | PARTIAL/BLOCKED | `docs/finishing/evidence/2026-06-12-G1-plaid-link-surface.png`, `docs/finishing/evidence/2026-06-12-G2-plaid-sync-controls.png` | Needs completed hosted Plaid sandbox Link session and real item sync proof. |
| 13 | Stripe test | PARTIAL/BLOCKED | `docs/finishing/evidence/2026-06-12-G3-stripe-payout-lines.png` | Needs real Stripe CLI/Dashboard test webhook delivered to the cloud route. |
| 14 | Ask AI | WORKING/PARTIAL | `docs/finishing/evidence/2026-06-12-B4-markdown-thread.png`, `docs/finishing/evidence/2026-06-12-B4-confirmation-card.png`, `docs/finishing/evidence/2026-06-12-B5-docked-desktop.png`, `docs/finishing/evidence/2026-06-12-H3-ai-eval-settings.png` | Five-question report-answer parity and real-Bedrock import high/low split remain open proof. |
| 15 | Receipts | WORKING/PARTIAL | `docs/finishing/evidence/2026-06-12-G4-receipts-pdf-image-chip.png`, `docs/finishing/evidence/2026-06-12-G4-create-expense-receipt.png` | True first-page PDF raster-to-Bedrock vision remains a named G4 gap. |
| 16 | Mobile | PARTIAL | `docs/finishing/evidence/2026-06-11-A1-mobile-shell.png`, `docs/finishing/evidence/2026-06-12-B5-mobile-sheet.png`, `docs/finishing/evidence/2026-06-12-H1-core-mobile-dashboard.png` | Needs one H2 pass for Dashboard, Inbox, Transactions, and Ask AI at 390px. |
| 17 | Audit log | WORKING | `docs/finishing/evidence/2026-06-12-E5-audit-filter.png` | H2 should cross-link an audit row to a specific posting action. |
| 18 | Honesty check | WORKING/PARTIAL | `docs/finishing/completion-report.md`, `docs/finishing/whats-left.md`, this index. | Final H5 can close only after H2 screenshots and external Plaid/Stripe rows are resolved or explicitly left blocked. |

Summary: A-C are mostly working, but H2 is still PARTIAL because rows 5, 8, 10,
11, 12, 13, 14, 15, and 16 need either stronger finishing evidence or external
Plaid/Stripe inputs. No row above is upgraded beyond the evidence named here.
