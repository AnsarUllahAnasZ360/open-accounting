// E15-T2 / E15-T11: single source of truth for the public launch links so every
// surface (landing, setup, help, README cross-checks, outreach copy) tells one
// consistent story. Changing the owner/repo or the launch origin happens HERE,
// once — keep the `<!-- REPO-URL -->` find-replace anchor on raw href strings in
// the landing as hygiene for any one-sweep owner-prefix update.
//
// Decisions applied:
// - Q80: the public repo is renamed to `openbooks`; all GitHub links target
//   `github.com/<owner>/openbooks` (NOT the legacy `open-accounting` slug).
// - Q85: launch/canonical links point at the custom domain
//   `openbooks.ansarullahanas.com`, falling back to the Vercel URL only if the
//   alias isn't live at launch.

/** GitHub owner login. Change here for a one-sweep owner-prefix update. */
export const GITHUB_OWNER = "AnsarUllahAnasZ360";

/** Public repository slug. Renamed to `openbooks` per Q80 (was `open-accounting`). */
export const GITHUB_REPO = "openbooks";

/** Canonical GitHub repository URL (Q80). */
export const GITHUB_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}`;

/** Self-host docs subtree on GitHub. */
export const GITHUB_SELF_HOST_DOCS = `${GITHUB_URL}/tree/main/docs/self-host`;

/** The self-host agent skill subtree on GitHub. */
export const GITHUB_SELF_HOST_SKILL = `${GITHUB_URL}/tree/main/skills/openbooks-self-host`;

/** Custom launch domain (Q85). The Vercel URL is the fallback only. */
export const LAUNCH_URL = "https://openbooks.ansarullahanas.com";
