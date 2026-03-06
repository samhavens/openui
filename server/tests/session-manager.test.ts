/**
 * Tests for sessionManager.ts pure/mockable functions.
 * Focuses on exported utilities without spawning PTY processes.
 */

import { describe, it, expect, afterEach } from "bun:test";
import {
  getGitBranch,
  broadcastToSession,
  deleteSession,
  sessions,
  injectPluginDir,
  MAX_BUFFER_SIZE,
} from "../services/sessionManager";
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
    nodeId: "node-test",
    ...overrides,
  };
}

// --- getGitBranch ---

describe("getGitBranch", () => {
  it("returns branch name for a git repo", () => {
    // openui-cicd is a git repo
    const branch = getGitBranch(process.cwd());
    expect(branch).toBeTruthy();
    expect(typeof branch).toBe("string");
  });

  it("returns null for non-git directory", () => {
    const branch = getGitBranch("/tmp");
    expect(branch).toBeNull();
  });

  it("returns null for nonexistent directory", () => {
    const branch = getGitBranch("/nonexistent/path/abc123");
    expect(branch).toBeNull();
  });
});

// --- broadcastToSession ---

describe("broadcastToSession", () => {
  it("sends JSON message to all ready clients", () => {
    const sent: string[] = [];
    const mockClient = {
      readyState: 1,
      send: (data: string) => { sent.push(data); },
    } as any;

    const session = makeSession({ clients: new Set([mockClient]) });
    broadcastToSession(session, { type: "status", status: "running" });

    expect(sent.length).toBe(1);
    const parsed = JSON.parse(sent[0]);
    expect(parsed.type).toBe("status");
    expect(parsed.status).toBe("running");
  });

  it("skips clients with readyState !== 1", () => {
    const sent: string[] = [];
    const closedClient = {
      readyState: 3, // CLOSED
      send: (data: string) => { sent.push(data); },
    } as any;

    const session = makeSession({ clients: new Set([closedClient]) });
    broadcastToSession(session, { type: "output", data: "hello" });

    expect(sent.length).toBe(0);
  });

  it("removes clients that throw on send", () => {
    const badClient = {
      readyState: 1,
      send: () => { throw new Error("connection reset"); },
    } as any;

    const session = makeSession({ clients: new Set([badClient]) });
    broadcastToSession(session, { type: "status", status: "idle" });

    expect(session.clients.size).toBe(0);
  });

  it("handles empty client set", () => {
    const session = makeSession({ clients: new Set() });
    // Should not throw
    broadcastToSession(session, { type: "status", status: "idle" });
  });

  it("broadcasts to multiple clients", () => {
    const sent1: string[] = [];
    const sent2: string[] = [];
    const client1 = { readyState: 1, send: (d: string) => sent1.push(d) } as any;
    const client2 = { readyState: 1, send: (d: string) => sent2.push(d) } as any;

    const session = makeSession({ clients: new Set([client1, client2]) });
    broadcastToSession(session, { type: "output", data: "test" });

    expect(sent1.length).toBe(1);
    expect(sent2.length).toBe(1);
  });
});

// --- deleteSession ---

describe("deleteSession", () => {
  const DEL_SESSION_ID = "session-delete-test";

  afterEach(() => {
    sessions.delete(DEL_SESSION_ID);
  });

  it("removes session from Map", () => {
    sessions.set(DEL_SESSION_ID, makeSession());
    const result = deleteSession(DEL_SESSION_ID);
    expect(result).toBe(true);
    expect(sessions.has(DEL_SESSION_ID)).toBe(false);
  });

  it("returns false for nonexistent session", () => {
    const result = deleteSession("nonexistent-session-xyz");
    expect(result).toBe(false);
  });

  it("kills PTY if present", () => {
    let killed = false;
    const mockPty = {
      kill: () => { killed = true; },
      write: () => {},
      resize: () => {},
      onData: () => {},
    } as any;

    sessions.set(DEL_SESSION_ID, makeSession({ pty: mockPty }));
    deleteSession(DEL_SESSION_ID);
    expect(killed).toBe(true);
  });
});

// --- injectPluginDir ---

describe("injectPluginDir", () => {
  it("returns command unchanged for non-claude agent", () => {
    const result = injectPluginDir("opencode start", "opencode");
    expect(result).toBe("opencode start");
  });

  it("does not double-inject if --plugin-dir already present", () => {
    const cmd = "claude --plugin-dir /some/path";
    const result = injectPluginDir(cmd, "claude");
    // Should not add another --plugin-dir
    const matches = result.match(/--plugin-dir/g) || [];
    expect(matches.length).toBe(1);
  });
});

// --- MAX_BUFFER_SIZE ---

describe("MAX_BUFFER_SIZE constant", () => {
  it("is 1000", () => {
    expect(MAX_BUFFER_SIZE).toBe(1000);
  });
});
