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

  it("keeps the app shell vocabulary aligned with OpenBook - Prototype/OpenBooks.dc.html", () => {
    const shell = readWorkspaceFile("apps/web/src/components/openbooks/AppShell.tsx");

    [
      "open books",
      "Acme Studio LLC",
      "Search transactions, contacts, reports",
      "Jun 2026",
      "Ask AI",
      "All accounts synced 12 minutes ago.",
    ].forEach((text) => {
      expect(shell).toContain(text);
    });
  });
});
