/**
 * Tests for autoResume.ts — pure config + filtering logic.
 *
 * Mock strategy: We mock the persistence module's loadState function
 * since autoResume.ts imports it directly. We use Bun's module mock.
 */

import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { PersistedNode, PersistedState } from "../types";

// --- Mock persistence ---

let mockState: PersistedState = { nodes: [] };

// Use Bun's module mock
mock.module("../services/persistence", () => ({
  loadState: () => mockState,
}));

// Import AFTER mocking
const { getAutoResumeConfig, getSessionsToResume, shouldAutoResume } = await import(
  "../services/autoResume"
);

// --- Helpers ---

function makeNode(overrides: Partial<PersistedNode> = {}): PersistedNode {
  return {
    nodeId: `node-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: `session-${Math.random().toString(36).slice(2, 8)}`,
    agentId: "claude",
    agentName: "Claude Code",
    command: "claude",
    cwd: "/tmp",
    createdAt: new Date().toISOString(),
    position: { x: 0, y: 0 },
    canvasId: "canvas-default",
    ...overrides,
  };
}

beforeEach(() => {
  mockState = { nodes: [] };
});

// --- getAutoResumeConfig ---

describe("getAutoResumeConfig", () => {
  it("returns config with enabled true by default", () => {
    const config = getAutoResumeConfig();
    expect(config.enabled).toBe(true);
  });

  it("returns config with skipArchived true by default", () => {
    const config = getAutoResumeConfig();
    expect(config.skipArchived).toBe(true);
  });

  it("has numeric startupTimeoutMs", () => {
    const config = getAutoResumeConfig();
    expect(typeof config.startupTimeoutMs).toBe("number");
    expect(config.startupTimeoutMs).toBeGreaterThan(0);
  });
});

// --- getSessionsToResume ---

describe("getSessionsToResume", () => {
  it("returns empty array when no nodes exist", () => {
    mockState = { nodes: [] };
    const sessions = getSessionsToResume();
    expect(sessions).toEqual([]);
  });

  it("returns all non-archived nodes", () => {
    mockState = {
      nodes: [
        makeNode({ archived: false }),
        makeNode({ archived: false }),
      ],
    };
    const sessions = getSessionsToResume();
    expect(sessions).toHaveLength(2);
  });

  it("filters out archived sessions when skipArchived is true", () => {
    mockState = {
      nodes: [
        makeNode({ archived: true }),
        makeNode({ archived: false }),
        makeNode({ archived: true }),
      ],
    };
    const sessions = getSessionsToResume();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].archived).toBeFalsy();
  });

  it("returns nodes without archived flag (undefined treated as non-archived)", () => {
    const node = makeNode();
    delete (node as any).archived;
    mockState = { nodes: [node] };
    const sessions = getSessionsToResume();
    expect(sessions).toHaveLength(1);
  });
});

// --- shouldAutoResume ---

describe("shouldAutoResume", () => {
  it("returns true for non-archived session", () => {
    const node = makeNode({ archived: false });
    expect(shouldAutoResume(node)).toBe(true);
  });

  it("returns false for archived session when skipArchived is true", () => {
    const node = makeNode({ archived: true });
    expect(shouldAutoResume(node)).toBe(false);
  });

  it("returns true for session without archived flag", () => {
    const node = makeNode();
    delete (node as any).archived;
    expect(shouldAutoResume(node)).toBe(true);
  });
});
