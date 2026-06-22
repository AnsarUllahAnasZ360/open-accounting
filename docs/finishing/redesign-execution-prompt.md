# OpenBooks Redesign — Kickoff Prompt + Build/Verify Workflow

Date: 2026-06-14 · Use this to launch the redesign in a fresh Opus chat with a
build→verify agent team. Companions: `redesign-implementation-plan.md` (epics
E0–E8) and `redesign-research-plan.md` (rationale + nav model).

---

## 1. Copy-paste kickoff prompt (paste into a new Opus chat at the repo root)

> Execute the OpenBooks UI redesign. **ultracode.**
>
> Read first, in order: `docs/finishing/redesign-implementation-plan.md` (epics
> E0–E8 + requirements coverage), `docs/finishing/redesign-research-plan.md`
> (rationale, nav model, insights architecture),
> `docs/finishing/redesign-execution-prompt.md` (this workflow), and `AGENTS.md` +
> `docs/finishing/whats-left.md` (repo rules + gate contract).
>
> **Outcome:** a clean, functional, and above all **consistent** UI across
> Transactions, Income, Expenses, and Contacts — every section on the same
> workbench shell with an identical sub-tab bar ordered **[cash-movement · AR/AP
> (Income & Expenses only) · Insights]**. Invoices is the **AR sub-tab under
> Income**; Bills is the **AP sub-tab under Expenses**; **Insights is the last
> sub-tab everywhere and must be designed with a lot of attention to detail**.
> Contacts must support **adding contacts correctly and customer statements**.
> **E5 (consistency) is the keystone** — nothing is done until every section feels
> like the same page with different data.
>
> **Run this as a build→verify team.** For each epic: one agent **builds** it on an
> isolated git worktree and runs the full gate (`pnpm verify` + `npx convex dev
> --once` + real-click Playwright e2e + screenshots to `docs/finishing/evidence/`),
> then a **separate** agent independently **verifies** the gates, the epic's
> acceptance criteria, and the E5 consistency checklist, returning PASS/FAIL +
> specific findings. Loop fixes until PASS (max 3 rounds), then commit per epic.
>
> **Ordering:** serialize the UI epics **E0 → E1 → E2 → E3 → E4 → E5** (they share
> the driver / SectionTabs / Insights components). Run backend epics **E6 (AI
> hardening)** and **E7 (Stripe integrity)** in parallel on their own worktrees
> after E0 lands. Do **E8 (income streams)** after E2. **Re-run the E5 consistency
> suite after every later merge.**
>
> Honor every rule in AGENTS.md and whats-left.md: never mutate the shared demo
> books (disposable business → archive), real clicks only, both gates green before
> each commit, money in integer minor units, posted ledger entries immutable.
> **Start with E0** and report after each epic verifies.

*(If you don't want full ultracode autonomy, drop the word "ultracode" and the
lead will ask before each epic.)*

---

## 2. The team (roles)

