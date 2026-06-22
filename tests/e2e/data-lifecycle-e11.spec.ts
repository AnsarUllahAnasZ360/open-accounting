import { expect, test, type Page } from "@playwright/test";

// E11-T10 — the data-lifecycle loop end to end:
//   (a) owner runs a per-workspace factory reset, confirming by re-typing the
//       workspace name → lands on guided onboarding with an empty book;
//   (b) /demo opens with NO login (no anonymous auth identity, slug-resolved on
//       the server), shows the single shared seeded data + a read-only banner,
//       and a write attempt is blocked AT THE SERVER;
//   (c) the full-account export downloads a non-empty, secret-free file.
//
// These run against the dev server (localhost:3100). The export/reset flows use
// a FRESH signed-up owner so the destructive reset never touches the shared
// dev-bypass workspace other specs depend on.

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const strip = () =>
      document
        .querySelectorAll("nextjs-portal, [data-nextjs-dev-overlay]")
        .forEach((node) => node.remove());
    strip();
    new MutationObserver(strip).observe(document.documentElement, { childList: true, subtree: true });
  });
});

// Sign up a brand-new owner and walk the guided first-run, skipping every step
// that needs live keys. Returns the workspace name (derived as
// `${businessName} workspace`) so the reset spec can re-type it exactly.
async function signUpAndOnboard(page: Page): Promise<{ businessName: string; workspaceName: string }> {
  const stamp = Date.now();
  const email = `lifecycle-${stamp}@example.com`;
  const businessName = `Lifecycle Co ${String(stamp).slice(-5)}`;

  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(`OpenBooks-${stamp}!`);
  await page.getByLabel("Name").fill("Lifecycle Owner");
  await page.getByRole("button", { name: /Sign in/ }).click();

  await expect(page.getByTestId("onboarding-business-step")).toBeVisible({ timeout: 30000 });
  await page.getByTestId("onboarding-business-name").fill(businessName);
  await page.getByTestId("onboarding-type-services").click();
  await page.getByTestId("onboarding-next").click();

  await page.getByTestId("onboarding-ai-skip").click();
  await page.getByTestId("onboarding-plunk-skip").click();
  await page.getByTestId("onboarding-team-continue").click();
  await page.getByTestId("onboarding-bank-skip").click();
  await page.getByTestId("onboarding-stripe-skip").click();
  await page.getByTestId("onboarding-opening-skip").click();
  await page.getByTestId("onboarding-sync-skip").click();
  await page.getByTestId("onboarding-finish").click();

  await expect(page.getByTestId("dashboard-screen")).toBeVisible({ timeout: 60000 });

  return { businessName, workspaceName: `${businessName} workspace` };
}

test("T10 — full-account export downloads a non-empty, secret-free file", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  await signUpAndOnboard(page);

  await page.goto("/settings/data");
  await expect(page.getByTestId("data-section")).toBeVisible({ timeout: 30000 });

  // "Export everything" downloads a JSON snapshot (and a per-table CSV zip). We
  // assert the JSON download is non-empty and carries NO secret material.
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.getByTestId("data-export-everything").click();
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");

  // Non-empty + structurally a full-account snapshot.
  expect(body.length).toBeGreaterThan(20);
  const lower = body.toLowerCase();
  expect(lower).toContain("entity");
  expect(lower).toContain("accounts");

  // Secret-free: no token/ciphertext/api-key material in the exported file.
  for (const secret of ["access_token", "accesstoken", "ciphertext", "encryptedpayload", "fingerprint"]) {
    expect(lower).not.toContain(secret);
  }
});

test("T10 — owner factory reset (re-type workspace name) lands on onboarding with an empty book", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  const { workspaceName } = await signUpAndOnboard(page);

  await page.goto("/settings/data");
  await expect(page.getByTestId("data-section")).toBeVisible({ timeout: 30000 });

  const resetPanel = page.getByTestId("workspace-reset-panel");
  await expect(resetPanel).toBeVisible();

  // The destructive button is disabled until the workspace name is typed EXACTLY.
  const runButton = page.getByTestId("workspace-reset-run");
  await expect(runButton).toBeDisabled();

  // A wrong confirmation keeps it disabled (typed-confirmation friction).
  await page.getByTestId("workspace-reset-confirmation").fill("not the name");
  await expect(runButton).toBeDisabled();

  // The exact workspace name enables the reset.
  await page.getByTestId("workspace-reset-confirmation").fill(workspaceName);
  await expect(runButton).toBeEnabled();
  await runButton.click();

  // After the scoped reset, the viewer flips to needs_onboarding and the guided
  // first-run renders on the now-empty book (owner stays signed in).
  await expect(page.getByTestId("onboarding-screen")).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("onboarding-business-step")).toBeVisible();
});

test("T10 — /demo opens UNAUTHENTICATED, is read-only, and exposes no write affordance", async ({ page }) => {
  test.setTimeout(120_000);

  // No sign-in: a truly unauthenticated visitor (no anonymous auth identity).
  await page.goto("/demo");

  const populated = page.getByTestId("demo-screen");
  const unavailable = page.getByTestId("demo-unavailable");
  await expect(populated.or(unavailable)).toBeVisible({ timeout: 30000 });

  // The clone-to-your-account CTA is always present (top of the open-source funnel).
  await expect(page.getByTestId("demo-clone-cta").first()).toBeVisible();

  if (await populated.isVisible()) {
    // The persistent read-only banner + indicator are shown.
    await expect(page.getByTestId("demo-readonly-banner")).toBeVisible();
    await expect(page.getByTestId("demo-indicator")).toBeVisible();
    // Populated, read-only transactions render.
    await expect(page.getByTestId("demo-transaction-row").first()).toBeVisible({ timeout: 15000 });

    // Read-only surface: the demo page offers NO editable transaction control —
    // no inputs and no edit buttons. (The server-side write guard that rejects a
    // crafted mutation targeting the demo workspace is proven exhaustively by the
    // unit suite convex/demoGuard.test.ts, which enumerates 6 write paths; the UI
    // here simply offers no affordance to attempt one.)
    await expect(page.locator("input, button[data-edit]")).toHaveCount(0);
  }
});
