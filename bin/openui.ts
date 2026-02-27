#!/usr/bin/env bun

import { $ } from "bun";
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import packageJson from "../package.json" assert { type: "json" };

// `openui resume` — pick a session via fzf and resume it in the terminal
if (process.argv[2] === "resume") {
  const PORT = process.env.PORT || process.env.OPENUI_PORT || "6968";
  let allSessions: any[] = [];
  try {
    const res = await fetch(`http://localhost:${PORT}/api/sessions`);
    if (!res.ok) {
      console.error(`Could not reach OpenUI server at localhost:${PORT}`);
      process.exit(1);
    }
    allSessions = await res.json();
  } catch {
    console.error(`Could not reach OpenUI server at localhost:${PORT}`);
    process.exit(1);
  }

  if (allSessions.length === 0) {
    console.log("No sessions found.");
    process.exit(0);
  }

  // Sort: handoff first, then waiting_input, idle, running, others
  const priority: Record<string, number> = { handoff: 0, waiting_input: 1, idle: 2, disconnected: 3, running: 4, error: 5 };
  allSessions.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));

  // Format a session as a fixed-width fzf line
  function formatLine(s: any): string {
    const status = s.status.padEnd(14);
    const name = (s.customName || s.agentName || "Agent").padEnd(24);
    const branch = (s.gitBranch || "").padEnd(28);
    return `${status} ${name} ${branch} ${s.cwd || ""}`;
  }

  const lines = allSessions.map(formatLine).join("\n");

  const fzf = Bun.spawn(["fzf", "--ansi", "--no-sort", "--prompt=openui resume > "], {
    stdin: new TextEncoder().encode(lines),
    stdout: "pipe",
    stderr: "inherit",
  });
  await fzf.exited;
  if (fzf.exitCode !== 0) process.exit(0);

  const selected = await new Response(fzf.stdout).text();
  if (!selected.trim()) process.exit(0);

  // Match selected line back to a session; fall back to cwd substring match
  const selectedSession =
    allSessions.find(s => formatLine(s).trim() === selected.trim()) ||
    allSessions.find(s => s.cwd && selected.includes(s.cwd));

  if (!selectedSession) {
    console.error("Could not identify selected session.");
    process.exit(1);
  }

  if (!selectedSession.claudeSessionId) {
    console.error("Session has no claudeSessionId — cannot resume.");
    process.exit(1);
  }

  // If session is active in OpenUI, request handoff first
  const activeStatuses = ["running", "waiting_input", "tool_calling"];
  if (activeStatuses.includes(selectedSession.status)) {
    process.stdout.write("Session is active in OpenUI — detaching");
    await fetch(`http://localhost:${PORT}/api/sessions/${selectedSession.sessionId}/request-handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: "terminal" }),
    });
    // Poll until handoff or disconnected
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      process.stdout.write(".");
      try {
        const check = await fetch(`http://localhost:${PORT}/api/sessions`).then(r => r.json());
        const s = check.find((x: any) => x.sessionId === selectedSession.sessionId);
        if (!s || s.status === "handoff" || s.status === "disconnected") break;
      } catch { break; }
    }
    console.log(" done.");
  }

  const pluginDir = join(homedir(), ".openui", "claude-code-plugin");
  const parts = ["claude", "--resume", selectedSession.claudeSessionId];
  if (existsSync(join(pluginDir, ".claude-plugin", "plugin.json"))) {
    parts.push("--plugin-dir", pluginDir);
  }

  console.log(`\n${parts.join(" ")}\n`);
  // exec: replace this process with claude
  const proc = Bun.spawn(parts, {
    cwd: selectedSession.cwd || homedir(),
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, OPENUI_PORT: PORT },
  });
  await proc.exited;
  process.exit(proc.exitCode ?? 0);
}

// Get the actual module directory (works with symlinks)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, "..");

const CURRENT_VERSION = packageJson.version;

const PORT = process.env.PORT || 6969;
const LAUNCH_CWD = process.cwd();
const IS_DEV = process.env.NODE_ENV === "development" || process.argv.includes("--dev");

// Read update channel from config (defaults to "stable")
function getUpdateChannel(): string {
  try {
    const configPath = join(homedir(), ".openui", "config.json");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      if (typeof config.updateChannel === "string") return config.updateChannel;
    }
  } catch {}
  return "stable";
}