- **Lead** (the chat's main Opus) — owns the plan and sequencing, integrates each
  epic, commits, updates `completion-report.md`, and decides PASS/FAIL escalations.
- **Builder agent** (one per epic) — implements all of the epic's tasks on an
  **isolated worktree**, runs the full gate, captures screenshots, and returns a
  structured report: files changed · gate results · evidence paths · self-check vs
  the epic's acceptance criteria.
- **Verifier agent** (one per epic, independent, fresh context) — re-runs the
  gates, checks the acceptance criteria **and the E5 consistency checklist**,
  inspects the diff + screenshots, and returns **PASS/FAIL + specific findings**.
  The verifier never fixes; it judges.
- **Fix loop** — on FAIL, the Lead dispatches a focused builder with the findings;
  re-verify; ≤3 rounds, then escalate to Ansar with the blocker.

Why a separate verifier: the builder is biased toward "it works on my machine."
An independent agent re-running the gates and auditing against the consistency
checklist is what makes "consistent and functional" provable rather than asserted.

## 3. Ordering & isolation (why)

```
Stage 1 — UI shell (SERIAL, shared components):
  E0 driver+sub-nav ─▶ E1 Insights system ─▶ E2 Income ─▶ E3 Expenses ─▶ E4 Contacts ─▶ E5 KEYSTONE
      build→verify        build→verify          build→verify  build→verify   build→verify   build→verify

Stage 2 — Backend (PARALLEL, own worktrees, after E0):
  E6 AI hardening   ║  E7 Stripe integrity        (E8 income streams after E2)
      build→verify  ║      build→verify

Stage 3 — Final gate:
  Re-run E5 consistency suite after all merges ─▶ PASS = redesign done
```

- **Serialize E0–E5:** they all edit the shared `WorkbenchPage`, `SectionTabs`, and
  Insights components — parallel edits would collide. One at a time keeps the diff
  clean and lets each inherit the prior epic's shell.
- **Parallelize E6/E7:** they touch `convex/` (AI pipeline, Stripe), not the UI
  shell, so they can run concurrently in their own worktrees.
- **E5 is a gate, not just a step:** re-run it after E6/E7/E8 merge, because backend
  changes can subtly break a page's states/numbers.

## 4. Per-epic loop (what each iteration does)

1. Lead picks the next epic; briefs a **Builder** with the epic's tasks +
   acceptance + the relevant plan sections + the consistency checklist (E5.1).
2. Builder implements on a worktree, runs `pnpm verify`, `npx convex dev --once`,
   the affected Playwright specs (real clicks), saves screenshots, returns its
   report.
3. Lead briefs a fresh **Verifier** with the epic's acceptance + checklist + the
   builder's diff/evidence. Verifier re-runs gates, audits, returns PASS/FAIL +
   findings.
4. FAIL → Lead dispatches a fix builder with the findings; back to step 2 (≤3).
5. PASS → Lead integrates, commits per epic (conventional message), updates
   `completion-report.md` (WORKING only with linked green test + screenshot), moves
   on.

## 5. Workflow-tool script sketch (optional, for the executing Opus)

If the Lead uses the `Workflow` tool, this is the shape (illustrative — author the
real script against the epic list):

```js
export const meta = {
  name: 'openbooks-redesign',
  description: 'Build→verify each redesign epic; serialize UI, parallel backend, keystone gate',
  phases: [
    { title: 'Foundation' }, { title: 'UI epics' },
    { title: 'Keystone' }, { title: 'Backend' }, { title: 'Final gate' },
  ],
}
const buildVerify = async (epic) => {                       // one epic, ≤3 fix rounds
  let findings = null
  for (let i = 0; i < 3; i++) {
    const built = await agent(`Build epic ${epic.id}: ${epic.brief}. ${findings ? 'Fix: '+findings : ''} Run all gates; return evidence.`,
      { label: `build:${epic.id}`, phase: epic.phase, isolation: 'worktree', schema: BUILD_REPORT })
    const v = await agent(`Independently verify epic ${epic.id} against its acceptance + the E5 consistency checklist. Re-run gates. Return PASS/FAIL + findings.`,
      { label: `verify:${epic.id}`, phase: epic.phase, schema: VERDICT })
    if (v?.pass) return { epic: epic.id, ...built, verified: true }
    findings = v?.findings
  }
  return { epic: epic.id, verified: false, findings }       // escalate
}
phase('Foundation'); await buildVerify(E0)
phase('UI epics');   for (const e of [E1, E2, E3, E4]) await buildVerify(e)   // serial — shared shell
phase('Keystone');   await buildVerify(E5)
phase('Backend');    await parallel([E6, E7].map(e => () => buildVerify(e)))  // own worktrees
phase('Final gate'); return await buildVerify(E5_RERUN)
```

## 6. Definition of done (the whole redesign)
- Transactions / Income / Expenses / Contacts share one shell + identical sub-tab
  bar; Income has Invoices, Expenses has Bills, all four have Insights.
- The **E5 parameterized consistency suite is green** and side-by-side screenshots
  (desktop + 390px) show one uniform product.
- Insights pages are polished per E1 (KPI anatomy, crosshair/drill-drawer, states,
  AI cards, compare control).
- Contacts can add a contact and generate a statement.
- E6/E7 verified; `completion-report.md` updated; both gates green at HEAD.
