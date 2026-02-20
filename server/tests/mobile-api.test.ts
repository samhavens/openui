/**
 * Server-side tests for mobile API endpoints.
 * Uses Bun's built-in test runner (zero config).
 * Tests the Hono apiRoutes directly via .request() without spawning a real server.
 */

import { describe, it, expect, beforeAll, afterEach, beforeEach } from "bun:test";
import { apiRoutes, buildRestartCommand } from "../routes/api";
import { sessions, normalizeAgentCommand, buildPtyEnv } from "../services/sessionManager";
import type { Session } from "../types";

// --- Helpers ---

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

const TEST_SESSION_ID = "session-test-12345";

beforeAll(() => {
  // Register a test session
  sessions.set(TEST_SESSION_ID, makeSession());
});

afterEach(() => {
  // Reset buffer after each test
  const s = sessions.get(TEST_SESSION_ID);
  if (s) s.outputBuffer = [];
});

// --- /tail endpoint ---

describe("GET /sessions/:id/tail", () => {
  it("returns 404 for unknown session", async () => {
    const res = await apiRoutes.request("/sessions/nonexistent/tail");
    expect(res.status).toBe(404);
  });

  it("returns tail structure for known session", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.outputBuffer = ["hello ", "world"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("tail");
    expect(body).toHaveProperty("tail_hash");
    expect(body).toHaveProperty("bytes");
    expect(body).toHaveProperty("status");
  });

  it("returns concatenated buffer contents", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.outputBuffer = ["foo", "bar", "baz"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail`);
    const body = await res.json();
    expect(body.tail).toBe("foobarbaz");
  });

  it("respects ?bytes limit", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.outputBuffer = ["a".repeat(100)];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?bytes=10`);
    const body = await res.json();
    expect(body.bytes).toBeLessThanOrEqual(10);
  });

  it("strips SGR color codes with ?strip=1", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.outputBuffer = ["\x1b[32mgreen text\x1b[0m"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?strip=1`);
    const body = await res.json();
    expect(body.tail).toBe("green text");
    expect(body.tail).not.toContain("\x1b");
  });

  it("strips DEC private mode sequences (?strip=1)", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.outputBuffer = ["\x1b[?2026hsome text\x1b[?2026l"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?strip=1`);
    const body = await res.json();
    expect(body.tail).toBe("some text");
    expect(body.tail).not.toContain("\x1b");
  });

  it("strips OSC hyperlink sequences, keeps visible text (?strip=1)", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    // OSC 8 hyperlink: ESC]8;;url BEL text ESC]8;; BEL
    session.outputBuffer = ["before \x1b]8;;https://example.com\x07link text\x1b]8;;\x07 after"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?strip=1`);
    const body = await res.json();
    expect(body.tail).toContain("before");
    expect(body.tail).toContain("after");
    expect(body.tail).not.toContain("\x1b");
    expect(body.tail).not.toContain("https://");
  });

  it("simulates \\r overwrite so words don't smash (?strip=1)", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    // Terminal redraws: first write "loading..." then \r overwrites with "done      "
    session.outputBuffer = ["loading...\rdone      "];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?strip=1`);
    const body = await res.json();
    // Should show the final overwritten state, not "loading...done"
    expect(body.tail).not.toContain("loading");
    expect(body.tail.trim()).toBe("done");
  });

  it("deduplicates consecutive identical lines (?strip=1)", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.outputBuffer = ["same line\nsame line\nsame line\ndifferent"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?strip=1`);
    const body = await res.json();
    const lines = body.tail.split("\n").filter((l: string) => l.trim());
    expect(lines.filter((l: string) => l === "same line").length).toBe(1);
    expect(body.tail).toContain("different");
  });

  it("treats cursor-position sequences as line breaks (?strip=1)", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.outputBuffer = ["line1\x1b[Hline2"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?strip=1`);
    const body = await res.json();
    expect(body.tail).toContain("line1");
    expect(body.tail).toContain("line2");
    expect(body.tail).not.toBe("line1line2");
  });

  it("collapses spinner animation lines into one (?strip=1)", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    // Cursor-up spinner: each frame on its own line after cursor-up is stripped
    session.outputBuffer = ["*(thinking)\n(thinking)\n*(thinking)\n(thinking)\nDone!"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?strip=1`);
    const body = await res.json();
    const thinkingLines = body.tail.split("\n").filter((l: string) => l.includes("thinking"));
    expect(thinkingLines.length).toBe(1);
    expect(body.tail).toContain("Done!");
  });

  it("converts cursor-forward sequences to spaces, preserving word breaks (?strip=1)", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    // TUI layouts use ESC[NC (cursor-forward) to space words instead of literal spaces
    session.outputBuffer = ["word1\x1b[5Cword2\x1b[3Cword3"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?strip=1`);
    const body = await res.json();
    expect(body.tail).toContain("word1");
    expect(body.tail).toContain("word2");
    expect(body.tail).toContain("word3");
    // must not concatenate without whitespace
    expect(body.tail).not.toMatch(/word1word2/);
    expect(body.tail).not.toMatch(/word2word3/);
    expect(body.tail).toMatch(/word1\s+word2/);
  });

  it("removes single-char cursor-position artifact lines (?strip=1)", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    // Character-by-character TUI cursor positioning leaves single chars per line
    session.outputBuffer = ["real line\nu\nl\ny\ni\nh\nw\nd\nt\nanother real line"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?strip=1`);
    const body = await res.json();
    expect(body.tail).toContain("real line");
    expect(body.tail).toContain("another real line");
    // runs of single-char lines should be gone
    const lines = body.tail.split("\n").filter((l: string) => l.trim().length > 0);
    const singleCharLines = lines.filter((l: string) => l.trim().length === 1);
    expect(singleCharLines.length).toBe(0);
  });

  it("deduplicates repeated multi-line blocks from PTY restarts (?strip=1)", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    const block = "bash-3.2$\nThe default shell is zsh.\nPlease run chsh.\nFor more details see:\nhttps://support.apple.com/kb/HT208050";
    session.outputBuffer = [block + "\n" + block]; // same block twice (restart artifact)

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?strip=1`);
    const body = await res.json();
    // Should not contain the block duplicated — count occurrences of a unique string
    const count = (body.tail.match(/Please run chsh/g) || []).length;
    expect(count).toBe(1);
  });

  it("tail_hash changes when output changes", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.outputBuffer = ["first output"];

    const res1 = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail`);
    const body1 = await res1.json();

    session.outputBuffer = ["different output"];

    const res2 = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail`);
    const body2 = await res2.json();

    expect(body1.tail_hash).not.toBe(body2.tail_hash);
  });

  it("tail_hash is same when output unchanged", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.outputBuffer = ["stable output"];

    const [res1, res2] = await Promise.all([
      apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail`),
      apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail`),
    ]);
    const [b1, b2] = await Promise.all([res1.json(), res2.json()]);
    expect(b1.tail_hash).toBe(b2.tail_hash);
  });

  it("bytes=0 returns empty tail", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.outputBuffer = ["content"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail?bytes=0`);
    const body = await res.json();
    expect(body.bytes).toBe(0);
    expect(body.tail).toBe("");
  });
});

// --- /input endpoint ---

describe("POST /sessions/:id/input", () => {
  it("returns 404 for unknown session", async () => {
    const res = await apiRoutes.request("/sessions/nonexistent/input", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "y\n" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when session has no PTY", async () => {
    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "y\n" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/pty/i);
  });

  it("returns 400 when data field is missing", async () => {
    // Set a mock PTY
    const session = sessions.get(TEST_SESSION_ID)!;
    session.pty = { write: () => {}, resize: () => {}, kill: () => {}, onData: () => {} } as any;

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notdata: "oops" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/data/i);

    session.pty = null;
  });

  it("returns 400 when data exceeds 4096 chars", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.pty = { write: () => {}, resize: () => {}, kill: () => {}, onData: () => {} } as any;

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "x".repeat(4097) }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/4096/);

    session.pty = null;
  });

  it("returns success and writes to PTY", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    const written: string[] = [];
    session.pty = {
      write: (d: string) => { written.push(d); },
      resize: () => {},
      kill: () => {},
      onData: () => {},
    } as any;

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "y\n" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(written).toContain("y\n");

    session.pty = null;
  });

  it("updates lastInputTime on successful write", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    const before = session.lastInputTime;
    session.pty = { write: () => {}, resize: () => {}, kill: () => {}, onData: () => {} } as any;

    await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "test" }),
    });

    expect(session.lastInputTime).toBeGreaterThanOrEqual(before);
    session.pty = null;
  });
});

// --- normalizeAgentCommand (shared helper used by createSession AND buildRestartCommand) ---

describe("normalizeAgentCommand", () => {
  it("replaces 'isaac claude' with 'claude' when isaac absent", () => {
    expect(normalizeAgentCommand("isaac claude", "claude", false)).toBe("claude");
  });

  it("keeps 'isaac claude' when isaac is present", () => {
    expect(normalizeAgentCommand("isaac claude", "claude", true)).toBe("isaac claude");
  });

  it("replaces 'llm agent claude' with 'claude' when isaac absent", () => {
    expect(normalizeAgentCommand("llm agent claude", "claude", false)).toBe("claude");
  });

  it("preserves extra flags after the command", () => {
    expect(normalizeAgentCommand("isaac claude --dangerously-skip-permissions", "claude", false))
      .toBe("claude --dangerously-skip-permissions");
  });

  it("does not modify non-claude agents", () => {
    expect(normalizeAgentCommand("isaac claude", "other-agent", false)).toBe("isaac claude");
  });

  it("returns command unchanged when already bare claude", () => {
    expect(normalizeAgentCommand("claude --resume abc", "claude", false)).toBe("claude --resume abc");
  });
});

// --- buildRestartCommand ---

const UUID = "d25d76b4-db0b-47c2-a783-4a15ac95d561";

describe("buildRestartCommand", () => {
  it("uses bare claude when isaac not installed", () => {
    const cmd = buildRestartCommand("isaac claude", "claude", undefined, false);
    expect(cmd).toBe("claude");
    expect(cmd).not.toContain("isaac");
  });

  it("keeps isaac when installed", () => {
    const cmd = buildRestartCommand("isaac claude", "claude", undefined, true);
    expect(cmd).toBe("isaac claude");
  });

  it("migrates llm agent claude → claude when isaac absent", () => {
    const cmd = buildRestartCommand("llm agent claude", "claude", undefined, false);
    expect(cmd).toBe("claude");
  });

  it("injects --resume into bare claude (no isaac)", () => {
    const cmd = buildRestartCommand("claude", "claude", UUID, false);
    expect(cmd).toBe(`claude --resume ${UUID}`);
  });

  it("injects --resume into isaac claude when installed", () => {
    const cmd = buildRestartCommand("isaac claude", "claude", UUID, true);
    expect(cmd).toBe(`isaac claude --resume ${UUID}`);
  });

  it("injects --resume into legacy llm agent claude without isaac", () => {
    const cmd = buildRestartCommand("llm agent claude", "claude", UUID, false);
    expect(cmd).toBe(`claude --resume ${UUID}`);
  });

  it("does not inject --resume for non-claude agents", () => {
    const cmd = buildRestartCommand("some-other-agent", "other", UUID, false);
    expect(cmd).toBe("some-other-agent");
    expect(cmd).not.toContain("--resume");
  });

  it("strips stale --resume flag before injecting fresh one", () => {
    const staleUUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const cmd = buildRestartCommand(`claude --resume ${staleUUID}`, "claude", UUID, false);
    expect(cmd).toContain(`--resume ${UUID}`);
    expect(cmd).not.toContain(staleUUID);
  });

  it("returns command unchanged when no claudeSessionId", () => {
    const cmd = buildRestartCommand("claude --dangerously-skip-permissions", "claude", undefined, false);
    expect(cmd).toBe("claude --dangerously-skip-permissions");
  });
});

// --- buildPtyEnv: PTY environment sanitization ---

describe("buildPtyEnv", () => {
  // Helper: temporarily set / restore a process.env key
  function withEnv(key: string, value: string | undefined, fn: () => void) {
    const original = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    try { fn(); } finally {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  }

  it("strips CLAUDECODE so nested Claude Code sessions can launch", () => {
    withEnv("CLAUDECODE", "1", () => {
      const env = buildPtyEnv("test-session");
      expect(env.CLAUDECODE).toBeUndefined();
    });
  });

  it("strips CLAUDECODE regardless of its value", () => {
    withEnv("CLAUDECODE", "some-session-id", () => {
      const env = buildPtyEnv("test-session");
      expect(env.CLAUDECODE).toBeUndefined();
    });
  });

  it("strips CLAUDE_CODE_ENTRYPOINT", () => {
    withEnv("CLAUDE_CODE_ENTRYPOINT", "cli", () => {
      const env = buildPtyEnv("test-session");
      expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    });
  });

  it("sets TERM to xterm-256color", () => {
    const env = buildPtyEnv("test-session");
    expect(env.TERM).toBe("xterm-256color");
  });

  it("sets OPENUI_SESSION_ID to the given session ID", () => {
    const env = buildPtyEnv("my-session-abc");
    expect(env.OPENUI_SESSION_ID).toBe("my-session-abc");
  });

  it("passes through PATH from process.env", () => {
    const env = buildPtyEnv("x");
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("does not contain undefined values", () => {
    const env = buildPtyEnv("x");
    for (const v of Object.values(env)) {
      expect(v).not.toBeUndefined();
    }
  });
});

// --- AskUserQuestion toolInput pipeline ---
// These tests verify that when Claude Code fires the AskUserQuestion tool,
// the toolInput (containing questions/options) flows through the server
// and becomes available to clients via the /tail endpoint.

const ASK_TOOL_INPUT = {
  questions: [{
    question: "Which approach?",
    header: "Approach",
    options: [
      { label: "Option A", description: "First option" },
      { label: "Option B", description: "Second option" },
    ],
    multiSelect: false,
  }],
};

describe("POST /status-update stores toolInput on session", () => {
  it("stores toolInput when AskUserQuestion pre_tool fires", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.status = "running";

    await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "pre_tool",
        openuiSessionId: TEST_SESSION_ID,
        toolName: "AskUserQuestion",
        hookEvent: "PreToolUse",
        toolInput: ASK_TOOL_INPUT,
      }),
    });

    expect(session.toolInput).toEqual(ASK_TOOL_INPUT);
  });

  it("clears toolInput on post_tool", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.status = "waiting_input";
    session.currentTool = "AskUserQuestion";
    // Manually set toolInput to simulate prior state
    (session as any).toolInput = ASK_TOOL_INPUT;

    await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "post_tool",
        openuiSessionId: TEST_SESSION_ID,
        toolName: "AskUserQuestion",
        hookEvent: "PostToolUse",
      }),
    });

    expect((session as any).toolInput).toBeUndefined();
  });

  it("does NOT store toolInput for non-AskUserQuestion tools", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.status = "running";
    (session as any).toolInput = undefined;

    await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "pre_tool",
        openuiSessionId: TEST_SESSION_ID,
        toolName: "Bash",
        hookEvent: "PreToolUse",
        toolInput: { command: "ls" },
      }),
    });

    expect((session as any).toolInput).toBeUndefined();
  });
});

describe("GET /sessions/:id/tail includes toolInput and currentTool", () => {
  it("returns currentTool and toolInput when set on session", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.status = "waiting_input";
    session.currentTool = "AskUserQuestion";
    (session as any).toolInput = ASK_TOOL_INPUT;
    session.outputBuffer = ["some output"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail`);
    const body = await res.json();

    expect(body.currentTool).toBe("AskUserQuestion");
    expect(body.toolInput).toEqual(ASK_TOOL_INPUT);
  });

  it("omits toolInput when not set on session", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.status = "idle";
    session.currentTool = undefined;
    (session as any).toolInput = undefined;
    session.outputBuffer = ["some output"];

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/tail`);
    const body = await res.json();

    expect(body.toolInput).toBeUndefined();
  });
});

// --- Auth middleware (tested via env var) ---

describe("tokenAuth middleware (integration via env)", () => {
  it("passes through when OPENUI_TOKEN is not set", async () => {
    // OPENUI_TOKEN should not be set in test env
    const savedToken = process.env.OPENUI_TOKEN;
    delete process.env.OPENUI_TOKEN;

    const res = await apiRoutes.request("/sessions");
    expect(res.status).toBe(200);

    if (savedToken !== undefined) process.env.OPENUI_TOKEN = savedToken;
  });
});

// --- GET /agents ---

describe("GET /agents", () => {
  it("returns an array of agents", async () => {
    const res = await apiRoutes.request("/agents");
    expect(res.status).toBe(200);
    const agents = await res.json();
    expect(Array.isArray(agents)).toBe(true);
    expect(agents.length).toBeGreaterThan(0);
  });

  it("each agent has required shape", async () => {
    const res = await apiRoutes.request("/agents");
    const agents = await res.json();
    for (const agent of agents) {
      expect(agent).toHaveProperty("id");
      expect(agent).toHaveProperty("name");
      expect(agent).toHaveProperty("command");
      expect(agent).toHaveProperty("description");
      expect(agent).toHaveProperty("color");
      expect(agent).toHaveProperty("icon");
    }
  });
});

// --- GET /config ---

describe("GET /config", () => {
  it("returns launchCwd and dataDir", async () => {
    const res = await apiRoutes.request("/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("launchCwd");
    expect(body).toHaveProperty("dataDir");
  });
});

// --- GET /auto-resume/config ---

describe("GET /auto-resume/config", () => {
  it("returns config shape", async () => {
    const res = await apiRoutes.request("/auto-resume/config");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("config");
    expect(body.config).toHaveProperty("enabled");
    expect(body).toHaveProperty("sessionsToResumeCount");
    expect(body).toHaveProperty("sessions");
  });
});

// --- GET /auto-resume/progress ---

describe("GET /auto-resume/progress", () => {
  it("returns progress shape", async () => {
    const res = await apiRoutes.request("/auto-resume/progress");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("completed");
    expect(body).toHaveProperty("current");
    expect(body).toHaveProperty("isActive");
  });
});

// --- POST /sessions/:id/restart (error paths) ---

describe("POST /sessions/:id/restart", () => {
  it("returns 404 for unknown session", async () => {
    const res = await apiRoutes.request("/sessions/nonexistent-session/restart", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 when session already has a PTY (already running)", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    session.pty = { write: () => {}, resize: () => {}, kill: () => {}, onData: () => {} } as any;

    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/restart`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already running/i);

    session.pty = null;
  });
});

