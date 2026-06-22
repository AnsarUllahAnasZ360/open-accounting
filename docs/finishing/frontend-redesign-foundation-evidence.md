# OpenBooks Frontend Redesign — Foundation Evidence Pack (Epics 0–2)

Date: 2026-06-13 · Status: **foundation complete, awaiting Ansar's approval before the page epics (3–6)**

This is the review checkpoint the plan calls for: the shared base everything else
rides on is built and proven. Below is what changed, the proof, the new building
blocks, the honest gaps, and what needs your decision before the page rewrites.

---

## 1. What the foundation does (in plain terms)

Before this work, every OpenBooks screen hand-rolled its own table, filters, detail
panel, and status chips, and the Ask AI assistant was a single 918-line custom
component leaking the AI vendor's name to owners. The foundation replaces that with:

1. **A design-token layer** so "use the negative/AI/green token" actually compiles
   (those tokens did not exist before — classes using them silently did nothing).
2. **One shared workbench toolkit** — 11 reusable building blocks (table, filters,
   date range, KPI strip, detail drawer, AI insight, evidence upload, export menu,
   status chips) that every page will assemble from instead of reinventing.
3. **A decluttered shell and a rebuilt Ask AI** — the assistant is now a single
   component with four modes (collapsed, docked, full-page, mobile), built on the
   industry-standard AI Elements library, with the vendor labels removed and the
   live streaming preserved exactly.

Net effect on the codebase: **−810 lines in existing files** (the 918-line hand-rolled
chat is gone), with the new toolkit and AI layer added as clean, isolated files.

---

## 2. Epic 0 — Baseline & defect map

**Goal:** freeze the "before" state and record every defect so later epics can be diffed against it.

- **55/55 baseline screenshots** captured across all 11 surfaces × the 5 gate widths
  (390 / 768 / 1306 / 1440 / 1758) → [`docs/finishing/evidence/baseline/`](evidence/baseline/),
  with [`2026-06-13-baseline-manifest.json`](evidence/baseline/2026-06-13-baseline-manifest.json).
- **Defect-to-epic map** → [`evidence/baseline/epic0-defect-map.md`](evidence/baseline/epic0-defect-map.md):
  a 6-agent read-only audit that **re-verified the redesign report's cited code
  anchors against the current code** — 146 / 151 still exactly accurate (the 5 "drifts"
  are 1-line shifts), so the report is safe to build against. It catalogues **132
  concrete defects tagged by owning epic** and **76 design-system token violations**
  (raw red/blue, off-palette purple/plum dots, unicode ▲▼→ glyphs, provider labels).
