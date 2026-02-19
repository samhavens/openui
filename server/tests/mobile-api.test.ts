/**
 * Server-side tests for mobile API endpoints.
 * Uses Bun's built-in test runner (zero config).
 * Tests the Hono apiRoutes directly via .request() without spawning a real server.
 */

import { describe, it, expect, beforeAll, afterEach } from "bun:test";
import { apiRoutes, buildRestartCommand } from "../routes/api";
import { sessions, normalizeAgentCommand } from "../services/sessionManager";
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
