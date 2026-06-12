# H2 Acceptance Evidence Index

Date: 2026-06-12  
Status: PARTIAL, honesty-first index. This file maps the 18 initiation
acceptance rows to the current finishing-branch evidence. It is not a claim that
H2 is fully done: rows with external dependencies or missing real-click
coverage stay PARTIAL/BLOCKED.

| Row | Acceptance area | Current status | Evidence | Remaining gap |
|---|---|---|---|---|
| 1 | Landing / access | WORKING | `tests/e2e/landing.spec.ts`, `docs/finishing/evidence/2026-06-12-H2-landing-page.png`, `docs/finishing/evidence/2026-06-12-H2-dev-auth-dashboard-access.png` | Current finishing evidence proves the public landing surface and the local dev-auth owner dashboard access path. Production/password login remains row #3's caveat. |
| 2 | No public sign-up | SUPERSEDED | `docs/finishing/evidence/2026-06-12-F1-onboarding-dashboard-checklist.png` | Product changed: open-source first-run owner onboarding is now intentional. |
| 3 | Owner login | WORKING | Dev-auth harness green across current e2e; F1 no-bypass signup proof in `tests/e2e/onboarding.spec.ts`. | Production/password login is not re-proven in this no-deploy run. |
| 4 | Dashboard | WORKING | `docs/finishing/evidence/2026-06-11-D5-dashboard.png`, `docs/finishing/evidence/2026-06-12-H1-core-dashboard-disposable.png`, `docs/finishing/evidence/2026-06-12-H2-mobile-dashboard.png`, `docs/finishing/evidence/2026-06-12-H4-performance-limits.json` | Broader final pass should still cross-check row links, but dashboard behavior has current desktop + mobile evidence. |
| 5 | Inbox | PARTIAL | `docs/finishing/evidence/2026-06-12-B6-csv-ai-batch-history.png`, `docs/finishing/evidence/2026-06-12-G4-receipts-pdf-image-chip.png`, `docs/finishing/evidence/2026-06-12-H2-mobile-inbox.png` | General confirm/correct/rule/batch/keyboard flow still needs a disposable-business real-click acceptance spec. |
| 6 | Transactions | WORKING | `docs/finishing/evidence/2026-06-12-H1-core-register-real-clicks.png`, `docs/finishing/evidence/2026-06-12-H2-mobile-transactions.png` | H2 should still add filter/search/account/category screenshots if the final acceptance pack wants those as separate assertions. |
| 7 | Invoices & Bills | WORKING | `docs/finishing/evidence/2026-06-12-C1-income-invoices.png`, `docs/finishing/evidence/2026-06-12-C2-composer.png`, `docs/finishing/evidence/2026-06-12-C5-bill-match-picker.png`, `docs/finishing/evidence/2026-06-12-G4-create-expense-receipt.png` | Stripe-hosted invoice proof remains external-test-mode dependent. |
| 8 | Contacts | WORKING | `tests/e2e/acceptance-h2-pack.spec.ts`, `docs/finishing/evidence/2026-06-12-H2-contacts-profile.png` | Refreshed finishing evidence selects a directory row and asserts the matching profile, default-category rule, and merge affordance. |
| 9 | Payroll | WORKING | `docs/finishing/evidence/2026-06-11-D4-payroll-run-detail.png` | CSV/print export equality remains a later acceptance enhancement. |
| 10 | Reports | WORKING/PARTIAL | `docs/finishing/evidence/2026-06-11-D1-reports-home.png`, `docs/finishing/evidence/2026-06-11-D2-pnl-viewer.png`, `docs/finishing/evidence/2026-06-11-D3-monthly-review.png`, `docs/finishing/evidence/2026-06-12-H4-performance-limits.json` | CSV export equals screen is not automated yet. |
| 11 | Data export | WORKING | `tests/e2e/acceptance-h2-pack.spec.ts`, `docs/finishing/evidence/2026-06-12-H2-data-export.png` | JSON dump download is proven by a real browser `download` event. CSV bundle/export-equals-screen belongs with row #10's report-export equality gap. |
| 12 | Plaid sandbox | PARTIAL/BLOCKED | `docs/finishing/evidence/2026-06-12-G1-plaid-link-surface.png`, `docs/finishing/evidence/2026-06-12-G2-plaid-sync-controls.png` | Needs completed hosted Plaid sandbox Link session and real item sync proof. |
| 13 | Stripe test | PARTIAL/BLOCKED | `docs/finishing/evidence/2026-06-12-G3-stripe-payout-lines.png` | Needs real Stripe CLI/Dashboard test webhook delivered to the cloud route. |
| 14 | Ask AI | WORKING/PARTIAL | `docs/finishing/evidence/2026-06-12-B4-markdown-thread.png`, `docs/finishing/evidence/2026-06-12-B4-confirmation-card.png`, `docs/finishing/evidence/2026-06-12-B5-docked-desktop.png`, `docs/finishing/evidence/2026-06-12-H2-mobile-ask-ai.png`, `docs/finishing/evidence/2026-06-12-H3-ai-eval-settings.png` | Five-question report-answer parity and real-Bedrock import high/low split remain open proof. |
| 15 | Receipts | WORKING/PARTIAL | `docs/finishing/evidence/2026-06-12-G4-receipts-pdf-image-chip.png`, `docs/finishing/evidence/2026-06-12-G4-create-expense-receipt.png` | True first-page PDF raster-to-Bedrock vision remains a named G4 gap. |
| 16 | Mobile | WORKING | `tests/e2e/acceptance-h2-pack.spec.ts`, `docs/finishing/evidence/2026-06-12-H2-mobile-dashboard.png`, `docs/finishing/evidence/2026-06-12-H2-mobile-inbox.png`, `docs/finishing/evidence/2026-06-12-H2-mobile-transactions.png`, `docs/finishing/evidence/2026-06-12-H2-mobile-ask-ai.png` | The required H2 390px pass covers Dashboard, Inbox, Transactions, and Ask AI with no horizontal scroll. Broader module-by-module mobile review is a later hardening item. |
| 17 | Audit log | WORKING | `tests/e2e/audit-h2.spec.ts`, `docs/finishing/evidence/2026-06-12-E5-audit-filter.png`, `docs/finishing/evidence/2026-06-12-H2-audit-posting-trace.png` | Disposable-business posting proof filters the audit log by the unique merchant and shows the user-visible posting summary. |
| 18 | Honesty check | WORKING/PARTIAL | `docs/finishing/completion-report.md`, `docs/finishing/whats-left.md`, this index. | Final H5 can close only after H2 screenshots and external Plaid/Stripe rows are resolved or explicitly left blocked. |

Summary: A-C are mostly working, but H2 is still PARTIAL because rows 5, 10,
12, 13, 14, 15, and 18 need either stronger finishing evidence, final
cross-checking, or external Plaid/Stripe inputs. Rows 8, 11, and 16 were upgraded
only after `tests/e2e/acceptance-h2-pack.spec.ts` passed with real clicks and
fresh screenshots; row 17 was upgraded after `tests/e2e/audit-h2.spec.ts`
proved a real posting action in the audit log; row 1 was upgraded after
`tests/e2e/landing.spec.ts` was refreshed away from the stale invite-only
assumption.
