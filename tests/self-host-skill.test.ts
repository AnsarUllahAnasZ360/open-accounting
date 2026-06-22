import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// E13-T1: the openbooks-self-host skill must (1) live at a TRACKED path with
// valid YAML frontmatter, (2) only orchestrate commands/scripts that actually
// exist, and (3) keep its env-map reference covering every variable preflight
// enforces. These checks run in the unit gate so the skill cannot rot.
import { envRequirements } from "../scripts/preflight.mjs";
import { flatPreflightNames } from "../scripts/check-env-docs.mjs";

const root = resolve(__dirname, "..");
const skillDir = resolve(root, "skills/openbooks-self-host");
const skillPath = resolve(skillDir, "SKILL.md");
const envMapPath = resolve(skillDir, "reference/env-map.md");

const skill = readFileSync(skillPath, "utf8");
const envMap = readFileSync(envMapPath, "utf8");

/** Minimal frontmatter parser — the skills loader reads the leading `---` YAML
 * block; we parse `name:` and `description:` (which may be a folded `>-` block). */
function parseFrontmatter(text: string): Record<string, string> {
  const match = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!match) throw new Error("SKILL.md has no YAML frontmatter block");
  const body = match[1];
  const fields: Record<string, string> = {};
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const keyMatch = /^([a-zA-Z_]+):\s*(.*)$/.exec(lines[i]);
    if (!keyMatch) continue;
    const [, key, rawValue] = keyMatch;
    if (rawValue === ">-" || rawValue === ">" || rawValue === "|") {
      // Folded/literal block scalar: gather the indented continuation lines.
      const collected: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^\s+\S/.test(lines[j])) collected.push(lines[j].trim());
        else break;
      }
      fields[key] = collected.join(" ");
    } else {
      fields[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  }
  return fields;
}

describe("openbooks-self-host skill (E13-T1)", () => {
  it("lives at the tracked skills/ path (not .claude/ or .agents/)", () => {
    expect(existsSync(skillPath)).toBe(true);
    expect(existsSync(envMapPath)).toBe(true);
    // Guard against accidentally pointing the deliverable at a gitignored dir.
    expect(skillPath).not.toContain(".claude/");
    expect(skillPath).not.toContain(".agents/");
  });

  it("has valid YAML frontmatter with name + a triggering description", () => {
    const fm = parseFrontmatter(skill);
    expect(fm.name).toBe("openbooks-self-host");
    expect(fm.description.length).toBeGreaterThan(20);
    // The description should trigger on the self-host intents the ticket names.
    expect(fm.description.toLowerCase()).toContain("self-host");
    expect(fm.description.toLowerCase()).toContain("openbooks");
  });

  it("is an ordered, resumable checklist covering the full provisioning flow", () => {
    for (const phase of [
      "fork",
      "pnpm install",
      "pnpm setup",
      "npx convex dev --once",
      "convex env set",
      "pnpm dev:full",
      "vercel link",
      "vercel deploy --prod",
    ]) {
      expect(skill, `SKILL.md should mention "${phase}"`).toContain(phase);
    }
  });

  it("states the guardrails: no secret values, pause before --prod/account steps, live keys allowed", () => {
    expect(skill).toMatch(/[Nn]ever echo a secret/);
    expect(skill).toContain("[PAUSE]");
    expect(skill).toMatch(/never fully auto-provision/i);
    expect(skill).toMatch(/[Ll]ive connectors are permitted/);
    // It must NOT instruct sandbox/test-only keys (the removed rule).
    expect(skill).not.toMatch(/sandbox(\/| )only|test keys only|test-only keys/i);
  });

  it("only references scripts that actually exist", () => {
    const scripts = [
      "scripts/setup.mjs",
      "scripts/preflight.mjs",
      "scripts/dev-full.mjs",
      "scripts/register-stripe-webhook.mjs",
      "scripts/check-env-docs.mjs",
    ];
    for (const script of scripts) {
      expect(skill, `SKILL.md references ${script}`).toContain(script);
      expect(existsSync(resolve(root, script)), `${script} must exist`).toBe(true);
    }
  });

  it("env-map.md lists every variable preflight enforces, with destinations", () => {
    const required = flatPreflightNames(envRequirements());
    const missing = [...required].filter((name) => !envMap.includes(`\`${name}\``));
    expect(missing, `env-map.md missing: ${missing.join(", ")}`).toEqual([]);
    // Destinations must be present so a self-hoster knows Vercel vs Convex.
    expect(envMap).toContain("Convex");
    expect(envMap).toContain("Vercel");
  });
});