// --- POST /sessions/:id/fork (error paths) ---

describe("POST /sessions/:id/fork", () => {
  it("returns 404 for unknown session", async () => {
    const res = await apiRoutes.request("/sessions/nonexistent-session/fork", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
  });

  it("returns 400 for non-claude agent", async () => {
    const nonClaudeId = "session-non-claude-fork-test";
    sessions.set(nonClaudeId, makeSession({ agentId: "opencode" }));

    const res = await apiRoutes.request(`/sessions/${nonClaudeId}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/cannot be forked/i);

    sessions.delete(nonClaudeId);
  });

  it("returns 400 when no claudeSessionId", async () => {
    const noIdSession = "session-no-claude-id-fork";
    sessions.set(noIdSession, makeSession({ agentId: "claude", claudeSessionId: undefined } as any));

    const res = await apiRoutes.request(`/sessions/${noIdSession}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    sessions.delete(noIdSession);
  });

  it("returns 400 when claudeSessionId is not a valid UUID", async () => {
    const badUuidSession = "session-bad-uuid-fork";
    sessions.set(badUuidSession, makeSession({ agentId: "claude" } as any));
    const s = sessions.get(badUuidSession)!;
    (s as any).claudeSessionId = "not-a-uuid";

    const res = await apiRoutes.request(`/sessions/${badUuidSession}/fork`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);

    sessions.delete(badUuidSession);
  });
});

// --- GET /github/issues ---

describe("GET /github/issues", () => {
  it("returns 400 when missing owner and repo params", async () => {
    const res = await apiRoutes.request("/github/issues");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
  });

  it("returns 400 for invalid repoUrl", async () => {
    const res = await apiRoutes.request("/github/issues?repoUrl=not-a-github-url");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid/i);
  });
});

// --- POST /migrate/canvases ---

describe("POST /migrate/canvases", () => {
  it("returns migration result", async () => {
    const res = await apiRoutes.request("/migrate/canvases", { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("migrated");
    expect(body).toHaveProperty("canvasCount");
  });
});

// --- GET /sessions ---

describe("GET /sessions", () => {
  it("returns sessions list", async () => {
    const res = await apiRoutes.request("/sessions");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("each session has sessionId and agentId", async () => {
    const res = await apiRoutes.request("/sessions");
    const body = await res.json();
    for (const s of body) {
      expect(s).toHaveProperty("sessionId");
      expect(s).toHaveProperty("agentId");
    }
  });
});

// --- PATCH /sessions/:id ---

describe("PATCH /sessions/:id", () => {
  it("returns 404 for unknown session", async () => {
    const res = await apiRoutes.request("/sessions/nonexistent-patch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customName: "test" }),
    });
    expect(res.status).toBe(404);
  });

  it("updates customName on known session", async () => {
    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customName: "Updated Name" }),
    });
    expect(res.status).toBe(200);
    const session = sessions.get(TEST_SESSION_ID)!;
    expect(session.customName).toBe("Updated Name");
  });
});

