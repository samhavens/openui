import { spawnSync } from "bun";
import { spawn as spawnPty } from "bun-pty";
import { existsSync, mkdirSync } from "fs";
import { join, basename, relative } from "path";
import { homedir } from "os";
import type { Session } from "../types";
import { loadBuffer } from "./persistence";
import { enqueueSessionStart, signalSessionReady } from "./sessionStartQueue";
import * as worktreeRegistry from "./worktreeRegistry";

const QUIET = !!process.env.OPENUI_QUIET;
const log = QUIET ? () => {} : console.log.bind(console);
const logError = QUIET ? () => {} : console.error.bind(console);

// Get the OpenUI plugin directory path
function getPluginDir(): string | null {
  // Check for plugin in ~/.openui/claude-code-plugin (installed via curl)
  const homePluginDir = join(homedir(), ".openui", "claude-code-plugin");
  const homePluginJson = join(homePluginDir, ".claude-plugin", "plugin.json");
  log(`\x1b[38;5;245m[plugin-check]\x1b[0m Checking home: ${homePluginJson} exists=${existsSync(homePluginJson)}`);
  if (existsSync(homePluginJson)) {
    return homePluginDir;
  }

  // Check for plugin in the openui repo (for development)
  // Use import.meta.dir for ESM compatibility
  const currentDir = import.meta.dir || __dirname;
  const repoPluginDir = join(currentDir, "..", "..", "claude-code-plugin");
  const repoPluginJson = join(repoPluginDir, ".claude-plugin", "plugin.json");
  log(`\x1b[38;5;245m[plugin-check]\x1b[0m Checking repo: ${repoPluginJson} exists=${existsSync(repoPluginJson)}`);
  if (existsSync(repoPluginJson)) {
    return repoPluginDir;
  }

  log(`\x1b[38;5;245m[plugin-check]\x1b[0m No plugin found`);
  return null;
}

// Inject --plugin-dir flag for Claude commands if plugin is available
export function injectPluginDir(command: string, agentId: string): string {
  if (agentId !== "claude") return command;

  const pluginDir = getPluginDir();
  if (!pluginDir) return command;

  // Check if command already has --plugin-dir
  if (command.includes("--plugin-dir")) return command;

  // Handle both "claude" and "llm agent claude" command formats
  const parts = command.split(/\s+/);

  // Check for "llm agent claude" format
  if (parts[0] === "llm" && parts[1] === "agent" && parts[2] === "claude") {
    // Insert --plugin-dir after 'claude' (index 2)
    parts.splice(3, 0, `--plugin-dir`, pluginDir);
    const finalCmd = parts.join(" ");
    log(`\x1b[38;5;141m[plugin]\x1b[0m Injecting plugin-dir: ${pluginDir}`);
    log(`\x1b[38;5;141m[plugin]\x1b[0m Final command: ${finalCmd}`);
    return finalCmd;
  }

  // Check for plain "claude" format
  if (parts[0] === "claude") {
    // Use the path directly without quotes - shell will handle it
    parts.splice(1, 0, `--plugin-dir`, pluginDir);
    const finalCmd = parts.join(" ");
    log(`\x1b[38;5;141m[plugin]\x1b[0m Injecting plugin-dir: ${pluginDir}`);
    log(`\x1b[38;5;141m[plugin]\x1b[0m Final command: ${finalCmd}`);
    return finalCmd;
  }

  return command;
}

// Get git branch for a directory
export function getGitBranch(cwd: string): string | null {
  try {
    const result = spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) {
      return result.stdout.toString().trim();
    }
  } catch {
    // Not a git repo or git not available
  }
  return null;
}

