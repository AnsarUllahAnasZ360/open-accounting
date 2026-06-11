# OpenBooks Design System

**OpenBooks** is a simple, opinionated, open-source alternative to QuickBooks: free AI-assisted bookkeeping for small businesses. It connects bank accounts (Plaid) and payment gateways (Stripe), pulls every transaction, and uses AI to categorize them automatically — asking the owner via an **Inbox** only when it's uncertain. It maintains a double-entry ledger and produces the core reports a business owner needs: Balance Sheet, Profit & Loss, Cash Flow Statement, A/R and A/P Aging, and a Business Overview — without paying an accountant or for software.

**Product principle (from the codebase README):** *"AI proposes. The ledger engine posts."* Accounting correctness comes before automation. The system asks the owner only when it is uncertain.

## Sources

- **Codebase:** https://github.com/AnsarUllahAnasZ360/open-accounting — Next.js + Tailwind + **shadcn/ui**, Convex backend, lucide-react icons, Geist fonts. Early bootstrap stage: the design tokens, component primitives, and dashboard shell in `apps/web/` are the source of truth for this system's foundations. Explore it further to build designs grounded in the real product.
- **Logo:** `uploads/OpenBooks.png` (provided by founder) — green circular "OB" mark + lowercase "open books" wordmark.
- **Fonts:** imported from https://github.com/vercel/geist-font (the families the codebase declares).
- **Icons:** imported from https://github.com/lucide-icons/lucide (the codebase uses lucide-react).
- Report taxonomy informed by QuickBooks Online's standard report set (Balance Sheet, P&L, Statement of Cash Flows, A/R / A/P Aging Summary, Business Snapshot) — *inspiration for information architecture only; all UI here is original.*

## Product surfaces & information architecture

One product: the **OpenBooks web app**. Primary navigation:

| Section | Contents |
|---|---|
| Dashboard | Business at a glance: total balance, bank accounts, P&L trend, cash flow widget, Ask AI bar |
| Inbox | AI's questions — uncertain transactions awaiting owner context |
| Transactions | Bank feed, receipts, rules, chart of accounts; AI-categorized with confidence states |
| Income | Sales / money-in, line-wise attribution, Stripe payouts, invoices (future) |
| Expenses | Spend insights, vendors, operational vs other expenses |
| Cash Flow | Overview, planner, simple budgets |
| Reports | Balance Sheet, Profit & Loss, Cash Flow Statement, A/R Aging, A/P Aging, Business Overview, custom reports |
| Settings | Connected accounts (N× Plaid banks, N× Stripe), rules, company |

## CONTENT FUNDAMENTALS

- **Voice:** plain, calm, confident. Bookkeeping is stressful; copy never is. No exclamation marks, no hype, no jargon beyond standard accounting terms (the audience knows "P&L" and "A/R").
- **Person:** the product addresses the owner as "you"; the AI speaks in first person only inside the Inbox ("I wasn't sure how to categorize this"). Elsewhere the system is impersonal: "14 transactions need review."
- **Casing:** sentence case everywhere — buttons ("Add transaction"), nav items, card titles. Exceptions: proper nouns (Stripe, Plaid) and report names, which are Title Case as accounting convention ("Profit & Loss", "Balance Sheet").
- **Numbers:** money is the content. Always tabular figures, always 2 decimals in tables ($4,892.14), abbreviated only in metric cards ($128.4K). Negative amounts use a minus sign and the negative color, never parentheses-only.
- **Dates:** short month form — "Jun 6", "Jun 2026", "Jan 1 – Jun 10, 2026" for ranges.
- **Status vocabulary (fixed):** `Synced` · `Ready` · `Needs review` · `Posted` · `Match` · `Excluded`. AI states: "Categorized by AI", "Rule applied", "Needs your input".
- **Emoji:** never.
- **Examples from the codebase:** "Ledger-first bookkeeping for small service businesses" · "The owner workflow will clear uncertain transactions before posting." · "AI proposes. The ledger engine posts."

## VISUAL FOUNDATIONS

