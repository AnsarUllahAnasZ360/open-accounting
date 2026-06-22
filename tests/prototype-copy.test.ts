// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readWorkspaceFile(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("prototype copy guardrails", () => {
  it("keeps the landing page grounded in OpenBook - Prototype/Landing.dc.html", () => {
    const landing = readWorkspaceFile("apps/web/src/app/page.tsx");

    [
      "Your books, always done.",
      "Free · open source · self-hosted",
      "Money moves. The ledger posts. You answer a question now and then.",
      "Five minutes, not five hours.",
      "Ask your books anything.",
      "Every screen money touches.",
      "Statements your CPA accepts.",
      "The whole business, in your pocket.",
      "Because you bring the keys, there's nothing to charge you for.",
      "Nobody else combines all five.",
      "Connect your accounts. Answer a few questions a week.",
    ].forEach((text) => {
      expect(landing).toContain(text);
    });
  });

  it("keeps the app shell vocabulary aligned with the approved redesign (Section 6.12)", () => {
    const shell = readWorkspaceFile("apps/web/src/components/openbooks/AppShell.tsx");

    // The 2026-06-13 foundation redesign decluttered the shell per Section 6.12 of
    // docs/finishing/frontend-redesign-research-report.md: the static "Jun 2026"
    // month chip and the wide "Search transactions, contacts, reports" pill were
    // intentionally removed (search is now a compact icon reachable at every width,
    // and the period lives on the surfaces that own it). The shell still carries the
    // brand wordmark, a reachable Search affordance, the Ask AI trigger, and the
    // Settings + Sync utility cluster relocated to the sidebar footer.
    [
      "open books",
      "Search",
      "Ask AI",
      "Settings",
      "Sync",
    ].forEach((text) => {
      expect(shell).toContain(text);
    });
  });

  it("removes the hardcoded entity name from the app shell (Epic A5)", () => {
    // The active entity name now flows from the viewer/report context — the
    // sidebar and page headers must not hardcode "Acme Studio LLC".
    const shell = readWorkspaceFile("apps/web/src/components/openbooks/AppShell.tsx");
    const appScreen = readWorkspaceFile("apps/web/src/components/openbooks/AppScreen.tsx");
    expect(shell).not.toContain("Acme Studio LLC");
    expect(appScreen).not.toContain("Acme Studio LLC");
  });
});
