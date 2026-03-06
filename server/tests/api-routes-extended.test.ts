/**
 * Extended API route tests — covers endpoints not exercised by mobile-api.test.ts.
 * Targets: /auto-resume/*, /browse, /sessions?archived, /claude/*, /github/*.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { apiRoutes } from "../routes/api";
import { sessions } from "../services/sessionManager";
import { saveState, loadState } from "../services/persistence";
import type { Session } from "../types";

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
    nodeId: "node-ext-test",
    ...overrides,
  };
}

// --- /auto-resume ---

describe("GET /auto-resume/config", () => {
  it("returns config and sessions array", async () => {
    const res = await apiRoutes.request("/auto-resume/config");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("config");
    expect(data).toHaveProperty("sessionsToResumeCount");
    expect(data).toHaveProperty("sessions");
    expect(Array.isArray(data.sessions)).toBe(true);
  });
});

describe("GET /auto-resume/progress", () => {
  it("returns progress object", async () => {
    const res = await apiRoutes.request("/auto-resume/progress");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("total");
    expect(data).toHaveProperty("completed");
  });
});

// --- /browse ---

describe("GET /browse", () => {
  it("returns directory listing for default path", async () => {
    const res = await apiRoutes.request("/browse");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("current");
    expect(data).toHaveProperty("directories");
    expect(Array.isArray(data.directories)).toBe(true);
  });

  it("expands tilde in path", async () => {
    const res = await apiRoutes.request("/browse?path=~/");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.current).not.toContain("~");
    // Should resolve to actual home directory (works on both macOS and Linux)
    expect(data.current).toBe(require("os").homedir());
  });

  it("returns 400 for nonexistent path", async () => {
    const res = await apiRoutes.request("/browse?path=/nonexistent/xyz/abc");
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data).toHaveProperty("error");
  });

  it("filters dotfiles from listing", async () => {
    const res = await apiRoutes.request("/browse?path=/tmp");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    for (const dir of data.directories) {
      expect(dir.name.startsWith(".")).toBe(false);
    }
  });

  it("returns parent directory", async () => {
    const res = await apiRoutes.request("/browse?path=/usr/local");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.parent).toBe("/usr");
  });
});

// --- /sessions (archived) ---

describe("GET /sessions?archived=true", () => {
  const ARCHIVE_SESSION_ID = "session-archive-ext-test-" + Date.now();

  beforeAll(() => {
    // Create and save an archived session
    sessions.set(ARCHIVE_SESSION_ID, makeSession({
      archived: true,
      customName: "Archived Test",
      nodeId: "node-archived-ext",
    }));
    saveState(sessions);
    // Remove from Map to simulate archived state
    sessions.delete(ARCHIVE_SESSION_ID);
  });

  afterAll(() => {
    // Clean up
    sessions.delete(ARCHIVE_SESSION_ID);
    saveState(sessions);
  });

  it("returns archived sessions from state.json", async () => {
    const res = await apiRoutes.request("/sessions?archived=true");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(Array.isArray(data)).toBe(true);
    // Find our test session
    const found = data.find((s: any) => s.sessionId === ARCHIVE_SESSION_ID);
    if (found) {
      expect(found.status).toBe("disconnected");
      expect(found.customName).toBe("Archived Test");
      expect(found.nodeId).toBe("node-archived-ext");
      expect(found.isRestored).toBe(false);
    }
  });

  it("archived sessions include expected fields", async () => {
    const res = await apiRoutes.request("/sessions?archived=true");
    const data = await res.json() as any;
    if (data.length > 0) {
      const session = data[0];
      expect(session).toHaveProperty("sessionId");
      expect(session).toHaveProperty("nodeId");
      expect(session).toHaveProperty("agentId");
      expect(session).toHaveProperty("agentName");
      expect(session).toHaveProperty("status");
    }
  });
});

// --- /sessions (active) ---

describe("GET /sessions (active)", () => {
  it("returns active sessions from Map", async () => {
    const res = await apiRoutes.request("/sessions");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(Array.isArray(data)).toBe(true);
  });
});

// --- /claude/conversations ---

describe("GET /claude/conversations", () => {
  it("returns conversations array", async () => {
    const res = await apiRoutes.request("/claude/conversations");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("conversations");
    expect(Array.isArray(data.conversations)).toBe(true);
  });

  it("accepts query parameter", async () => {
    const res = await apiRoutes.request("/claude/conversations?q=test");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("conversations");
  });

  it("accepts limit parameter", async () => {
    const res = await apiRoutes.request("/claude/conversations?limit=5");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.conversations.length).toBeLessThanOrEqual(5);
  });

  it("accepts projectPath parameter", async () => {
    const res = await apiRoutes.request("/claude/conversations?projectPath=/some/path");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("conversations");
  });

  it("conversations have expected shape", async () => {
    const res = await apiRoutes.request("/claude/conversations");
    const data = await res.json() as any;
    if (data.conversations.length > 0) {
      const conv = data.conversations[0];
      expect(conv).toHaveProperty("sessionId");
      expect(conv).toHaveProperty("firstPrompt");
      expect(conv).toHaveProperty("messageCount");
      expect(conv).toHaveProperty("created");
      expect(conv).toHaveProperty("modified");
      expect(conv).toHaveProperty("projectPath");
      expect(conv).toHaveProperty("fileExists");
    }
  });
});

// --- /claude/projects ---

describe("GET /claude/projects", () => {
  it("returns projects array", async () => {
    const res = await apiRoutes.request("/claude/projects");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(Array.isArray(data)).toBe(true);
  });

  it("each project has dirName and originalPath", async () => {
    const res = await apiRoutes.request("/claude/projects");
    const data = await res.json() as any;
    if (data.length > 0) {
      expect(data[0]).toHaveProperty("dirName");
      expect(data[0]).toHaveProperty("originalPath");
    }
  });
});

// --- /claude/conversations/:sessionId/context ---

describe("GET /claude/conversations/:id/context", () => {
  it("returns empty summary for nonexistent session", async () => {
    const res = await apiRoutes.request("/claude/conversations/nonexistent-session-xyz/context");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("summary");
    expect(data.summary).toBe("");
  });
});

// --- /github routes ---

describe("GET /github/issues", () => {
  it("returns 400 when owner and repo missing (no repoUrl)", async () => {
    const res = await apiRoutes.request("/github/issues");
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain("owner and repo are required");
  });

  it("returns 400 for invalid repoUrl", async () => {
    const res = await apiRoutes.request("/github/issues?repoUrl=not-a-url");
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain("Invalid GitHub URL");
  });

  it("accepts owner and repo params", async () => {
    // This will try to fetch real GitHub issues — may fail with rate limit
    const res = await apiRoutes.request("/github/issues?owner=test&repo=test");
    // We just check it didn't return 400 (parameter validation passed)
    expect(res.status).not.toBe(400);
  });

  it("parses valid repoUrl and fetches issues", async () => {
    const res = await apiRoutes.request("/github/issues?repoUrl=https://github.com/octocat/Hello-World");
    // Should not return 400 — the URL parsing succeeds
    // May return 200 (with issues) or 500 (rate limited)
    expect(res.status).not.toBe(400);
  });
});

describe("GET /github/search", () => {
  it("returns 400 when owner/repo missing", async () => {
    const res = await apiRoutes.request("/github/search?q=test");
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain("owner and repo are required");
  });

  it("returns 400 when query missing", async () => {
    const res = await apiRoutes.request("/github/search?owner=test&repo=test");
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain("Search query");
  });
});

describe("GET /github/issue/:owner/:repo/:number", () => {
  it("returns 400 for non-numeric issue number", async () => {
    const res = await apiRoutes.request("/github/issue/test/test/abc");
    expect(res.status).toBe(400);
    const data = await res.json() as any;
    expect(data.error).toContain("Invalid issue number");
  });
});

// --- /migrate/canvases ---

describe("POST /migrate/canvases", () => {
  it("returns migration result", async () => {
    const res = await apiRoutes.request("/migrate/canvases", { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data).toHaveProperty("migrated");
    expect(data).toHaveProperty("canvasCount");
  });
});
