#!/usr/bin/env node
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env.local");
const port = Number(process.env.PORT ?? 3100);
const host = process.env.HOST ?? "127.0.0.1";
const baseURL = process.env.OPENBOOKS_DEV_URL ?? `http://${host}:${port}`;
const dryRun = process.argv.includes("--dry-run");

function parseEnvFile(path) {
  const env = {};
  if (!existsSync(path)) return env;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const equalsIndex = line.indexOf("=");
    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    env[key] = value.replace(/\\n/g, "\n");
  }
  return env;
}

function convexUrl(env) {
  const publicUrl = env.NEXT_PUBLIC_CONVEX_URL;
  if (publicUrl && !/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(publicUrl)) {
    return publicUrl;
  }
  const deployment = env.CONVEX_DEPLOYMENT?.split(":").pop();
  if (deployment && /^[a-z0-9-]+$/.test(deployment)) {
    return `https://${deployment}.convex.cloud`;
  }
  return env.CONVEX_URL ?? publicUrl ?? "";
}

function assertCloudConvex(url) {
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL or CONVEX_DEPLOYMENT is required.");
  }
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url)) {
    throw new Error("OpenBooks finishing branch uses cloud Convex only. Do not run Convex locally.");
  }
}

async function run(name, command, args, options = {}) {
  console.log(`\n[dev:full] ${name}`);
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: root,
    env: options.env,
    timeout: options.timeout ?? 120_000,
  });
  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
}

async function waitForServer(child) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    try {
      const response = await fetch(baseURL, { method: "GET" });
      if (response.status < 500) return;
    } catch {
      // Keep polling.
    }
    if (child.exitCode !== null) {
      throw new Error("Next dev exited before it became ready.");
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Timed out waiting for ${baseURL}.`);
}

function spawnLong(name, command, args, env) {
  console.log(`\n[dev:full] starting ${name}`);
  const child = spawn(command, args, {
    cwd: root,
    env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(`[dev:full] ${name} exited (${signal ?? code}).`);
    shutdown(code ?? 1);
  });
  return child;
}

let shuttingDown = false;
const children = [];

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 250);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

async function main() {
  const fileEnv = parseEnvFile(envPath);
  const env = { ...fileEnv, ...process.env };
  const nextPublicConvexUrl = convexUrl(env);
  assertCloudConvex(nextPublicConvexUrl);

  const runtimeEnv = {
    ...fileEnv,
    ...process.env,
    NEXT_PUBLIC_CONVEX_URL: nextPublicConvexUrl,
    NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS:
      env.NEXT_PUBLIC_OPENBOOKS_DEV_AUTH_BYPASS ?? env.OPENBOOKS_DEV_AUTH_BYPASS ?? "1",
    PORT: String(port),
  };

  if (dryRun) {
    console.log("[dev:full] dry run");
    console.log(`- Convex cloud URL: ${nextPublicConvexUrl}`);
    console.log(`- Next dev URL: ${baseURL}`);
    console.log("- Would run: npx convex dev --once");
    console.log("- Would run: npx convex run authAdmin:bootstrapOwner");
    console.log("- Would start: npx convex dev");
    console.log(`- Would start: pnpm --filter @openbooks/web dev --hostname ${host} --port ${port}`);
    console.log("- Would run: pnpm seed:demo unless OPENBOOKS_SKIP_DEMO_SEED=1");
    return;
  }

  await run("push Convex functions once", "npx", ["convex", "dev", "--once"], {
    env: runtimeEnv,
    timeout: 180_000,
  });
  await run("bootstrap owner account", "npx", ["convex", "run", "authAdmin:bootstrapOwner"], {
    env: runtimeEnv,
    timeout: 120_000,
  });

  const convex = spawnLong("Convex cloud watcher", "npx", ["convex", "dev"], runtimeEnv);
  children.push(convex);
  const next = spawnLong(
    "Next dev",
    "pnpm",
    ["--filter", "@openbooks/web", "dev", "--hostname", host, "--port", String(port)],
    runtimeEnv,
  );
  children.push(next);
  await waitForServer(next);

  if (env.OPENBOOKS_SKIP_DEMO_SEED === "1") {
    console.log("\n[dev:full] demo seed skipped via OPENBOOKS_SKIP_DEMO_SEED=1");
  } else {
    await run("seed demo books through the app", "pnpm", ["seed:demo"], {
      env: { ...runtimeEnv, SEED_DEMO_BASE_URL: baseURL },
      timeout: 240_000,
    });
  }

  console.log("\n[dev:full] OpenBooks is ready.");
  console.log(`- URL: ${baseURL}`);
  console.log("- Local shortcut: /sign-in -> Continue as local dev owner");
}

main().catch((error) => {
  console.error(`[dev:full] ${error instanceof Error ? error.message : String(error)}`);
  shutdown(1);
});