// Auto-install plugin if not present
async function ensurePluginInstalled() {
  const pluginDir = join(homedir(), ".openui", "claude-code-plugin");
  const pluginJson = join(pluginDir, ".claude-plugin", "plugin.json");

  if (existsSync(pluginJson)) {
    return; // Plugin already installed
  }

  console.log("\x1b[38;5;141m[plugin]\x1b[0m Installing Claude Code plugin...");

  const channel = getUpdateChannel();
  const GITHUB_RAW = `https://raw.githubusercontent.com/JJ27/openui/${channel}/claude-code-plugin`;

  try {
    // Create directories
    await $`mkdir -p ${pluginDir}/.claude-plugin ${pluginDir}/hooks`.quiet();

    // Download plugin files
    await Promise.all([
      $`curl -sL ${GITHUB_RAW}/.claude-plugin/plugin.json -o ${pluginDir}/.claude-plugin/plugin.json`.quiet(),
      $`curl -sL ${GITHUB_RAW}/hooks/hooks.json -o ${pluginDir}/hooks/hooks.json`.quiet(),
      $`curl -sL ${GITHUB_RAW}/hooks/status-reporter.sh -o ${pluginDir}/hooks/status-reporter.sh`.quiet(),
    ]);

    // Make script executable
    await $`chmod +x ${pluginDir}/hooks/status-reporter.sh`.quiet();

    console.log("\x1b[38;5;82m[plugin]\x1b[0m Plugin installed successfully!");
  } catch (e) {
    console.error("\x1b[38;5;196m[plugin]\x1b[0m Failed to install plugin:", e);
  }
}