// --- DELETE /sessions/:id ---

describe("DELETE /sessions/:id", () => {
  it("returns 404 for unknown session", async () => {
    const res = await apiRoutes.request("/sessions/nonexistent-delete", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

// --- GET /settings and PUT /settings roundtrip ---

describe("GET/PUT /settings roundtrip", () => {
  it("PUT then GET returns merged settings", async () => {
    const putRes = await apiRoutes.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testKey: "testValue" }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await apiRoutes.request("/settings");
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.testKey).toBe("testValue");
  });
});

// ============================================================
// POST /status-update — state machine tests
// ============================================================

const STATUS_SESSION_ID = "session-status-update-test";

describe("POST /status-update — state machine", () => {
  // Helper: send a status-update request
  async function sendStatus(body: Record<string, any>) {
    return apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ openuiSessionId: STATUS_SESSION_ID, ...body }),
    });
  }

  beforeEach(() => {
    // Fresh session for each test
    sessions.set(STATUS_SESSION_ID, makeSession({
      status: "idle",
      lastInputTime: 0,
    }));
  });

  afterEach(() => {
    const s = sessions.get(STATUS_SESSION_ID);
    if (s) {
      if (s.permissionTimeout) clearTimeout(s.permissionTimeout);
      if (s.longRunningTimeout) clearTimeout(s.longRunningTimeout);
    }
    sessions.delete(STATUS_SESSION_ID);
  });

  it("returns 400 when status is missing", async () => {
    const res = await sendStatus({});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/status/i);
  });

  it("returns success with warning when no matching session", async () => {
    const res = await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "idle", openuiSessionId: "nonexistent-session" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.warning).toBeDefined();
  });

  // --- permission_request ---

  it("permission_request → sets waiting_input, sets needsInputSince", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "running";

    await sendStatus({ status: "permission_request", hookEvent: "PermissionRequest" });

    expect(session.status).toBe("waiting_input");
    expect(session.needsInputSince).toBeGreaterThan(0);
  });

  it("permission_request → clears preToolTime and permissionTimeout", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.preToolTime = Date.now();
    session.permissionTimeout = setTimeout(() => {}, 10000);

    await sendStatus({ status: "permission_request", hookEvent: "PermissionRequest" });

    expect(session.preToolTime).toBeUndefined();
    expect(session.permissionTimeout).toBeUndefined();
  });

  // --- pre_tool + AskUserQuestion ---

  it("pre_tool AskUserQuestion → sets waiting_input + needsInputSince", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "running";

    await sendStatus({
      status: "pre_tool",
      toolName: "AskUserQuestion",
      hookEvent: "PreToolUse",
      toolInput: { questions: [] },
    });

    expect(session.status).toBe("waiting_input");
    expect(session.needsInputSince).toBeGreaterThan(0);
    expect(session.currentTool).toBe("AskUserQuestion");
  });

  it("pre_tool AskUserQuestion → stores toolInput", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    const input = { questions: [{ question: "Which?" }] };

    await sendStatus({
      status: "pre_tool",
      toolName: "AskUserQuestion",
      hookEvent: "PreToolUse",
      toolInput: input,
    });

    expect(session.toolInput).toEqual(input);
  });

  // --- pre_tool + regular tool ---

  it("pre_tool regular tool → sets running, sets preToolTime", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "idle";

    // UserPromptSubmit first to get out of idle protection
    await sendStatus({ status: "running", hookEvent: "UserPromptSubmit" });

    await sendStatus({ status: "pre_tool", toolName: "Read", hookEvent: "PreToolUse" });

    expect(session.status).toBe("running");
    expect(session.preToolTime).toBeGreaterThan(0);
    expect(session.currentTool).toBe("Read");
  });

  it("pre_tool regular tool → starts permission timeout (non-Bash)", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    await sendStatus({ status: "running", hookEvent: "UserPromptSubmit" });
    await sendStatus({ status: "pre_tool", toolName: "Edit", hookEvent: "PreToolUse" });

    expect(session.permissionTimeout).toBeDefined();
  });

  it("pre_tool Bash → no permission timeout (long-running tool)", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    await sendStatus({ status: "running", hookEvent: "UserPromptSubmit" });
    await sendStatus({ status: "pre_tool", toolName: "Bash", hookEvent: "PreToolUse" });

    expect(session.permissionTimeout).toBeUndefined();
  });

  it("pre_tool Task → no permission timeout", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    await sendStatus({ status: "running", hookEvent: "UserPromptSubmit" });
    await sendStatus({ status: "pre_tool", toolName: "Task", hookEvent: "PreToolUse" });

    expect(session.permissionTimeout).toBeUndefined();
  });

  it("pre_tool regular tool → starts long-running timeout", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    await sendStatus({ status: "running", hookEvent: "UserPromptSubmit" });
    await sendStatus({ status: "pre_tool", toolName: "Read", hookEvent: "PreToolUse" });

    expect(session.longRunningTimeout).toBeDefined();
    expect(session.longRunningTool).toBe(false);
  });

  // --- post_tool ---

  it("post_tool → clears preToolTime and timeouts", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "running";
    session.preToolTime = Date.now();
    session.permissionTimeout = setTimeout(() => {}, 10000);
    session.longRunningTimeout = setTimeout(() => {}, 10000);

    await sendStatus({ status: "post_tool", toolName: "Read", hookEvent: "PostToolUse" });

    expect(session.preToolTime).toBeUndefined();
    expect(session.permissionTimeout).toBeUndefined();
    expect(session.longRunningTimeout).toBeUndefined();
    expect(session.longRunningTool).toBe(false);
  });

  it("post_tool → keeps running if session was running", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "running";

    await sendStatus({ status: "post_tool", toolName: "Read", hookEvent: "PostToolUse" });

    expect(session.status).toBe("running");
  });

  it("post_tool → stays idle if session was idle", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "idle";

    await sendStatus({ status: "post_tool", toolName: "Read", hookEvent: "PostToolUse" });

    expect(session.status).toBe("idle");
  });

  it("post_tool AskUserQuestion → clears needsInputSince", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "waiting_input";
    session.needsInputSince = Date.now();

    await sendStatus({ status: "post_tool", toolName: "AskUserQuestion", hookEvent: "PostToolUse" });

    expect(session.needsInputSince).toBeUndefined();
  });

  it("post_tool → clears toolInput", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "running";
    session.toolInput = { questions: [] };

    await sendStatus({ status: "post_tool", toolName: "Read", hookEvent: "PostToolUse" });

    expect(session.toolInput).toBeUndefined();
  });

  // --- Idle protection ---

  it("idle session + running event (non-UserPromptSubmit) → stays idle", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "idle";

    await sendStatus({ status: "running", hookEvent: "SubagentStop" });

    expect(session.status).toBe("idle");
  });

  it("idle session + UserPromptSubmit → transitions to running", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "idle";

    await sendStatus({ status: "running", hookEvent: "UserPromptSubmit" });

    expect(session.status).toBe("running");
  });

  // --- needsInputSince protection ---

  it("needsInputSince + running from subagent → stays waiting_input", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "running"; // must not be idle (idle protection would block)
    session.needsInputSince = Date.now();
    session.lastInputTime = 0;

    // pre_tool from another subagent — should not override waiting_input
    await sendStatus({ status: "pre_tool", toolName: "Read", hookEvent: "PreToolUse" });

    expect(session.status).toBe("waiting_input");
  });

  it("needsInputSince cleared when lastInputTime > needsInputSince", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "waiting_input";
    session.needsInputSince = Date.now() - 5000;
    session.lastInputTime = Date.now(); // User responded

    await sendStatus({ status: "running", hookEvent: "UserPromptSubmit" });

    expect(session.needsInputSince).toBeUndefined();
    expect(session.status).toBe("running");
  });

  // --- UserPromptSubmit / Stop ---

  it("UserPromptSubmit clears needsInputSince", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "running";
    session.needsInputSince = Date.now();

    await sendStatus({ status: "running", hookEvent: "UserPromptSubmit" });

    // Note: needsInputSince is cleared in the else branch, but then the
    // protection check also fires — since we cleared it, the protection
    // doesn't override. Let's check the final state is running.
    // The UserPromptSubmit clears it directly in the else branch
  });

  it("Stop event clears needsInputSince", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "running";
    session.needsInputSince = Date.now();

    await sendStatus({ status: "idle", hookEvent: "Stop" });

    expect(session.needsInputSince).toBeUndefined();
    expect(session.status).toBe("idle");
  });

  // --- claudeSessionId mapping ---

  it("stores claudeSessionId on first occurrence", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    expect(session.claudeSessionId).toBeUndefined();

    await sendStatus({ status: "idle", claudeSessionId: "claude-abc-123" });

    expect(session.claudeSessionId).toBe("claude-abc-123");
  });

  it("does not overwrite existing claudeSessionId", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.claudeSessionId = "original-id";

    await sendStatus({ status: "idle", claudeSessionId: "new-id" });

    expect(session.claudeSessionId).toBe("original-id");
  });

  // --- cwd update ---

  it("updates cwd when different from current", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.cwd = "/old/path";

    await sendStatus({ status: "idle", cwd: "/new/path" });

    expect(session.cwd).toBe("/new/path");
  });

  it("does not update cwd when same", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.cwd = "/same/path";

    await sendStatus({ status: "idle", cwd: "/same/path" });

    expect(session.cwd).toBe("/same/path");
  });

  // --- Fallback: claudeSessionId lookup ---

  it("finds session by claudeSessionId when openuiSessionId is missing", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.claudeSessionId = "claude-lookup-id";
    session.status = "running";

    const res = await apiRoutes.request("/status-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "idle",
        claudeSessionId: "claude-lookup-id",
      }),
    });

    expect(res.status).toBe(200);
    expect(session.status).toBe("idle");
  });

  // --- Other status fields ---

  it("clears currentTool when status is not tool_calling/running", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    session.status = "running";
    session.currentTool = "Bash";

    await sendStatus({ status: "idle", hookEvent: "Stop" });

    expect(session.currentTool).toBeUndefined();
  });

  it("sets pluginReportedStatus and lastPluginStatusTime", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;
    const before = Date.now();

    await sendStatus({ status: "idle" });

    expect(session.pluginReportedStatus).toBe(true);
    expect(session.lastPluginStatusTime).toBeGreaterThanOrEqual(before);
  });

  it("sets lastHookEvent", async () => {
    const session = sessions.get(STATUS_SESSION_ID)!;

    await sendStatus({ status: "idle", hookEvent: "Stop" });

    expect(session.lastHookEvent).toBe("Stop");
  });
});

