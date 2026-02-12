import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { gitAsync, getGitRoot, resolveBaseRef } from "./sessionManager";
import { atomicWriteJson } from "./persistence";

const QUIET = !!process.env.OPENUI_QUIET;
const log = QUIET ? () => {} : console.log.bind(console);

const MAX_AVAILABLE_PER_REPO = 5;
const REGISTRY_FILE = join(homedir(), ".openui", "worktrees.json");

interface WorktreeEntry {
  path: string;
  gitRoot: string;       // Mother repo path
  branch?: string;       // Current branch (if any)
  status: "claimed" | "available";
  sessionId?: string;    // Session that owns this worktree (when claimed)
  createdAt: string;
  releasedAt?: string;   // When it became available
}

interface WorktreeRegistry {
  worktrees: WorktreeEntry[];
}

function loadRegistry(): WorktreeRegistry {
  try {
    if (existsSync(REGISTRY_FILE)) {
      return JSON.parse(readFileSync(REGISTRY_FILE, "utf8"));
    }
  } catch {}
  return { worktrees: [] };
}

function saveRegistry(registry: WorktreeRegistry): void {
  const dir = join(homedir(), ".openui");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  atomicWriteJson(REGISTRY_FILE, registry);
}

/**
 * Claim an available worktree for the given git root.
 * Returns the worktree path if found, null otherwise.
 * The worktree is marked as "claimed" with the given sessionId.
 */
export function claim(gitRoot: string, sessionId: string): string | null {
  const registry = loadRegistry();

  // Find an available worktree for this repo, prefer most recently released
  const available = registry.worktrees
    .filter(w => w.gitRoot === gitRoot && w.status === "available")
    .sort((a, b) => (b.releasedAt || "").localeCompare(a.releasedAt || ""));

  for (const entry of available) {
    // Validate it still exists on disk
    const gitFile = join(entry.path, ".git");
    if (!existsSync(gitFile)) {
      log(`\x1b[38;5;141m[worktree-registry]\x1b[0m Stale entry, removing: ${entry.path}`);
      registry.worktrees = registry.worktrees.filter(w => w.path !== entry.path);
      continue;
    }

    // Claim it
    entry.status = "claimed";
    entry.sessionId = sessionId;
    saveRegistry(registry);
    log(`\x1b[38;5;141m[worktree-registry]\x1b[0m Claimed existing worktree: ${entry.path}`);
    return entry.path;
  }

  saveRegistry(registry); // Save any stale removals
  return null;
}

/**
 * Assign a branch to a claimed worktree.
 * Fetches the base branch, then creates a new local branch.
 */
export async function assignBranch(
  worktreePath: string,
  branchName: string,
  baseBranch: string,
  gitRoot: string,
): Promise<{ success: boolean; branchName: string; error?: string }> {
  // Resolve the base ref (handles origin/<branch>, default branch detection, local fallback)
  const baseRef = await resolveBaseRef(baseBranch, gitRoot);

  // Fetch to ensure we have latest
  await gitAsync(["fetch", "origin", baseBranch], worktreePath, 15);

  // Detach HEAD first to free any existing branch
  await gitAsync(["checkout", "--detach"], worktreePath, 10);

  // Delete the branch if it exists locally (from a previous use of this worktree)
  await gitAsync(["branch", "-D", branchName], worktreePath, 5);

  // Create and checkout new branch
  const result = await gitAsync(["checkout", "-b", branchName, baseRef], worktreePath, 30);
  if (result.exitCode !== 0) {
    return { success: false, branchName, error: result.stderr };
  }

  // Update registry
  const registry = loadRegistry();
  const entry = registry.worktrees.find(w => w.path === worktreePath);
  if (entry) {
    entry.branch = branchName;
    saveRegistry(registry);
  }

  log(`\x1b[38;5;141m[worktree-registry]\x1b[0m Assigned branch ${branchName} from ${baseRef} to ${worktreePath}`);
  return { success: true, branchName };
}

/**
 * Register a newly created worktree as claimed.
 */
export function register(worktreePath: string, gitRoot: string, sessionId: string, branch?: string): void {
  const registry = loadRegistry();

  // Don't double-register
  if (registry.worktrees.some(w => w.path === worktreePath)) return;

  registry.worktrees.push({
    path: worktreePath,
    gitRoot,
    branch,
    status: "claimed",
    sessionId,
    createdAt: new Date().toISOString(),
  });

  saveRegistry(registry);
  log(`\x1b[38;5;141m[worktree-registry]\x1b[0m Registered new worktree: ${worktreePath}`);
}

/**
 * Release a worktree (mark as available for reuse).
 * Called when an agent is archived or deleted.
 * Prunes excess available worktrees beyond the limit.
 */
export function release(worktreePath: string): void {
  if (!worktreePath) return;

  const registry = loadRegistry();
  const entry = registry.worktrees.find(w => w.path === worktreePath);

  if (!entry) {
    log(`\x1b[38;5;141m[worktree-registry]\x1b[0m Release: worktree not in registry: ${worktreePath}`);
    return;
  }

  entry.status = "available";
  entry.sessionId = undefined;
  entry.releasedAt = new Date().toISOString();
  saveRegistry(registry);

  log(`\x1b[38;5;141m[worktree-registry]\x1b[0m Released worktree: ${worktreePath}`);

  // Prune excess available worktrees for this repo
  prune(entry.gitRoot);
}

