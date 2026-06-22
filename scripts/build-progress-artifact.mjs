#!/usr/bin/env node
// Regenerate the live launch-sprint progress artifact (self-contained HTML).
// Reads: docs/launch-sprint/backlog.json (147 tickets) + progress.ndjson (live
// feed appended by the build workflow). Writes: docs/launch-sprint/progress.html
// Re-run at every milestone; the HTML embeds its data so it needs no server.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const backlog = JSON.parse(readFileSync(resolve(root, "docs/launch-sprint/backlog.json"), "utf8"));
const ndjsonPath = resolve(root, "docs/launch-sprint/progress.ndjson");

// R1 tickets consolidated on 2026-06-20 (the recovered/merged work).
const R1_DONE = [
  "E1-T2","E1-T3","E1-T5","E1-T6","E6-T1","E8-T1","E8-T3","E9-T1",
  "E10-T1","E12-T1","E13-T2","E13-T4","E14-T4","E14-T5","E15-T1","E15-T6",
];

const feed = [];
if (existsSync(ndjsonPath)) {
  for (const line of readFileSync(ndjsonPath, "utf8").split(/\r?\n/)) {
    const s = line.trim();
    if (!s) continue;
    try { feed.push(JSON.parse(s)); } catch { /* skip malformed */ }
  }
}

// Done = R1 set ∪ any ticket in a verify line with status green.
const done = new Set(R1_DONE);
for (const e of feed) {
  if (e.phase === "verify" && e.status === "green" && Array.isArray(e.tickets)) {
    for (const t of e.tickets) done.add(t);
  }
}

const EPIC_TITLES = {
  E1: "Accounting correctness & reconciliation",
  E2: "AI categorization engine & learning loop",
  E3: "Integrations & BYO-keys (Plaid/Stripe/AI/Plunk)",
  E4: "Guided onboarding & done-for-you books",
  E5: "Multi-entity, workspace↔business & Portfolio",
  E6: "Reports — correctness-aware UI & responsiveness",
  E7: "Transactions register & workbench",
  E8: "Insights everywhere — banners + screens",
  E9: "Dashboard + AI CFO + weekly digests",
  E10: "Payroll — verify, fix & integrate",
  E11: "Data lifecycle — reset, demo, public demo",
  E12: "Settings & app-shell overhaul",
  E13: "Self-host setup skill + security posture",
  E14: "Quality — tests, invariants, eval, audit",
  E15: "Docs, Help Center, Landing & GTM",
};
const ORDER = Object.keys(EPIC_TITLES);

const epics = ORDER.map((id) => {
  const tickets = backlog.filter((t) => t.epic === id);
  const total = tickets.length;
  const d = tickets.filter((t) => done.has(t.id)).length;
  return { id, title: EPIC_TITLES[id], total, done: d, pct: total ? Math.round((d / total) * 100) : 0 };
});
const totalT = backlog.length;
const doneT = backlog.filter((t) => done.has(t.id)).length;
const overall = Math.round((doneT / totalT) * 100);
const now = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
const recent = feed.slice(-40).reverse();

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const bar = (pct, done) =>
  `<div class="bar"><div class="fill${done ? " full" : ""}" style="width:${pct}%"></div></div>`;

const epicRows = epics.map((e) => `
  <div class="epic">
    <div class="epic-h">
      <span class="badge${e.done === e.total ? " done" : e.done > 0 ? " part" : ""}">${e.id}</span>
      <span class="etitle">${esc(e.title)}</span>
      <span class="ecount">${e.done}/${e.total}</span>
    </div>
    ${bar(e.pct, e.done === e.total)}
  </div>`).join("");