- **Shell-boot fix:** the app would not render in this sandbox (it hung on "Loading
  your workspace…" because the dev-owner session wasn't enabled). Resolved by adding
  the gitignored `NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS=1` frontend flag + a clean
  dev-server boot (the Convex deployment already had the backend bypass + owner). No
  secrets in git, no demo-data changes.

## 3. Epic 1 — Shared workbench toolkit (the keystone)

**Goal:** build the reusable interaction layer so page epics assemble from primitives instead of re-implementing tables.

- **Token layer** added to `globals.css` (additive only — existing surfaces look
  identical): `--negative` + `--negative-surface`, `--ai` + `--ai-surface`, surface
  tints for positive/warning/info, and an `--ob-green-50…900` ramp, all wired so
  Tailwind utilities (`text-negative`, `bg-ai-surface`, `bg-ob-green-50`…) resolve.
- **12 shadcn/ui primitives generated** (popover, calendar, checkbox, scroll-area,
  toggle-group, drawer, avatar, sonner, progress, collapsible, field, input-group).
- **11 workbench components + shared status vocabulary** built to Section 5 of the
  report, under `apps/web/src/components/openbooks/workbench/` (import from the barrel
  `@/components/openbooks/workbench`):

  | Component | What it is | Key behavior |
  |---|---|---|
  | `WorkbenchPage` | Standard page scaffold (eyebrow/title/actions/kpis slots) | One layout every surface shares |
  | `PageActionBar` | Right-aligned primary/secondary action cluster | Collapses to a ⋯ menu below `md` |
  | `DateRangeControl` | One canonical period control | Presets + custom range; future dates disabled; collapses on mobile |
  | `FilterBar` | Search + facet chips above any table | Facets collapse into a Filters popover on mobile |
  | `AccountMultiSelect` | Pick one/many accounts to scope a table | Searchable popover + checkboxes |
  | `KpiStrip` | The metric row | Money-in green, **overdue the only red**, lucide trend icons (no ▲▼) |
  | `OpenBooksDataTable` | The dense ledger table (generic, any row shape) | Sort, select, bulk toolbar, sticky header, **detail closed by default**, **mobile card-stack** (never a squeezed table) |
  | `DetailSheet` | The one slide-over | Side sheet on desktop, bottom drawer on mobile, closed by default |
  | `AiInsightBadge` | Quiet green AI affordance (confidence + "why") | Real popover, brand green Sparkles, never purple |
  | `EvidenceUpload` | Attach/extract a receipt or document | Callback-only; pages wire the mutation |
  | `ExportMenu` | CSV/PDF export affordance | Fires a toast on completion |
  | `AttentionState` | Shared status vocabulary | needs-review / missing-evidence / overdue / unmatched / unposted / low-confidence — one source of truth |

- **Verified:** typecheck + lint green (build + fix pass). A 3-lens adversarial
  critique (design-system / API-correctness / responsive) returned **PASS** on all
  three (10 low-severity polish notes only, no blocker/high).
- **Visual proof:** harness at `/dev/workbench` captured at 390/768/1306/1440 →
  [`evidence/epic1/`](evidence/epic1/). Confirmed design-system-true (one green,
  overdue-only red, tabular mono money, quiet green AI, no purple/gradient/emoji)
  **and** responsive — the table reflows to a real card stack on mobile.

## 4. Epic 2 — Shell, navigation & Ask AI

**Goal:** make the global chrome coherent and the assistant responsive, with no vendor/debug labels and the streaming intact.

- **Ask AI rebuilt** as one component, `AskAIWidget`, with **four modes** —
  collapsed (Sparkles trigger on the iconified rail), docked (a right-edge **overlay**
  with a scrim + resize handle, available from `md` up — fixes the old panel that
  stole width and crushed wide tables), full page (`/ask-ai`), and mobile (a bottom
  sheet with a **reachable thread switcher**, which the old chat hid on phones). Built
  on **AI Elements** (Conversation/Message/MessageResponse/PromptInput/Suggestion/Tool)
  over shadcn. The 918-line hand-rolled `OpenBooksAIChat.tsx` is **deleted**.
- **Streaming preserved verbatim:** the Convex Agent contract is untouched —
  `useUIMessages`/`useSmoothText`/`optimisticallySendMessage`/`api.aiThreads.*`/
  `api.proposals.*` all kept; only the view layer changed. The propose→confirm card
  still never auto-posts ("AI proposes, the ledger posts").
- **Vendor/debug labels removed:** all four enumerated user-facing "Bedrock" /
  "Degraded mode" / "Convex Agent" spots are gone; active state shows no badge,
  degraded shows one quiet "AI is off" chip. A grep confirms no user-facing provider
  label remains (the only "Amazon Bedrock" is the permitted technical field in Settings).
- **Shell decluttered:** removed the dead "Jun 2026" month chip and the body "Demo
  entity" chip + duplicated entity eyebrow; the wide search pill became a compact
  Search icon reachable at every width (the only ⌘K path on mobile); Ask AI is an
  icon-only green Sparkles button; **Settings moved out of the primary nav into a
  quiet footer cluster** beside Sync + Profile; a subtle demo dot sits by the
  workspace name. App-wide toasts mounted.
- **Visual proof:** 7 shots at the gate widths → [`evidence/epic2/`](evidence/epic2/),
  all judged PASS (no overflow/overlap, no provider label, on-brand green, docked
  overlay does not crush the table, mobile sheet usable).

---

## 5. Validation results

| Gate | Result |
|---|---|
| `pnpm typecheck` | ✅ green |
| `pnpm lint` | ✅ green |
| `pnpm test` (vitest unit) | ✅ **151 / 151 passing** |
| Epic 1 primitive critique (3 lenses) | ✅ PASS (10 low-severity notes) |
| Epic 2 critique (streaming / labels / responsive) | ✅ streaming PASS; design + responsive fixes applied, re-greened |
| Baseline screenshots (55) | ✅ captured |
| Epic 1 harness screenshots (4) | ✅ captured + judged |
| Epic 2 Ask AI mode screenshots (7) | ✅ captured + judged |

**One unit test was realigned, not broken:** `prototype-copy.test.ts` asserted the
old shell still contained "Jun 2026" and the wide search-pill copy. The redesign
intentionally removed both (Section 6.12), so the assertion was updated to the new
shell vocabulary with a comment — the report's risk R2 predicted this guard would
fight intentional changes.

## 6. Changed files

**Modified (existing):** `globals.css` (+tokens), `layout.tsx` (Toaster), `AppShell.tsx`
(287 lines reworked), `AppScreen.tsx`, `AskAIScreen.tsx`, `ModuleScreens.tsx` (label
removals), `lib/openbooks/ai.ts`, `apps/web/package.json`, root `package.json`
(React-types dedupe override). **Deleted:** `OpenBooksAIChat.tsx` (−918). **New:** 14
files in `components/openbooks/workbench/` + `AskAIWidget.tsx`, 9 in `components/ai-elements/`,
17 in `components/ui/`, the `/dev/workbench` harness, and the redesign test specs.

---

## 7. Risks & honest gaps (read before approving)

1. **Ask AI e2e specs target the old chat DOM.** `ask-ai-parity-h2.spec.ts` /
   `ai-chat.spec.ts` reference the deleted thread `<select>`, the removed "Bedrock"
   badge, and a markdown-table testid streamdown no longer emits. They currently
   **skip** (gated behind a live AI provider) rather than fail, so the unit/static
   gates are clean — but they need selector updates. The report assigns this e2e
   migration to **Epic 7**; I recommend folding it there (or a fast-follow).
2. **`app-shell.spec.ts` has 1 expected stale assertion** — it asserts "Settings"
   in the primary nav; we deliberately moved it to the footer. 3 of its tests pass;
   it aborts on that first mismatch. Same fix class as #1 (test alignment to the
   intentional new DOM), recommended for Epic 7.