// Check for updates via npm registry (non-blocking, for npm installs)
async function checkForUpdates() {
  try {
    const res = await fetch("https://registry.npmjs.org/@fallom/openui/latest", {
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return;

    const data = await res.json();
    const latestVersion = data.version;

    if (latestVersion && latestVersion !== CURRENT_VERSION) {
      console.log(`\x1b[33m  Update available: ${CURRENT_VERSION} → ${latestVersion}\x1b[0m`);
      console.log(`\x1b[38;5;245m  Run: npm install -g @fallom/openui\x1b[0m\n`);
    }
  } catch {
    // Silently ignore - don't block startup for version check
  }
}

// Auto-update from git (for git clone installs)
async function autoUpdateFromGit() {
  if (process.argv.includes("--no-update")) return;

  const gitDir = join(ROOT_DIR, ".git");
  if (!existsSync(gitDir)) return; // Not a git clone (e.g. npm install)

  const dataDir = join(homedir(), ".openui");
  const buildCommitFile = join(dataDir, ".build-commit");

  // Try to fetch + pull from origin
  const channel = getUpdateChannel();
  const channelLabel = channel === "stable" ? "stable" : `${channel} (beta)`;
  console.log(`\x1b[38;5;245m[update]\x1b[0m Channel: ${channelLabel}`);
  try {
    await $`git -C ${ROOT_DIR} fetch origin ${channel} --quiet`.timeout(5000);

    const behind = (await $`git -C ${ROOT_DIR} rev-list HEAD..origin/${channel} --count`.text()).trim();
    if (parseInt(behind) > 0) {
      console.log(`\x1b[38;5;141m[update]\x1b[0m ${behind} new commit(s) on ${channelLabel}, pulling...`);
      const result = await $`git -C ${ROOT_DIR} pull --ff-only origin ${channel}`.quiet();
      if (result.exitCode !== 0) {
        console.log(`\x1b[38;5;208m[update]\x1b[0m Could not auto-update (local changes?). Run 'git pull' manually.`);
      } else {
        console.log(`\x1b[38;5;82m[update]\x1b[0m Updated to latest version!`);
      }
    }
  } catch {
    // No internet or fetch failed — continue with current code
  }

  // Check if rebuild is needed
  const currentHead = (await $`git -C ${ROOT_DIR} rev-parse HEAD`.text().catch(() => "")).trim();
  if (!currentHead) return;

  await $`mkdir -p ${dataDir}`.quiet();
  const lastBuild = existsSync(buildCommitFile)
    ? (await Bun.file(buildCommitFile).text().catch(() => "")).trim()
    : "";

  if (currentHead === lastBuild) return; // Build is up to date

  console.log(`\x1b[38;5;141m[build]\x1b[0m Source code changed, rebuilding...`);

  // Reinstall deps (package.json may have changed)
  await $`cd ${ROOT_DIR} && bun install`.quiet();
  await $`cd ${join(ROOT_DIR, "client")} && bun install`.quiet();

  // Build client
  const buildProc = Bun.spawn(["bun", "run", "build"], {
    cwd: ROOT_DIR,
    stdio: ["inherit", "inherit", "inherit"],
  });
  await buildProc.exited;

  if (buildProc.exitCode === 0) {
    await Bun.write(buildCommitFile, currentHead);
    console.log(`\x1b[38;5;82m[build]\x1b[0m Client rebuilt successfully!\n`);
  } else {
    console.error(`\x1b[38;5;196m[build]\x1b[0m Build failed. UI may be outdated.`);
  }
}

// Clear screen and show ASCII art
console.clear();
console.log(`
\x1b[38;5;141m
    ██╗      █████╗ ██╗   ██╗███╗   ██╗ ██████╗██╗  ██╗██╗███╗   ██╗ ██████╗
    ██║     ██╔══██╗██║   ██║████╗  ██║██╔════╝██║  ██║██║████╗  ██║██╔════╝
    ██║     ███████║██║   ██║██╔██╗ ██║██║     ███████║██║██╔██╗ ██║██║  ███╗
    ██║     ██╔══██║██║   ██║██║╚██╗██║██║     ██╔══██║██║██║╚██╗██║██║   ██║
    ███████╗██║  ██║╚██████╔╝██║ ╚████║╚██████╗██║  ██║██║██║ ╚████║╚██████╔╝
    ╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝

    ██╗   ██╗ ██████╗ ██╗   ██╗██████╗      █████╗ ██╗
    ╚██╗ ██╔╝██╔═══██╗██║   ██║██╔══██╗    ██╔══██╗██║
     ╚████╔╝ ██║   ██║██║   ██║██████╔╝    ███████║██║
      ╚██╔╝  ██║   ██║██║   ██║██╔══██╗    ██╔══██║██║
       ██║   ╚██████╔╝╚██████╔╝██║  ██║    ██║  ██║██║
       ╚═╝    ╚═════╝  ╚═════╝ ╚═╝  ╚═╝    ╚═╝  ╚═╝╚═╝

     ██████╗ ██████╗ ███╗   ███╗███╗   ███╗ █████╗ ███╗   ██╗██████╗
    ██╔════╝██╔═══██╗████╗ ████║████╗ ████║██╔══██╗████╗  ██║██╔══██╗
    ██║     ██║   ██║██╔████╔██║██╔████╔██║███████║██╔██╗ ██║██║  ██║
    ██║     ██║   ██║██║╚██╔╝██║██║╚██╔╝██║██╔══██║██║╚██╗██║██║  ██║
    ╚██████╗╚██████╔╝██║ ╚═╝ ██║██║ ╚═╝ ██║██║  ██║██║ ╚████║██████╔╝
     ╚═════╝ ╚═════╝ ╚═╝     ╚═╝╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝

     ██████╗███████╗███╗   ██╗████████╗███████╗██████╗
    ██╔════╝██╔════╝████╗  ██║╚══██╔══╝██╔════╝██╔══██╗
    ██║     █████╗  ██╔██╗ ██║   ██║   █████╗  ██████╔╝
    ██║     ██╔══╝  ██║╚██╗██║   ██║   ██╔══╝  ██╔══██╗
    ╚██████╗███████╗██║ ╚████║   ██║   ███████╗██║  ██║
     ╚═════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝╚═╝  ╚═╝
\x1b[0m

\x1b[38;5;251m                    ╔═══════════════════════════════════════╗
                    ║                                       ║
                    ║   \x1b[1m\x1b[38;5;141mhttp://localhost:${PORT}\x1b[0m\x1b[38;5;251m                 ║
                    ║                                       ║
                    ╚═══════════════════════════════════════╝\x1b[0m

\x1b[38;5;245m                         Press Ctrl+C to stop\x1b[0m
`);

// Ensure plugin is installed, check for updates, and auto-update from git
await ensurePluginInstalled();
checkForUpdates();
await autoUpdateFromGit();

// Fallback: build client if dist directory still doesn't exist
// (e.g. first clone with --no-update, or non-git install)
const clientDistPath = join(ROOT_DIR, "client", "dist");
if (!existsSync(clientDistPath)) {
  console.log("\x1b[38;5;141m[build]\x1b[0m Building client for first run...");
  const buildProc = Bun.spawn(["bun", "run", "build"], {
    cwd: ROOT_DIR,
    stdio: ["inherit", "inherit", "inherit"]
  });
  await buildProc.exited;
  if (buildProc.exitCode !== 0) {
    console.error("\x1b[38;5;196m[build]\x1b[0m Failed to build client");
    process.exit(1);
  }
  console.log("\x1b[38;5;82m[build]\x1b[0m Client built successfully!\n");
}

// Start the server with LAUNCH_CWD env var
// In production mode, suppress server output
const server = Bun.spawn(["bun", "run", "server/index.ts"], {
  cwd: ROOT_DIR,
  stdio: IS_DEV ? ["inherit", "inherit", "inherit"] : ["inherit", "ignore", "ignore"],
  env: { ...process.env, PORT: String(PORT), LAUNCH_CWD, OPENUI_QUIET: IS_DEV ? "" : "1" }
});

// Browser opening disabled - access manually at http://localhost:${PORT}
// setTimeout(async () => {
//   const platform = process.platform;
//   const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
//   await $`${cmd} http://localhost:${PORT}`.quiet();
// }, 1500);

process.on("SIGINT", () => {
  server.kill();
  process.exit(0);
});

process.on("SIGTERM", () => {
  server.kill();
  process.exit(0);
});

await server.exited;