const statusDot = (s) => `<span class="dot ${s === "green" ? "g" : s === "red" ? "r" : "y"}"></span>`;
const feedRows = recent.length
  ? recent.map((e) => `
    <tr>
      <td class="mono dim">${esc((e.ts || "").replace("T", " ").slice(5, 16))}</td>
      <td>${statusDot(e.status)}<span class="mono">${esc(e.batchId || "")}</span></td>
      <td class="mono dim">${esc(e.phase || "")}</td>
      <td class="mono">${esc((e.tickets || []).join(" "))}</td>
      <td class="dim">${esc(e.summary || "")}</td>
    </tr>`).join("")
  : `<tr><td colspan="5" class="dim" style="padding:18px">No build activity yet — the workflow appends here as each batch completes.</td></tr>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenBooks Launch Sprint — Live Progress</title>
<style>
  :root{--green:#2ca01c;--ink:#1a1d1a;--mut:#6b716b;--line:#e7e9e7;--bg:#fafbfa;--card:#fff}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .mono{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-variant-numeric:tabular-nums}
  .wrap{max-width:960px;margin:0 auto;padding:28px 20px 60px}
  header{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px 16px;border-bottom:1px solid var(--line);padding-bottom:18px}
  h1{font-size:19px;margin:0;font-weight:650}
  .sub{color:var(--mut);font-size:12.5px}
  .big{margin:22px 0 8px;display:flex;align-items:baseline;gap:12px}
  .pct{font-size:40px;font-weight:680;font-variant-numeric:tabular-nums}
  .pct small{font-size:15px;color:var(--mut);font-weight:500}
  .bar{height:8px;background:#edefed;border-radius:99px;overflow:hidden}
  .fill{height:100%;background:#9bbf94;border-radius:99px}
  .fill.full{background:var(--green)}
  .obar{height:12px;margin-bottom:18px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-top:8px}
  .epic{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:13px 14px}
  .epic-h{display:flex;align-items:center;gap:8px;margin-bottom:9px}
  .badge{font:600 11px/1 ui-monospace,monospace;color:var(--mut);background:#f0f2f0;border:1px solid var(--line);border-radius:6px;padding:4px 6px}
  .badge.part{color:#8a6d00;background:#fbf6e6;border-color:#efe2b8}
  .badge.done{color:#fff;background:var(--green);border-color:var(--green)}
  .etitle{font-size:12.5px;font-weight:550;flex:1;line-height:1.3}
  .ecount{font:600 12px/1 ui-monospace,monospace;color:var(--mut);font-variant-numeric:tabular-nums}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--mut);margin:32px 0 10px}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  td{padding:8px 10px;border-top:1px solid var(--line);font-size:12.5px;vertical-align:top}
  tr:first-child td{border-top:0}
  .dim{color:var(--mut)}
  .dot{display:inline-block;width:7px;height:7px;border-radius:99px;margin-right:6px;vertical-align:middle}
  .dot.g{background:var(--green)}.dot.y{background:#d9a400}.dot.r{background:#c4453b}
  .note{background:#f3f6f2;border:1px solid #dde7da;border-radius:10px;padding:12px 14px;font-size:12.5px;color:#3c463a;margin-top:20px}
  .copy{position:fixed;top:14px;right:14px;font:500 12px/1 ui-sans-serif,system-ui;background:var(--ink);color:#fff;border:0;border-radius:8px;padding:8px 12px;cursor:pointer}
  .copy:active{transform:translateY(1px)}
</style></head>
<body>
<button class="copy" onclick="(async()=>{try{await navigator.clipboard.writeText(document.documentElement.outerHTML);this.textContent='Copied ✓';setTimeout(()=>this.textContent='Copy for AI',1500)}catch(e){this.textContent='Copy failed'}})()">Copy for AI</button>
<div class="wrap">
  <header>
    <h1>OpenBooks — Launch Sprint Progress</h1>
    <span class="sub">branch <span class="mono">launch-sprint-build</span> · autonomous build · updated ${now}</span>
  </header>

  <div class="big"><span class="pct">${overall}%<small> overall</small></span>
    <span class="sub">${doneT} of ${totalT} tickets complete · ${totalT - doneT} remaining</span></div>
  ${bar(overall, false).replace('class="bar"', 'class="bar obar"')}

  <div class="grid">${epicRows}</div>

  <h2>Recent build activity</h2>
  <table><tbody>${feedRows}</tbody></table>

  <div class="note"><b>How to read this:</b> each epic bar fills as its tickets pass an independent verifier. "Recent activity" is the live feed — a green dot means a batch built and verified; amber = partial; red = needs attention. This page is a snapshot; it is re-generated and re-sent at each milestone. When overall hits 100% and the full test suite + server smoke pass, you'll get the completion report.</div>
</div>
</body></html>`;

writeFileSync(resolve(root, "docs/launch-sprint/progress.html"), html);
console.log(`progress.html written — ${overall}% (${doneT}/${totalT}); ${feed.length} feed entries; ${recent.length} shown.`);