- **Vibe:** quiet, trustworthy, ledger-like. White surfaces, hairline borders, one confident green. Closer to a well-set financial document than a SaaS marketing page.
- **Color:** white `--background`; near-black text `oklch(0.145 0 0)`; neutral grays straight from the codebase's shadcn tokens. **One accent: OpenBooks green `#2ca01c`** (`--ob-green-500`) for primary actions, active nav, positive money, and AI affordances. The AI is green, never purple — no gradients, ever. Semantic money colors: positive green `--positive`, negative red `--negative`, review amber `--warning`, informational blue `--info`. Tints (`*-surface`) are used for badges and row highlights.
- **Type:** Geist for everything; Geist Mono for money figures, dates in tables, and account numbers (`--font-figures`, `tnum`). Base UI size 14px. Page titles 24/semibold; dashboard metrics 30/semibold with -0.01em tracking. No serif, no display face.
- **Spacing:** 4px grid. Cards pad 16–24px; page gutters 24–32px; card grids gap 16px.
- **Backgrounds:** flat white only. No imagery, no textures, no patterns, no gradients. Density comes from tables and hairlines, not decoration.
- **Borders & cards:** cards = `--shadow-xs` + a 1px `foreground/10` ring (`--card-ring`, from the codebase's `ring-1 ring-foreground/10`) + `--radius-card` (14px). Tables sit inside cards; header rows use `--surface-sunken`. No colored left-border accent cards.
- **Radii:** buttons/inputs/selects 10px (`--radius-control`), cards/dialogs 14px (`--radius-card`), tab triggers 8px, badges are full pills, switches/avatars/logo full.
- **Shadows:** near-invisible. `--shadow-xs` on cards, `--shadow-md` on popovers/dialogs only. Never glows.
- **Hover:** primary buttons go to 80% strength (`hover:bg-primary/80` in the codebase — mix toward white); rows and nav items tint to `--muted` or `--sidebar-accent`; transitions 120ms ease-out, color/background only.
- **Press:** buttons translate down 1px (codebase `active:translate-y-px`); no scale effects.
- **Focus:** 3px soft green ring (`--ring-shadow`).
- **Animation:** almost none. 120–160ms ease-out color fades; numbers and charts may settle with a 240ms ease-out on load. No bounces, no parallax, no infinite loops.
- **Transparency/blur:** not used. Dialog overlay is plain `rgb(0 0 0 / 0.4)`.
- **Charts:** thin grid lines (`--chart-grid`), green primary series, teal secondary, amber projections, slate prior-period, red outflows. Bars have 4px top radius; lines 2px with no area fill or a ≤8% tint.
- **Layout:** fixed left sidebar 232px (light, `--sidebar`), content max 1200px, 56px page header row. Money columns right-aligned, always.

## ICONOGRAPHY

- **System:** [Lucide](https://lucide.dev) — exactly what the codebase uses (`lucide-react`). 24×24 viewBox, 2px stroke, round caps/joins, `currentColor`.
- **Local copies:** 50 SVGs in `assets/icons/` (imported from the lucide repo) covering finance needs: `landmark`, `banknote`, `wallet`, `credit-card`, `receipt`, `chart-column`, `chart-line`, `chart-pie`, `trending-up/down`, `arrow-up-right/down-right`, `inbox`, `sparkles` (AI), `circle-alert`, `circle-check`, `shield-check`, plus navigation/chrome icons.
- **In React:** use the `Icon` component (`components/core/Icon.jsx`) — `<Icon name="landmark" size={16} />` — which embeds the same lucide path data and inherits `currentColor`. In plain HTML, `<img src="assets/icons/landmark.svg">` works but won't tint.
- **Sizing:** 16px inline with text and in buttons; 18–20px in nav; never above 24px except empty states (40px, `--text-muted`).
- **AI marker:** `sparkles` in `--ai` green. No emoji, no unicode-as-icon, no hand-drawn SVGs.
- **Logo:** `assets/logo/openbooks-logo.png` (full lockup), `assets/logo/openbooks-mark.png` (square crop of the green circle mark — use in sidebar/avatars at 28–40px).

## Index

| Path | What |
|---|---|
| `styles.css` | Global entry — `@import`s every token file below |
| `tokens/{colors,typography,spacing,fonts,base}.css` | All custom properties + `@font-face` |
| `assets/logo/` | Logo lockup + square mark |
| `assets/icons/` | 50 lucide SVGs |
| `assets/fonts/` | Geist + Geist Mono variable woff2 |
| `reference/open-accounting/` | Verbatim source snapshots from the GitHub repo (`.txt`) |
| `components/core/` | Button, Badge, Card (+Header/Title/Description/Action/Content/Footer), Tabs (+List/Trigger/Content), Icon |
| `components/forms/` | Input, Select, Switch |
| `components/data/` | StatCard, Amount (+formatMoney), Table (+Header/Body/Footer/Row/Head/Cell), BarChart, Sparkline, EmptyState |
| `components/navigation/` | SideNav, PageHeader |
| `components/ai/` | AskAI, ReviewItem |
| `ui_kits/openbooks/` | Full app recreation — Dashboard, Inbox, Transactions/Income/Expenses, Cash Flow, Reports (with P&L statement), Settings |
| `templates/app-screen/` | "App screen" template — sidebar + header + AskAI shell to start any new screen from |
| `guidelines/` | Foundation specimen cards (Design System tab) |
| `SKILL.md` | Agent-skill entry point (Claude Code compatible) |

Components are compiled into `_ds_bundle.js`; read `*.prompt.md` next to each component for usage.