/**
 * Prune available worktrees for a repo down to the limit.
 * Deletes the oldest available worktrees that exceed MAX_AVAILABLE_PER_REPO.
 */
function prune(gitRoot: string): void {
  const registry = loadRegistry();
  const available = registry.worktrees
    .filter(w => w.gitRoot === gitRoot && w.status === "available")
    .sort((a, b) => (a.releasedAt || a.createdAt).localeCompare(b.releasedAt || b.createdAt));

  const excess = available.length - MAX_AVAILABLE_PER_REPO;
  if (excess <= 0) return;

  const toDelete = available.slice(0, excess);
  for (const entry of toDelete) {
    log(`\x1b[38;5;141m[worktree-registry]\x1b[0m Pruning worktree: ${entry.path}`);
    try {
      // Remove the worktree directory
      if (existsSync(entry.path)) {
        rmSync(entry.path, { recursive: true, force: true });
      }
      // Remove from git worktree list
      gitAsync(["worktree", "prune"], gitRoot, 10).catch(() => {});
    } catch (e) {
      log(`\x1b[38;5;141m[worktree-registry]\x1b[0m Failed to prune ${entry.path}:`, e);
    }
    registry.worktrees = registry.worktrees.filter(w => w.path !== entry.path);
  }

  saveRegistry(registry);
  log(`\x1b[38;5;141m[worktree-registry]\x1b[0m Pruned ${toDelete.length} worktrees for ${gitRoot}`);
}

/**
 * Create a fresh worktree with progress reporting.
 * Used when no available worktree exists in the registry.
 * Returns the worktree path.
 */
export async function createFresh(params: {
  gitRoot: string;
  sessionId: string;
  onProgress?: (percent: number, phase: string) => void;
}): Promise<{ path: string; error?: string }> {
  const { gitRoot, sessionId, onProgress } = params;
  const repoName = basename(gitRoot);
  const worktreesDir = join(gitRoot, "..", `${repoName}-worktrees`);

  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
  }

  // Generate unique directory name
  const id = `pool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const worktreePath = join(worktreesDir, id);

  onProgress?.(0, "Creating worktree");

  // Step 1: Create worktree with --no-checkout --detach (instant)
  const addResult = await gitAsync(
    ["worktree", "add", "--no-checkout", "--detach", worktreePath, "HEAD"],
    gitRoot,
    30,
  );
  if (addResult.exitCode !== 0) {
    return { path: "", error: addResult.stderr };
  }

  onProgress?.(5, "Checking out files");

  // Step 2: Checkout with progress parsing
  const proc = Bun.spawn(
    ["git", "-C", worktreePath, "checkout", "--progress", "HEAD"],
    { stdout: "pipe", stderr: "pipe" },
  );

  // Parse stderr for progress: "Checking out files: N% (xxx/yyy)"
  const stderrReader = proc.stderr.getReader();
  let stderrText = "";
  const readProgress = async () => {
    try {
      while (true) {
        const { done, value } = await stderrReader.read();
        if (done) break;
        const chunk = new TextDecoder().decode(value);
        stderrText += chunk;

        const match = chunk.match(/(\d+)%/);
        if (match) {
          const pct = parseInt(match[1], 10);
          // Map 0-100% checkout to 5-95% overall
          onProgress?.(5 + Math.round(pct * 0.9), "Checking out files");
        }
      }
    } catch {}
  };

  await Promise.all([readProgress(), proc.exited]);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    // Cleanup failed worktree
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch {}
    await gitAsync(["worktree", "prune"], gitRoot, 10);
    return { path: "", error: stderrText || "Checkout failed" };
  }

  onProgress?.(100, "Ready");

  // Register in the registry
  register(worktreePath, gitRoot, sessionId);

  return { path: worktreePath };
}

/**
 * Remove a worktree from the registry entirely (for when the directory was
 * already deleted externally, e.g., user deleted it manually).
 */
export function unregister(worktreePath: string): void {
  const registry = loadRegistry();
  registry.worktrees = registry.worktrees.filter(w => w.path !== worktreePath);
  saveRegistry(registry);
}

/**
 * Cleanup on shutdown: run git worktree prune for all known repos.
 */
export async function cleanup(): Promise<void> {
  const registry = loadRegistry();
  const repos = new Set(registry.worktrees.map(w => w.gitRoot));
  for (const repo of repos) {
    try {
      await gitAsync(["worktree", "prune"], repo, 10);
    } catch {}
  }
  log(`\x1b[38;5;141m[worktree-registry]\x1b[0m Cleanup: pruned worktree refs for ${repos.size} repos`);
}

/**
 * Get registry stats (for debugging/API).
 */
export function getStats(): { total: number; available: number; claimed: number; byRepo: Record<string, { available: number; claimed: number }> } {
  const registry = loadRegistry();
  const byRepo: Record<string, { available: number; claimed: number }> = {};

  for (const w of registry.worktrees) {
    if (!byRepo[w.gitRoot]) byRepo[w.gitRoot] = { available: 0, claimed: 0 };
    if (w.status === "available") byRepo[w.gitRoot].available++;
    else byRepo[w.gitRoot].claimed++;
  }

  return {
    total: registry.worktrees.length,
    available: registry.worktrees.filter(w => w.status === "available").length,
    claimed: registry.worktrees.filter(w => w.status === "claimed").length,
    byRepo,
  };
}
