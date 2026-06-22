# Landing claims audit (E15-T2)

A mapping of every prior landing/marketing claim that was false, stale, or
unverified → the corrected claim → the evidence behind it. This is the audit note
the E15-T2 deliverable asks for, and it is the reference the E15-T11 consistency
pass checks the live surfaces against.

All edits land in `apps/web/src/app/page.tsx`,
`apps/web/src/components/openbooks/LandingPrototypeInteractions.tsx`, and
`apps/web/src/lib/openbooks/brand-links.ts` (the single source of truth for the
repo + launch URLs).

| # | Prior claim | Where | Corrected claim | Evidence / decision |
|---|---|---|---|---|
| 1 | "Self-hosted, one Docker command" | `page.tsx` why-free bullet | "Self-host it on your own deployment" — clone, two commands, point at your own Convex deployment; front end runs locally or on Vercel; full CSV/JSON export. | The stack is Convex cloud dev + Next.js (`README.md` Local Setup, `docs/deployment/vercel.md`, `docs/self-host/deploy.md`); there is no Docker path. **Decision Q83** — drop the Docker claim. |
| 2 | "A machine that runs Docker … one `docker compose up`" | `LandingPrototypeInteractions.tsx` FAQ "What do I need to run it?" | "Node and pnpm, plus a free Convex deployment … `pnpm setup` / `npx convex dev --once` / `pnpm dev:full`, or deploy the front end to Vercel. There is no Docker step." | Same as #1. Matches `README.md` Local Setup steps 1–4 and `docs/self-host/prerequisites.md`. |
| 3 | "up to 24 months of history" | `page.tsx` loop step 01 | "as far back as your bank allows, and you choose your start date" | **Decision Q19** — user chooses; not a fixed month count. Plaid requests `days_requested = 730` at link, Stripe pulls to account inception, CSV/OFX covers older. No fixed number asserted. |
| 4 | "$0/month, forever" | `page.tsx` hero stat strip | "$0 for the software" + an honest footnote: the only costs are your own AI provider usage and Plaid if you outgrow the free tier; CSV import is always free. | The software is free; the user still pays their own API usage. Honest framing, not a marketing absolute. The "~$30/yr" cost card already carries the matching footnote ("Mostly your AI provider's usage…"). |
| 5 | Demo CTAs → `/dashboard` (bounced a logged-out visitor) | `page.tsx` hero / mobile / final / footer | All four demo CTAs → `/demo` (the merged no-login public demo route, E11). | **Decision Q82** — the `/demo` backend is owned by E11 and shipped before launch (progress: A26–A28). The route exists at `apps/web/src/app/demo/page.tsx`; a logged-out visitor reaches seeded, read-only data — no bounce, no 404. |
| 6 | GitHub links → `github.com/AnsarUllahAnasZ360/open-accounting` (repo name ≠ product) | `page.tsx` hero + footer; `setup/page.tsx`; `security/page.tsx` | All GitHub links target `github.com/<owner>/openbooks` via the shared `brand-links.ts` constant, each carrying a `<!-- REPO-URL -->` find-replace anchor for a one-sweep owner-prefix update. | **Decision Q80** — rename the public repo to `openbooks`. Launch/canonical links point at the custom domain `openbooks.ansarullahanas.com` (**Q85**), Vercel URL as fallback. |

## Verified-correct (no rewrite needed)

These were already correct after the E15-T1 relicense (batch A35) and only needed
confirming during this pass:

- The four landing "MIT licensed" strings (`page.tsx` hero stat, compare-table
  "Open source · MIT" row, why-free "Open source, MIT licensed" bullet, footer
  "MIT licensed") and the two FAQ "MIT-licensed" answers are consistent with the
  relicensed root `LICENSE` (MIT). `grep -rni 'agpl'` across `apps/web/src`,
  `README.md`, `AGENTS.md`, `docs/product/01-vision-and-scope.md`, and `LICENSE`
  returns zero AGPL references.
- The FAQ "What happens if the project dies?" answer correctly describes a
  permissive license ("anyone is free to fork it, self-host it, and keep running
  it on their own terms").

## Cross-surface consistency anchor

`apps/web/src/lib/openbooks/brand-links.ts` is the single place the repo owner,
repo slug, GitHub URL, and launch URL are defined. Every public route imports
from it, so a future owner-prefix / domain change is one edit. The raw `href`
attributes keep an inline `/* REPO-URL */` comment so a string find-replace also
works if needed.