// Get git root directory (returns worktree path if in a worktree)
export function getGitRoot(cwd: string): string | null {
  try {
    const result = spawnSync(["git", "rev-parse", "--show-toplevel"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) {
      return result.stdout.toString().trim();
    }
  } catch {
    // Not a git repo
  }
  return null;
}

// Get the main worktree (mother repo) path - works from any worktree
function getMainWorktree(cwd: string): string | null {
  try {
    // git worktree list shows all worktrees, first one is always the main
    const result = spawnSync(["git", "worktree", "list", "--porcelain"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode === 0) {
      const output = result.stdout.toString();
      // First "worktree" line is the main repo
      const match = output.match(/^worktree (.+)$/m);
      if (match) {
        return match[1];
      }
    }
  } catch {
    // Not a git repo or worktree command failed
  }
  return null;
}

// Run a git command asynchronously (doesn't block the event loop)
export async function gitAsync(args: string[], cwd: string, timeoutSec = 15): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["timeout", String(timeoutSec), "git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

// Resolve the actual base ref for branching: try origin/<baseBranch>, then
// detect remote's default branch (main vs master), then fall back to local.
export async function resolveBaseRef(baseBranch: string, gitRoot: string): Promise<string> {
  let baseRef = `origin/${baseBranch}`;
  await gitAsync(["fetch", "origin", baseBranch], gitRoot, 15);
  const hasRemoteRef = await gitAsync(["rev-parse", "--verify", baseRef], gitRoot, 5);
  if (hasRemoteRef.exitCode !== 0) {
    const headRef = await gitAsync(["symbolic-ref", "refs/remotes/origin/HEAD"], gitRoot, 5);
    if (headRef.exitCode === 0) {
      baseRef = headRef.stdout.trim().replace("refs/remotes/", "");
      log(`\x1b[38;5;141m[worktree]\x1b[0m origin/${baseBranch} not found, using default: ${baseRef}`);
    } else {
      baseRef = baseBranch;
      log(`\x1b[38;5;141m[worktree]\x1b[0m No remote HEAD found, using local: ${baseRef}`);
    }
  }
  return baseRef;
}

// Create a git worktree for a branch
export async function createWorktree(params: {
  cwd: string;
  branchName: string;
  baseBranch: string;
}): Promise<{ success: boolean; worktreePath?: string; branchName?: string; error?: string }> {
  const { cwd, branchName, baseBranch } = params;
  log(`\x1b[38;5;141m[worktree]\x1b[0m createWorktree called: cwd=${cwd}, branch=${branchName}, base=${baseBranch}`);
  const gitRoot = getGitRoot(cwd);

  if (!gitRoot) {
    log(`\x1b[38;5;141m[worktree]\x1b[0m Not a git repository at: ${cwd}`);
    return { success: false, error: `Not a git repository at: ${cwd}` };
  }
  log(`\x1b[38;5;141m[worktree]\x1b[0m Git root: ${gitRoot}`);

  // Create worktrees directory beside the main repo
  const repoName = basename(gitRoot);
  const worktreesDir = join(gitRoot, "..", `${repoName}-worktrees`);

  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
  }

  // Sanitize branch name for directory and find unique path
  const baseDirName = branchName.replace(/\//g, "-");
  let finalDirName = baseDirName;
  let finalBranchName = branchName;
  let worktreePath = join(worktreesDir, finalDirName);
  let suffix = 2;
  while (existsSync(worktreePath)) {
    finalBranchName = `${branchName}-${suffix}`;
    finalDirName = `${baseDirName}-${suffix}`;
    worktreePath = join(worktreesDir, finalDirName);
    suffix++;
  }

  // Check if branch exists locally first
  const localBranch = await gitAsync(["rev-parse", "--verify", finalBranchName], gitRoot, 5);

  let result;
  if (localBranch.exitCode === 0) {
    // Branch exists locally, just add worktree
    log(`\x1b[38;5;141m[worktree]\x1b[0m Creating worktree for existing local branch: ${finalBranchName}`);
    result = await gitAsync(["worktree", "add", worktreePath, finalBranchName], gitRoot, 30);
  } else {
    // Try to fetch the branch from remote — if it exists, track it
    log(`\x1b[38;5;141m[worktree]\x1b[0m Fetching ${finalBranchName} from remote...`);
    const fetchBranch = await gitAsync(["fetch", "origin", finalBranchName], gitRoot, 15);

    if (fetchBranch.exitCode === 0) {
      // Branch exists on remote, create worktree tracking it
      log(`\x1b[38;5;141m[worktree]\x1b[0m Creating worktree tracking remote branch: ${finalBranchName}`);
      result = await gitAsync(["worktree", "add", "--track", "-b", finalBranchName, worktreePath, `origin/${finalBranchName}`], gitRoot, 30);
    } else {
      // Branch doesn't exist anywhere — create new branch from base.
      const baseRef = await resolveBaseRef(baseBranch, gitRoot);
      log(`\x1b[38;5;141m[worktree]\x1b[0m Creating new branch ${finalBranchName} from ${baseRef}`);
      result = await gitAsync(["worktree", "add", "-b", finalBranchName, worktreePath, baseRef], gitRoot, 30);
    }
  }

  if (result.exitCode !== 0) {
    logError(`\x1b[38;5;141m[worktree]\x1b[0m Failed to create worktree:`, result.stderr);
    return { success: false, error: result.stderr };
  }

  log(`\x1b[38;5;141m[worktree]\x1b[0m Created worktree at: ${worktreePath} (branch: ${finalBranchName})`);
  return { success: true, worktreePath, branchName: finalBranchName };
}


export const MAX_BUFFER_SIZE = 1000;

/** Broadcast a message to all WebSocket clients of a session, with try-catch per client */
export function broadcastToSession(session: Session, message: object) {
  const json = JSON.stringify(message);
  for (const client of session.clients) {
    try {
      if (client.readyState === 1) {
        client.send(json);
      }
    } catch {
      session.clients.delete(client);
    }
  }
}

export const sessions = new Map<string, Session>();

export async function createSession(params: {
  sessionId: string;
  agentId: string;
  agentName: string;
  command: string;
  cwd: string;
  nodeId: string;
  customName?: string;
  customColor?: string;
  // Ticket and worktree options
  ticketId?: string;
  ticketTitle?: string;
  ticketUrl?: string;
  branchName?: string;
  baseBranch?: string;
  createWorktreeFlag?: boolean;
  sparseCheckout?: boolean;
  ticketPromptTemplate?: string;
}): Promise<{ session: Session; cwd: string; gitBranch?: string; setupPending?: boolean }> {
  const {
    sessionId,
    agentId,
    agentName,
    command,
    cwd: originalCwd,
    nodeId,
    customName,
    customColor,
    ticketId,
    ticketTitle,
    ticketUrl,
    branchName,
    baseBranch,
    createWorktreeFlag,
    sparseCheckout,
    ticketPromptTemplate,
  } = params;

  let workingDir = originalCwd;
  let worktreePath: string | undefined;
  let mainRepoPath: string | undefined;
  let gitBranch: string | null = null;
  let setupPending = false;
  let isSparse = false;
  let pendingSetup: { gitRoot: string; branchName: string; baseBranch: string; originalCwd: string } | null = null;

  // If worktree requested, try fast paths first
  if (createWorktreeFlag && branchName && baseBranch) {
    const gitRoot = getGitRoot(originalCwd);
    if (!gitRoot) {
      throw new Error(`Not a git repository at: ${originalCwd}`);
    }

    if (sparseCheckout) {
      // ── Sparse checkout path (always fast) ──
      const relDir = relative(gitRoot, originalCwd);
      if (!relDir || relDir === "." || relDir.startsWith("..")) {
        // cwd is repo root or outside repo — sparse makes no sense, fall through to full
        log(`\x1b[38;5;141m[session]\x1b[0m Sparse requested at repo root or outside repo, using full checkout`);
      } else {
        log(`\x1b[38;5;141m[session]\x1b[0m Sparse checkout for ${relDir}`);
        const repoName = basename(gitRoot);
        const worktreesDir = join(gitRoot, "..", `${repoName}-worktrees`);
        if (!existsSync(worktreesDir)) mkdirSync(worktreesDir, { recursive: true });

        const dirName = branchName.replace(/\//g, "-");
        let wtPath = join(worktreesDir, dirName);
        let finalBranchName = branchName;
        let suffix = 2;
        while (existsSync(wtPath)) {
          finalBranchName = `${branchName}-${suffix}`;
          wtPath = join(worktreesDir, `${dirName}-${suffix}`);
          suffix++;
        }

        const baseRef = await resolveBaseRef(baseBranch, gitRoot);

        // Step 1: Create worktree with --no-checkout (instant)
        const addResult = await gitAsync(
          ["worktree", "add", "--no-checkout", "-b", finalBranchName, wtPath, baseRef],
          gitRoot, 30,
        );
        if (addResult.exitCode !== 0) {
          throw new Error(`Failed to create sparse worktree: ${addResult.stderr}`);
        }

        // Step 2: Set sparse checkout cone for the relative directory
        const sparseResult = await gitAsync(
          ["sparse-checkout", "set", "--cone", relDir],
          wtPath, 15,
        );
        if (sparseResult.exitCode !== 0) {
          logError(`\x1b[38;5;141m[session]\x1b[0m sparse-checkout set failed:`, sparseResult.stderr);
        }

        // Step 3: Checkout (only fetches files in the cone — fast)
        const checkoutResult = await gitAsync(["checkout"], wtPath, 120);
        if (checkoutResult.exitCode !== 0) {
          logError(`\x1b[38;5;141m[session]\x1b[0m Sparse checkout failed:`, checkoutResult.stderr);
          // Cleanup partial worktree
          try { await gitAsync(["worktree", "remove", "--force", wtPath], gitRoot, 15); } catch {}
          throw new Error(`Sparse checkout failed: ${checkoutResult.stderr}`);
        }

        const sparseWorkingDir = join(wtPath, relDir);
        if (!existsSync(sparseWorkingDir)) {
          logError(`\x1b[38;5;141m[session]\x1b[0m Sparse checkout dir does not exist: ${sparseWorkingDir}, falling back to full checkout`);
          // Directory doesn't exist on this branch — fall through to full checkout
        } else {
          worktreePath = wtPath;
          workingDir = sparseWorkingDir;
          mainRepoPath = originalCwd;
          gitBranch = finalBranchName;
          isSparse = true;

          worktreeRegistry.register(wtPath, gitRoot, sessionId, finalBranchName);
          log(`\x1b[38;5;141m[session]\x1b[0m Sparse worktree ready: ${wtPath} (cone: ${relDir})`);
        }
      }
    }

    // Full checkout path (if not handled by sparse above)
    if (!worktreePath) {
      // Try registry first — instant reuse
      const claimed = worktreeRegistry.claim(gitRoot, sessionId);
      if (claimed) {
        log(`\x1b[38;5;141m[session]\x1b[0m Reusing worktree from registry: ${claimed}`);
        const assignResult = await worktreeRegistry.assignBranch(claimed, branchName, baseBranch, gitRoot);
        if (assignResult.success) {
          worktreePath = claimed;
          workingDir = claimed;
          mainRepoPath = originalCwd;
          gitBranch = assignResult.branchName;
          log(`\x1b[38;5;141m[session]\x1b[0m Worktree reuse success: ${claimed} -> ${gitBranch}`);
        } else {
          // Reuse failed, release it back and fall through to fresh creation
          logError(`\x1b[38;5;141m[session]\x1b[0m Worktree reuse failed:`, assignResult.error);
          worktreeRegistry.release(claimed);
        }
      }

      // No registry hit (or reuse failed) — create fresh in background with progress
      if (!worktreePath) {
        setupPending = true;
        // Store context for async completion
        pendingSetup = { gitRoot, branchName, baseBranch, originalCwd };
        log(`\x1b[38;5;141m[session]\x1b[0m Pool miss — will create worktree in background`);
      }
    }
  }

  // If no explicit worktree but we're in a worktree, detect the main repo
  if (!mainRepoPath) {
    const detectedMainRepo = getMainWorktree(workingDir);
    if (detectedMainRepo && detectedMainRepo !== workingDir) {
      mainRepoPath = detectedMainRepo;
      log(`\x1b[38;5;141m[session]\x1b[0m Detected main repo from worktree: ${mainRepoPath}`);
    }
  }

  // Get git branch if not already set from worktree
  if (!gitBranch) {
    gitBranch = getGitBranch(workingDir);
  }

  const now = Date.now();
  const session: Session = {
    pty: null as any,
    agentId,
    agentName,
    command,
    cwd: workingDir,
    originalCwd: mainRepoPath, // Store mother repo when using worktree
    gitBranch: gitBranch || undefined,
    worktreePath,
    createdAt: new Date().toISOString(),
    clients: new Set(),
    outputBuffer: [],
    status: setupPending ? "setting_up" as any : "idle",
    lastOutputTime: now,
    lastInputTime: 0,
    recentOutputSize: 0,
    customName,
    customColor,
    nodeId,
    isRestored: false,
    sparseCheckout: isSparse,
    setupStatus: setupPending ? "creating_worktree" : undefined,
    setupProgress: setupPending ? 0 : undefined,
    setupPhase: setupPending ? "Preparing worktree" : undefined,
    ticketId,
    ticketTitle,
    ticketUrl,
  };

  sessions.set(sessionId, session);

  // Helper to spawn PTY and start the agent
  const startPty = (cwd: string) => {
    const ptyProcess = spawnPty("/bin/bash", [], {
      name: "xterm-256color",
      cwd,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        OPENUI_SESSION_ID: sessionId,
        ...(isSparse ? { OPENUI_SPARSE_CHECKOUT: "1" } : {}),
      },
      rows: 30,
      cols: 120,
    });

    session.pty = ptyProcess;

    // Output decay
    const resetInterval = setInterval(() => {
      if (!sessions.has(sessionId) || !session.pty) {
        clearInterval(resetInterval);
        return;
      }
      session.recentOutputSize = Math.max(0, session.recentOutputSize - 50);
    }, 500);

    // PTY output handler
    ptyProcess.onData((data: string) => {
      session.outputBuffer.push(data);
      if (session.outputBuffer.length > MAX_BUFFER_SIZE) {
        session.outputBuffer.shift();
      }

      session.lastOutputTime = Date.now();
      session.recentOutputSize += data.length;

      // Just broadcast output - status comes from plugin hooks
      broadcastToSession(session, { type: "output", data });
    });

    // Run the command (inject plugin-dir for Claude if available)
    const finalCommand = injectPluginDir(command, agentId);
    log(`\x1b[38;5;82m[pty-write]\x1b[0m Writing command: ${finalCommand}`);

    setTimeout(() => {
      ptyProcess.write(`${finalCommand}\r`);

      // If sparse checkout, inject a startup hint after the agent command
      if (isSparse && session.worktreePath) {
        const wtGitRoot = getGitRoot(session.worktreePath);
        const relDir = wtGitRoot ? relative(wtGitRoot, cwd) : cwd;
        setTimeout(() => {
          const hint = `Note: This worktree uses sparse checkout. Currently checked out: ${relDir}/\nFiles outside this directory are not available until expanded.\nTo manually expand: git sparse-checkout add <directory>`;
          ptyProcess.write(hint + "\r");
        }, 2000);
      }

      // If there's a ticket URL, send it to the agent after a delay
      if (ticketUrl) {
        setTimeout(() => {
          const defaultTemplate = "Here is the ticket for this session: {{url}}\n\nPlease use the Linear MCP tool or fetch the URL to read the full ticket details before starting work.";
          const template = ticketPromptTemplate || defaultTemplate;
          const ticketPrompt = template
            .replace(/\{\{url\}\}/g, ticketUrl)
            .replace(/\{\{id\}\}/g, ticketId || "")
            .replace(/\{\{title\}\}/g, ticketTitle || "");
          ptyProcess.write(ticketPrompt + "\r");
        }, isSparse ? 4000 : 2000);
      }
    }, 300);
  };

  if (setupPending && pendingSetup) {
    // Background worktree creation with progress
    const { gitRoot, branchName: pendBranch, baseBranch: pendBase, originalCwd: pendCwd } = pendingSetup;

    completeSessionSetup(session, sessionId, gitRoot, pendBranch, pendBase, pendCwd, startPty);
  } else {
    // Immediate start — worktree already ready (or no worktree needed)
    startPty(workingDir);
  }

  log(`\x1b[38;5;141m[session]\x1b[0m Created ${sessionId} for ${agentName}${ticketId ? ` (ticket: ${ticketId})` : ""}${isSparse ? " (sparse)" : ""}${setupPending ? " (setup pending)" : ""}`);
  return { session, cwd: workingDir, gitBranch: gitBranch || undefined, setupPending };
}

/**
 * Complete session setup asynchronously when worktree creation is done in the background.
 * Creates the worktree with progress reporting, then spawns the PTY.
 */
async function completeSessionSetup(
  session: Session,
  sessionId: string,
  gitRoot: string,
  branchName: string,
  baseBranch: string,
  originalCwd: string,
  startPty: (cwd: string) => void,
): Promise<void> {
  try {
    const result = await worktreeRegistry.createFresh({
      gitRoot,
      sessionId,
      onProgress: (percent, phase) => {
        session.setupProgress = percent;
        session.setupPhase = phase;
        broadcastToSession(session, {
          type: "setup_progress",
          progress: percent,
          phase,
        });
      },
    });

    if (!result.path || result.error) {
      logError(`\x1b[38;5;141m[session]\x1b[0m Background worktree creation failed:`, result.error);
      session.status = "error";
      session.setupStatus = undefined;
      session.setupProgress = undefined;
      session.setupPhase = undefined;
      broadcastToSession(session, {
        type: "setup_complete",
        error: result.error || "Failed to create worktree",
      });
      return;
    }

    // Assign branch to the fresh worktree
    const assignResult = await worktreeRegistry.assignBranch(result.path, branchName, baseBranch, gitRoot);
    const gitBranch = assignResult.success ? assignResult.branchName : branchName;

    // Update session with worktree info
    session.worktreePath = result.path;
    session.cwd = result.path;
    session.originalCwd = originalCwd;
    session.gitBranch = gitBranch;
    session.setupStatus = "ready";
    session.setupProgress = undefined;
    session.setupPhase = undefined;
    session.status = "idle";

    log(`\x1b[38;5;141m[session]\x1b[0m Background worktree ready: ${result.path} -> ${gitBranch}`);

    // Spawn PTY now that worktree is ready
    startPty(result.path);

    // Notify clients setup is complete
    broadcastToSession(session, { type: "setup_complete" });

    // Save state with updated worktree info
    const { saveState } = require("./persistence");
    saveState(sessions);
  } catch (error) {
    logError(`\x1b[38;5;141m[session]\x1b[0m completeSessionSetup failed:`, error);
    session.status = "error";
    session.setupStatus = undefined;
    broadcastToSession(session, {
      type: "setup_complete",
      error: String(error),
    });
  }
}

export function deleteSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (!session) return false;

  if (session.pty) session.pty.kill();

  // Release worktree back to registry for reuse (instead of deleting)
  if (session.worktreePath) {
    worktreeRegistry.release(session.worktreePath);
  }

  sessions.delete(sessionId);
  log(`\x1b[38;5;141m[session]\x1b[0m Killed ${sessionId}`);
  return true;
}

export function restoreSessions() {
  const { loadState } = require("./persistence");
  const state = loadState();

  log(`\x1b[38;5;245m[restore]\x1b[0m Found ${state.nodes.length} saved sessions`);

  for (const node of state.nodes) {
    // Skip archived sessions - they should not be in the active sessions Map
    if (node.archived) {
      log(`[restore] Skipping archived session: ${node.sessionId} (${node.customName})`);
      continue;
    }
    console.log(`[restore] Loading session: ${node.sessionId} (${node.customName}) archived=${node.archived}`);

    // Validate worktree directory still exists
    let cwd = node.cwd;
    if (node.worktreePath && !existsSync(node.worktreePath)) {
      log(`\x1b[38;5;208m[restore]\x1b[0m Worktree deleted: ${node.worktreePath}, falling back to ${node.originalCwd || node.cwd}`);
      cwd = node.originalCwd || node.cwd;
    }

    const buffer = loadBuffer(node.sessionId);
    const gitBranch = getGitBranch(cwd);

    const session: Session = {
      pty: null,
      agentId: node.agentId,
      agentName: node.agentName,
      command: node.command,
      cwd,
      originalCwd: node.originalCwd,
      worktreePath: node.worktreePath,
      gitBranch: gitBranch || node.gitBranch || undefined,
      createdAt: node.createdAt,
      clients: new Set(),
      outputBuffer: buffer,
      status: "disconnected",
      lastOutputTime: 0,
      lastInputTime: 0,
      recentOutputSize: 0,
      customName: node.customName,
      customColor: node.customColor,
      notes: node.notes,
      nodeId: node.nodeId,
      isRestored: true,
      autoResumed: node.autoResumed || false,
      claudeSessionId: node.claudeSessionId,  // Restore Claude session ID for --resume
      archived: false,  // Active sessions are never archived
      canvasId: node.canvasId,  // Canvas/tab this agent belongs to
      sparseCheckout: node.sparseCheckout,
      ticketId: node.ticketId,
      ticketTitle: node.ticketTitle,
      ticketUrl: node.ticketUrl,
    };

    sessions.set(node.sessionId, session);
    log(`\x1b[38;5;245m[restore]\x1b[0m Restored ${node.sessionId} (${node.agentName}) branch: ${gitBranch || 'none'}`);
  }

  // Reconcile worktree registry: re-claim worktrees for active sessions
  reconcileWorktreeRegistry();
}

/** Reconcile worktree registry with active sessions after restore. */
function reconcileWorktreeRegistry() {
  for (const [sessionId, session] of sessions) {
    if (session.worktreePath && existsSync(session.worktreePath)) {
      const gitRoot = getGitRoot(session.originalCwd || session.cwd);
      if (gitRoot) {
        worktreeRegistry.register(session.worktreePath, gitRoot, sessionId, session.gitBranch || undefined);
      }
    }
  }
}

/**
 * Auto-resume sessions on startup (resumes all non-archived sessions)
 */
export function autoResumeSessions() {
  const { getSessionsToResume, getAutoResumeConfig } = require("./autoResume");
  const { saveState } = require("./persistence");

  const config = getAutoResumeConfig();
  if (!config.enabled) {
    log(`\x1b[38;5;141m[auto-resume]\x1b[0m Auto-resume is disabled`);
    return;
  }

  const sessionsToResume = getSessionsToResume();

  if (sessionsToResume.length === 0) {
    log(`\x1b[38;5;141m[auto-resume]\x1b[0m No sessions to auto-resume`);
    return;
  }

  log(`\x1b[38;5;141m[auto-resume]\x1b[0m Auto-resuming ${sessionsToResume.length} sessions...`);

  for (const node of sessionsToResume) {
    const session = sessions.get(node.sessionId);
    if (!session) {
      log(`\x1b[38;5;245m[auto-resume]\x1b[0m Session not found: ${node.sessionId}`);
      continue;
    }

    // Skip if already has a PTY (already running)
    if (session.pty) {
      log(`\x1b[38;5;245m[auto-resume]\x1b[0m Skipping ${node.sessionId} (already running)`);
      continue;
    }

    const startFn = () => {
      try {
        // Spawn a new PTY for this session
        const ptyProcess = spawnPty("/bin/bash", [], {
          name: "xterm-256color",
          cwd: session.cwd,
          env: {
            ...process.env,
            TERM: "xterm-256color",
            OPENUI_SESSION_ID: node.sessionId,
            ...(session.sparseCheckout ? { OPENUI_SPARSE_CHECKOUT: "1" } : {}),
          },
          rows: 30,
          cols: 120,
        });

        session.pty = ptyProcess;
        session.status = "idle";
        session.isRestored = false;
        session.autoResumed = true;

        // Set up PTY data handler
        ptyProcess.onData((data: string) => {
          session.outputBuffer.push(data);
          if (session.outputBuffer.length > MAX_BUFFER_SIZE) {
            session.outputBuffer.shift();
          }

          session.lastOutputTime = Date.now();
          session.recentOutputSize += data.length;

          // Broadcast to all connected clients
          broadcastToSession(session, { type: "output", data });
        });

        // Build the command with resume flag if we have a Claude session ID
        let finalCommand = injectPluginDir(session.command, session.agentId);

        // For Claude sessions with a known claudeSessionId, use --resume to restore the specific session
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (session.agentId === "claude" && session.claudeSessionId && UUID_RE.test(session.claudeSessionId)) {
          // Remove any existing --resume flags first
          finalCommand = finalCommand.replace(/--resume\s+[\w-]+/g, '').replace(/--resume(?=\s|$)/g, '').trim();

          const resumeArg = `--resume ${session.claudeSessionId}`;
          if (finalCommand.includes("llm agent claude")) {
            finalCommand = finalCommand.replace("llm agent claude", `llm agent claude ${resumeArg}`);
          } else if (finalCommand.startsWith("claude")) {
            finalCommand = finalCommand.replace(/^claude(\s|$)/, `claude ${resumeArg}$1`);
          }
          log(`\x1b[38;5;141m[auto-resume]\x1b[0m Resuming Claude session: ${session.claudeSessionId}`);
        }

        // Send the command to the PTY after a short delay
        setTimeout(() => {
          ptyProcess.write(`${finalCommand}\r`);
        }, 300);

        log(`\x1b[38;5;141m[auto-resume]\x1b[0m Resumed ${node.sessionId} (${node.agentName})`);
      } catch (error) {
        logError(`\x1b[38;5;141m[auto-resume]\x1b[0m Failed to resume ${node.sessionId}:`, error);
        // Signal ready on failure so the queue isn't blocked
        signalSessionReady(node.sessionId);
      }
    };

    // Claude agents go through the queue to prevent OAuth port contention
    if (session.agentId === "claude") {
      enqueueSessionStart(node.sessionId, startFn, () => session.outputBuffer);
    } else {
      // Non-Claude agents start immediately (no OAuth)
      startFn();
    }
  }

  // Save state to persist autoResumed flag
  saveState(sessions);
  log(`\x1b[38;5;141m[auto-resume]\x1b[0m Auto-resume complete`);
}
