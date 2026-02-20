/**
 * Route coverage tests — exercises code paths that need mocked PTY, GitHub, and
 * conversation index services. Uses mock.module to intercept dependencies.
 */

import { mock, describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Session } from "../types";

// ─── Shared mock state ────────────────────────────────────────────────────────

const mockPtyInstances: any[] = [];
let mockSessionFilePath: string | null = null;
let mockGithubShouldFail = false;
let mockSearchShouldFail = false;

// ─── Mock bun-pty ─────────────────────────────────────────────────────────────

mock.module("bun-pty", () => ({
  spawn: (...args: any[]) => {
    const inst = {
      args,
      _writes: [] as string[],
      _killed: false,
      _dataCallback: null as ((data: string) => void) | null,
      write(data: string) { (this as any)._writes.push(data); },
      kill() { (this as any)._killed = true; },
      onData(cb: (data: string) => void) { (this as any)._dataCallback = cb; },
      resize() {},
    };
    mockPtyInstances.push(inst);
    return inst;
  },
}));

// ─── Mock GitHub service ──────────────────────────────────────────────────────

mock.module("../services/github", () => ({
  fetchGitHubIssues: async (_owner: string, _repo: string) => {
    if (mockGithubShouldFail) throw new Error("API rate limit");
    return [{ number: 1, title: "Test issue", state: "open" }];
  },
  fetchGitHubIssue: async (_owner: string, _repo: string, number: number) => {
    if (number === 999) return null;
    return { number, title: `Issue #${number}`, state: "open" };
  },
  searchGitHubIssues: async (_owner: string, _repo: string, q: string) => {
    if (mockSearchShouldFail) throw new Error("Search failed");
    return [{ number: 1, title: `Search: ${q}`, state: "open" }];
  },
  parseGitHubUrl: (url: string) => {
    const m = url.match(/github\.com\/([^\/]+)\/([^\/\?#]+)/);
    return m ? { owner: m[1], repo: m[2] } : null;
  },
}));

// ─── Mock conversationIndex ───────────────────────────────────────────────────

mock.module("../services/conversationIndex", () => ({
  searchConversations: (_params: any) => [
    {
      sessionId: "conv-1",
      slug: "test-conv",
      summary: "Test conversation",
      firstPrompt: "Hello",
      messageCount: 5,
      projectPath: "/workspace",
      created: "2024-01-01",
      modified: "2024-01-02",
      gitBranch: "main",
      fileExists: true,
    },
  ],
  getClaudeProjects: () => [
    { dirName: "test-project", originalPath: "/workspace/test" },
  ],
  getSessionFilePath: (_sessionId: string) => mockSessionFilePath,
  ensureIndex: () => {},
  extractContent: () => "",
  detectToolNoise: () => false,
  sanitizeFtsQuery: (q: string) => `"${q}"*`,
}));

// ─── Dynamic imports (after mocks) ───────────────────────────────────────────

let apiRoutes: any;
let sessions: Map<string, Session>;

const TEST_TMP = join(tmpdir(), `openui-routes-${Date.now()}`);

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    pty: null,
    agentId: "claude",
    agentName: "Claude Code",
    command: "claude",
    cwd: "/tmp",
    createdAt: new Date().toISOString(),
    clients: new Set(),
    outputBuffer: [],
    status: "idle",
    lastOutputTime: Date.now(),
    lastInputTime: 0,
    recentOutputSize: 0,
    nodeId: "node-test",
    ...overrides,
  };
}

// Track sessions created during tests for cleanup
const testSessionIds: string[] = [];

beforeEach(async () => {
  mockPtyInstances.length = 0;
  mockGithubShouldFail = false;
  mockSearchShouldFail = false;
  mockSessionFilePath = null;

  if (!existsSync(TEST_TMP)) mkdirSync(TEST_TMP, { recursive: true });

  const api = await import("../routes/api");
  apiRoutes = api.apiRoutes;

  const sm = await import("../services/sessionManager");
  sessions = sm.sessions;
});

afterEach(() => {
  for (const id of testSessionIds) {
    sessions.delete(id);
  }
  testSessionIds.length = 0;
});

afterAll(() => {
  if (existsSync(TEST_TMP)) rmSync(TEST_TMP, { recursive: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GitHub route handlers
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /github/issues", () => {
  it("returns issues for owner/repo params", async () => {
    const res = await apiRoutes.request("/github/issues?owner=test&repo=myrepo");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].number).toBe(1);
  });

  it("returns issues for repoUrl param", async () => {
    const res = await apiRoutes.request(
      "/github/issues?repoUrl=" + encodeURIComponent("https://github.com/owner/repo")
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("returns 400 for invalid repoUrl", async () => {
    const res = await apiRoutes.request(
      "/github/issues?repoUrl=" + encodeURIComponent("https://not-github.com/foo")
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when service throws", async () => {
    mockGithubShouldFail = true;
    const res = await apiRoutes.request("/github/issues?owner=test&repo=myrepo");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("rate limit");
  });
});

describe("GET /github/search", () => {
  it("returns search results", async () => {
    const res = await apiRoutes.request("/github/search?owner=test&repo=myrepo&q=bug");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].title).toContain("Search: bug");
  });

  it("returns 400 for missing owner/repo", async () => {
    const res = await apiRoutes.request("/github/search?q=bug");
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing query", async () => {
    const res = await apiRoutes.request("/github/search?owner=test&repo=myrepo");
    expect(res.status).toBe(400);
  });

  it("returns 500 when search fails", async () => {
    mockSearchShouldFail = true;
    const res = await apiRoutes.request("/github/search?owner=test&repo=myrepo&q=bug");
    expect(res.status).toBe(500);
  });
});

describe("GET /github/issue/:owner/:repo/:number", () => {
  it("returns single issue", async () => {
    const res = await apiRoutes.request("/github/issue/owner/repo/42");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.number).toBe(42);
    expect(body.title).toBe("Issue #42");
  });

  it("returns 400 for invalid number", async () => {
    const res = await apiRoutes.request("/github/issue/owner/repo/abc");
    expect(res.status).toBe(400);
  });

  it("returns 404 when issue not found", async () => {
    const res = await apiRoutes.request("/github/issue/owner/repo/999");
    expect(res.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Claude conversation route handlers
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /claude/conversations", () => {
  it("returns conversations list", async () => {
    const res = await apiRoutes.request("/claude/conversations");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations).toBeDefined();
    expect(body.conversations.length).toBeGreaterThan(0);
    expect(body.conversations[0].sessionId).toBe("conv-1");
  });

  it("passes query params through", async () => {
    const res = await apiRoutes.request("/claude/conversations?q=test&projectPath=/workspace&limit=10");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.conversations).toBeDefined();
  });
});

describe("GET /claude/projects", () => {
  it("returns projects list", async () => {
    const res = await apiRoutes.request("/claude/projects");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].dirName).toBe("test-project");
    expect(body[0].originalPath).toBe("/workspace/test");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Context summary endpoint
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /claude/conversations/:sessionId/context", () => {
  it("returns empty summary when no session file", async () => {
    mockSessionFilePath = null;
    const res = await apiRoutes.request("/claude/conversations/no-session/context");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe("");
  });

  it("returns empty summary when file does not exist", async () => {
    mockSessionFilePath = "/nonexistent/path/session.jsonl";
    const res = await apiRoutes.request("/claude/conversations/missing-file/context");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe("");
  });

  it("returns fallback summary when no API key", async () => {
    // Create a test JSONL file with realistic conversation data
    const testJsonlPath = join(TEST_TMP, "test-context-session.jsonl");
    const jsonlContent = [
      JSON.stringify({
        type: "user",
        message: { content: "Help me fix the authentication bug in the login system" },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{
            type: "text",
            text: "I found the issue in the OAuth callback handler. The redirect URI uses HTTP instead of HTTPS in production. Let me fix that for you by updating the configuration.",
          }],
        },
      }),
    ].join("\n");
    writeFileSync(testJsonlPath, jsonlContent);
    mockSessionFilePath = testJsonlPath;

    // Temporarily unset API key to hit the fallback path
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const res = await apiRoutes.request("/claude/conversations/test-ctx/context");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should return fallback from last turn (truncated to 200 chars)
    expect(body.summary.length).toBeGreaterThan(0);
    expect(body.summary.length).toBeLessThanOrEqual(200);

    // Restore
    if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
  });

  it("returns empty when all turns are too short", async () => {
    const testJsonlPath = join(TEST_TMP, "short-session.jsonl");
    const jsonlContent = [
      JSON.stringify({ type: "user", message: { content: "hi" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "hello" }] } }),
    ].join("\n");
    writeFileSync(testJsonlPath, jsonlContent);
    mockSessionFilePath = testJsonlPath;

    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const res = await apiRoutes.request("/claude/conversations/short/context");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toBe("");

    if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
  });

  it("skips system/hook noise lines", async () => {
    const testJsonlPath = join(TEST_TMP, "noise-session.jsonl");
    const jsonlContent = [
      JSON.stringify({ type: "user", message: { content: "[system: internal] configuration update for the session management module" } }),
      JSON.stringify({ type: "user", message: { content: "Please refactor the database connection pooling to support read replicas" } }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [{
            type: "text",
            text: "I will refactor the database connection pooling module to support read replicas. Here is my plan for the implementation changes needed.",
          }],
        },
      }),
    ].join("\n");
    writeFileSync(testJsonlPath, jsonlContent);
    mockSessionFilePath = testJsonlPath;

    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const res = await apiRoutes.request("/claude/conversations/noise/context");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should have skipped the system line, returned the assistant response as fallback
    expect(body.summary.length).toBeGreaterThan(0);

    if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /sessions (create with mock PTY)
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /sessions — creates session with mock PTY", () => {
  it("creates session and returns IDs", async () => {
    const res = await apiRoutes.request("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "claude",
        agentName: "Claude Code",
        command: "claude",
        cwd: "/tmp",
        nodeId: "node-create-test",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBeTruthy();
    expect(body.nodeId).toBe("node-create-test");
    expect(body.cwd).toBe("/tmp");

    // Session should be in the Map
    expect(sessions.has(body.sessionId)).toBe(true);
    testSessionIds.push(body.sessionId);

    // Mock PTY should have been spawned
    expect(mockPtyInstances.length).toBeGreaterThanOrEqual(1);
  });

  it("creates session with custom name and color", async () => {
    const res = await apiRoutes.request("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "claude",
        agentName: "Claude Code",
        command: "claude",
        cwd: "/tmp",
        nodeId: "node-custom-test",
        customName: "My Agent",
        customColor: "#FF0000",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    testSessionIds.push(body.sessionId);

    const session = sessions.get(body.sessionId);
    expect(session?.customName).toBe("My Agent");
    expect(session?.customColor).toBe("#FF0000");
  });

  it("creates session with ticket info", async () => {
    const res = await apiRoutes.request("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "claude",
        agentName: "Claude Code",
        command: "claude",
        cwd: "/tmp",
        nodeId: "node-ticket-test",
        ticketId: "PROJ-123",
        ticketTitle: "Fix login bug",
        ticketUrl: "https://linear.app/proj/PROJ-123",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    testSessionIds.push(body.sessionId);

    const session = sessions.get(body.sessionId);
    expect(session?.ticketId).toBe("PROJ-123");
    expect(session?.ticketTitle).toBe("Fix login bug");
    expect(session?.ticketUrl).toBe("https://linear.app/proj/PROJ-123");
  });

  it("creates session with branch name", async () => {
    const res = await apiRoutes.request("/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "claude",
        agentName: "Claude Code",
        command: "claude",
        cwd: "/tmp",
        nodeId: "node-branch-test",
        branchName: "feature/test-branch",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    testSessionIds.push(body.sessionId);
    expect(body.gitBranch).toBe("feature/test-branch");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /sessions/:id/fork (success paths with mock PTY)
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /sessions/:id/fork — success paths", () => {
  const FORK_SESSION_ID = "session-fork-success-test";

  beforeEach(() => {
    sessions.set(FORK_SESSION_ID, makeSession({
      agentId: "claude",
      agentName: "Claude Code",
      command: "claude",
      cwd: "/tmp",
      claudeSessionId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      nodeId: "node-fork-parent",
      canvasId: "canvas-default",
      customName: "Parent Agent",
    }));
    testSessionIds.push(FORK_SESSION_ID);
  });

  it("forks a claude session successfully", async () => {
    const res = await apiRoutes.request(`/sessions/${FORK_SESSION_ID}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        position: { x: 300, y: 200 },
        canvasId: "canvas-default",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBeTruthy();
    expect(body.nodeId).toBeTruthy();
    expect(body.agentId).toBe("claude");
    expect(body.agentName).toBe("Claude Code");
    expect(body.customName).toContain("fork");

    // Clean up forked session
    testSessionIds.push(body.sessionId);
  });

  it("forks with custom name and color", async () => {
    const res = await apiRoutes.request(`/sessions/${FORK_SESSION_ID}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customName: "My Fork",
        customColor: "#00FF00",
        cwd: "/tmp",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.customName).toBe("My Fork");
    expect(body.customColor).toBe("#00FF00");

    testSessionIds.push(body.sessionId);
  });

  it("forks with branch name and PR number", async () => {
    const res = await apiRoutes.request(`/sessions/${FORK_SESSION_ID}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchName: "feature/forked",
        prNumber: "42",
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gitBranch).toBe("feature/forked");

    testSessionIds.push(body.sessionId);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /sessions/:id/restart (success with mock PTY)
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /sessions/:id/restart — success path", () => {
  const RESTART_SESSION_ID = "session-restart-success-test";

  beforeEach(() => {
    sessions.set(RESTART_SESSION_ID, makeSession({
      status: "disconnected",
      pty: null,
      command: "claude",
      claudeSessionId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    }));
    testSessionIds.push(RESTART_SESSION_ID);
  });

  it("restarts a disconnected session", async () => {
    const res = await apiRoutes.request(`/sessions/${RESTART_SESSION_ID}/restart`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE /canvases/:id — edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("DELETE /canvases/:id — edge cases", () => {
  it("successfully deletes empty canvas", async () => {
    const canvasId = `canvas-empty-delete-${Date.now()}`;
    await apiRoutes.request("/canvases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: canvasId,
        name: "Empty Canvas",
        color: "#0000FF",
        order: 98,
        createdAt: new Date().toISOString(),
      }),
    });

    const deleteRes = await apiRoutes.request(`/canvases/${canvasId}`, {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /sessions?archived=true — cover the map callback
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /sessions?archived=true — mapping coverage", () => {
  it("returns array response for archived query", async () => {
    // The archived query path is exercised even if no archived nodes exist
    const res = await apiRoutes.request("/sessions?archived=true");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // Each item should have the correct shape if any exist
    for (const item of body) {
      expect(item.sessionId).toBeDefined();
      expect(item.status).toBe("disconnected");
      expect(item.isRestored).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// /status-update — remaining edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /status-update — branch detection and edge cases", () => {
  const STATUS_SESSION_ID = "session-status-branch-test";

  beforeEach(() => {
    sessions.set(STATUS_SESSION_ID, makeSession({
      status: "running",
      cwd: "/tmp", // Not a git repo — getGitBranch returns null
      _lastBranchCheck: 0,
    } as any));
    testSessionIds.push(STATUS_SESSION_ID);
  });

  it("triggers branch detection when throttle expired", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    (session as any)._lastBranchCheck = 0; // Force expired throttle

    const res = await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "running",
        openuiSessionId: STATUS_SESSION_ID,
        hookEvent: "UserPromptSubmit",
      }),
    });
    expect(res.status).toBe(200);
    // Branch check should have been updated
    expect((session as any)._lastBranchCheck).toBeGreaterThan(0);
  });

  it("SessionStart + openuiSessionId signals ready", async () => {
    const res = await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "running",
        openuiSessionId: STATUS_SESSION_ID,
        hookEvent: "SessionStart",
      }),
    });
    expect(res.status).toBe(200);
  });

  it("pre_tool non-long-running sets permission timeout", async () => {
    const res = await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "pre_tool",
        openuiSessionId: STATUS_SESSION_ID,
        toolName: "Read",
      }),
    });
    expect(res.status).toBe(200);

    const session = sessions.get(STATUS_SESSION_ID)!;
    // Should have a permission timeout set (for non-Bash/Task tools)
    expect(session.permissionTimeout).toBeDefined();
    // Clean up timeout
    if (session.permissionTimeout) clearTimeout(session.permissionTimeout);
    session.permissionTimeout = undefined;
  });

  it("pre_tool sets long-running timeout", async () => {
    const res = await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "pre_tool",
        openuiSessionId: STATUS_SESSION_ID,
        toolName: "Edit",
      }),
    });
    expect(res.status).toBe(200);

    const session = sessions.get(STATUS_SESSION_ID)!;
    expect(session.longRunningTimeout).toBeDefined();
    // Clean up timeout
    if (session.longRunningTimeout) clearTimeout(session.longRunningTimeout);
    session.longRunningTimeout = undefined;
    if (session.permissionTimeout) clearTimeout(session.permissionTimeout);
    session.permissionTimeout = undefined;
  });

  it("post_tool clears long-running timeout and flag", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "running";
    session.longRunningTool = true;
    session.longRunningTimeout = setTimeout(() => {}, 999999) as any;
    session.preToolTime = Date.now();

    const res = await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "post_tool",
        openuiSessionId: STATUS_SESSION_ID,
        toolName: "Read",
      }),
    });
    expect(res.status).toBe(200);
    expect(session.longRunningTool).toBe(false);
    expect(session.longRunningTimeout).toBeUndefined();
  });

  it("other status clears currentTool when not tool_calling", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.currentTool = "Read";
    session.preToolTime = Date.now();
    session.permissionTimeout = setTimeout(() => {}, 999999) as any;
    session.longRunningTimeout = setTimeout(() => {}, 999999) as any;

    const res = await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "idle",
        openuiSessionId: STATUS_SESSION_ID,
        hookEvent: "Stop",
      }),
    });
    expect(res.status).toBe(200);
    expect(session.currentTool).toBeUndefined();
    expect(session.preToolTime).toBeUndefined();
    expect(session.permissionTimeout).toBeUndefined();
    expect(session.longRunningTimeout).toBeUndefined();
  });

  it("updates cwd when hook provides different cwd", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    expect(session.cwd).toBe("/tmp");

    const res = await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "running",
        openuiSessionId: STATUS_SESSION_ID,
        cwd: "/workspace/project",
      }),
    });
    expect(res.status).toBe(200);
    expect(session.cwd).toBe("/workspace/project");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /state/positions — cover session position update in memory
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /state/positions — in-memory update", () => {
  const POS_SESSION_ID = "session-position-update-test";

  beforeEach(() => {
    sessions.set(POS_SESSION_ID, makeSession({
      nodeId: "node-pos-update",
      canvasId: "canvas-a",
    }));
    testSessionIds.push(POS_SESSION_ID);
  });

  it("updates session position and canvasId in memory", async () => {
    const res = await apiRoutes.request("/state/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        positions: {
          "node-pos-update": { x: 500, y: 300, canvasId: "canvas-b" },
        },
      }),
    });
    expect(res.status).toBe(200);

    const session = sessions.get(POS_SESSION_ID)!;
    expect(session.position).toEqual({ x: 500, y: 300 });
    expect(session.canvasId).toBe("canvas-b");
  });
});