3. **AI Elements pulled a few transitive deps** (streamdown's CJK/code/math/mermaid
   plugins, a markdown/mermaid renderer a bookkeeping chat doesn't strictly need).
   It typechecks and is tree-shaken, but the chat bundle grew. We can prune the
   unused renderers if you want a leaner bundle.
4. **Two e2e spec follow-ups were spawned as background tasks** by the build agents
   (the spec selector updates) — they are tracked, not lost.

## 8. Decisions I need from you

- **Approve the foundation** so I can launch the page epics (3 Transactions+Inbox,
  4 Income+Expenses, 5 Bills+Contacts, 6 Payroll+Reports+Settings) — these run in
  parallel, each one workbench per agent, all consuming this shared toolkit.
- **e2e spec migration:** fold the Ask AI / app-shell spec updates into **Epic 7**
  (recommended), or have me do them as a fast-follow now before the page epics?
- **Payroll auto-run backend spike** (the net-new "draft each period's run from the
  roster" capability you asked for) — confirm it rides with **Epic 6**, with the
  Runs UI honestly showing "Manual" until it ships.

## 9. What's next (after approval)

Page epics 3–6 run as parallel workflows (the page files are largely disjoint;
Epic 6's Payroll waits for Epic 5's shared module file). Each rewrites its surface
on the shared toolkit — full-width tables with detail closed by default, consistent
filters/date-range/export, Income/Expenses as true lenses over the same records —
then returns its own evidence pack. Epic 7 closes with the full responsive QA matrix
(all surfaces × 5 widths), the e2e spec migration, and the consolidated gate checklist.