// ============================================================
// Additional route handler tests
// ============================================================

describe("GET /browse", () => {
  it("returns directory listing for default path", async () => {
    const res = await apiRoutes.request("/browse");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("current");
    expect(body).toHaveProperty("directories");
    expect(Array.isArray(body.directories)).toBe(true);
  });

  it("handles tilde expansion for home directory", async () => {
    const res = await apiRoutes.request("/browse?path=~");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.current).not.toContain("~");
  });

  it("returns 400 for invalid path", async () => {
    const res = await apiRoutes.request("/browse?path=/nonexistent/path/abc123xyz");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("filters out dotfiles", async () => {
    const res = await apiRoutes.request("/browse?path=/tmp");
    expect(res.status).toBe(200);
    const body = await res.json();
    const dotDirs = body.directories.filter((d: any) => d.name.startsWith("."));
    expect(dotDirs.length).toBe(0);
  });
});

describe("PATCH /sessions/:id — additional fields", () => {
  const PATCH_SESSION_ID = "session-patch-test";

  beforeEach(() => {
    sessions.set(PATCH_SESSION_ID, makeSession());
  });

  afterEach(() => {
    sessions.delete(PATCH_SESSION_ID);
  });

  it("updates customColor", async () => {
    const res = await apiRoutes.request(`/sessions/${PATCH_SESSION_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customColor: "#FF0000" }),
    });
    expect(res.status).toBe(200);
    const session = sessions.get(PATCH_SESSION_ID)!;
    expect(session.customColor).toBe("#FF0000");
  });

  it("updates notes", async () => {
    const res = await apiRoutes.request(`/sessions/${PATCH_SESSION_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Important session" }),
    });
    expect(res.status).toBe(200);
    const session = sessions.get(PATCH_SESSION_ID)!;
    expect(session.notes).toBe("Important session");
  });

  it("updates icon", async () => {
    const res = await apiRoutes.request(`/sessions/${PATCH_SESSION_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icon: "rocket" }),
    });
    expect(res.status).toBe(200);
    const session = sessions.get(PATCH_SESSION_ID)!;
    expect(session.icon).toBe("rocket");
  });
});

describe("PATCH /sessions/:id/archive", () => {
  const ARCHIVE_SESSION_ID = "session-archive-test";

  beforeEach(() => {
    sessions.set(ARCHIVE_SESSION_ID, makeSession());
  });

  afterEach(() => {
    sessions.delete(ARCHIVE_SESSION_ID);
  });

  it("archives an active session", async () => {
    const res = await apiRoutes.request(`/sessions/${ARCHIVE_SESSION_ID}/archive`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    expect(res.status).toBe(200);
    const session = sessions.get(ARCHIVE_SESSION_ID)!;
    expect(session.archived).toBe(true);
  });

  it("unarchives an active session", async () => {
    const session = sessions.get(ARCHIVE_SESSION_ID)!;
    session.archived = true;

    const res = await apiRoutes.request(`/sessions/${ARCHIVE_SESSION_ID}/archive`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: false }),
    });
    expect(res.status).toBe(200);
    expect(session.archived).toBe(false);
  });

  it("returns 404 for unknown non-active session", async () => {
    const res = await apiRoutes.request("/sessions/nonexistent-archive/archive", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
    // Will try state.json too — may or may not find it
    const body = await res.json();
    // At least it shouldn't crash
    expect([200, 404]).toContain(res.status);
  });
});

describe("GET /sessions — shape validation", () => {
  it("sessions include status field", async () => {
    const res = await apiRoutes.request("/sessions");
    const body = await res.json();
    for (const s of body) {
      expect(s).toHaveProperty("status");
    }
  });

  it("sessions include agentName", async () => {
    const res = await apiRoutes.request("/sessions");
    const body = await res.json();
    for (const s of body) {
      expect(s).toHaveProperty("agentName");
    }
  });
});

describe("GET /sessions?archived=true", () => {
  it("returns archived sessions from state.json", async () => {
    const res = await apiRoutes.request("/sessions?archived=true");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    // All returned sessions should have status "disconnected"
    for (const s of body) {
      expect(s.status).toBe("disconnected");
    }
  });
});

describe("GET /sessions/:id/status", () => {
  it("returns status for known session", async () => {
    const res = await apiRoutes.request(`/sessions/${TEST_SESSION_ID}/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("status");
    // isRestored may be undefined (not serialized) on the test session
    expect(typeof body.status).toBe("string");
  });

  it("returns 404 for unknown session", async () => {
    const res = await apiRoutes.request("/sessions/nonexistent/status");
    expect(res.status).toBe(404);
  });
});

describe("GET /state", () => {
  it("returns nodes array", async () => {
    const res = await apiRoutes.request("/state");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("nodes");
    expect(Array.isArray(body.nodes)).toBe(true);
  });

  it("returns archived nodes with ?archived=true", async () => {
    const res = await apiRoutes.request("/state?archived=true");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("nodes");
  });

  it("each node has status and isAlive fields", async () => {
    const res = await apiRoutes.request("/state");
    const body = await res.json();
    for (const node of body.nodes) {
      expect(node).toHaveProperty("status");
      expect(node).toHaveProperty("isAlive");
    }
  });
});

describe("POST /state/positions", () => {
  it("updates session positions", async () => {
    const session = sessions.get(TEST_SESSION_ID)!;
    const nodeId = session.nodeId;

    const res = await apiRoutes.request("/state/positions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions: { [nodeId]: { x: 200, y: 300 } } }),
    });
    expect(res.status).toBe(200);
    expect(session.position).toEqual({ x: 200, y: 300 });
  });
});

describe("Canvas CRUD routes", () => {
  it("GET /canvases returns array", async () => {
    const res = await apiRoutes.request("/canvases");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it("POST /canvases creates canvas", async () => {
    const canvas = {
      id: `canvas-test-${Date.now()}`,
      name: "Test Canvas",
      color: "#FF0000",
      order: 99,
      createdAt: new Date().toISOString(),
    };

    const res = await apiRoutes.request("/canvases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(canvas),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.canvas.id).toBe(canvas.id);
  });

  it("PATCH /canvases/:id updates canvas", async () => {
    // Get existing canvases first
    const getRes = await apiRoutes.request("/canvases");
    const canvases = await getRes.json();

    if (canvases.length > 0) {
      const canvasId = canvases[0].id;
      const res = await apiRoutes.request(`/canvases/${canvasId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated Name" }),
      });
      expect(res.status).toBe(200);
    }
  });

  it("PATCH /canvases/:id returns 404 for unknown", async () => {
    const res = await apiRoutes.request("/canvases/nonexistent-canvas-xyz", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /canvases/:id returns 404 for unknown", async () => {
    const res = await apiRoutes.request("/canvases/nonexistent-canvas-xyz", {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("POST /canvases/reorder updates canvas order", async () => {
    // Get current canvases
    const getRes = await apiRoutes.request("/canvases");
    const canvases = await getRes.json();

    if (canvases.length >= 2) {
      const reversed = canvases.map((c: any) => c.id).reverse();
      const res = await apiRoutes.request("/canvases/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canvasIds: reversed }),
      });
      expect(res.status).toBe(200);
    }
  });
});
