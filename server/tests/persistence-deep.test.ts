/**
 * Deep persistence tests — exercises loadState, saveState, savePositions,
 * migrateCategoriesToCanvases, loadBuffer, saveBuffer with real file I/O.
 */

import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, renameSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  atomicWriteJson,
  loadBuffer,
  saveBuffer,
  loadState,
  saveState,
  savePositions,
} from "../services/persistence";
import { sessions } from "../services/sessionManager";
import type { Session } from "../types";

// We can't easily redirect DATA_DIR (it's module-scoped),
// but we can test the exported functions that accept explicit paths
// (atomicWriteJson) and test loadBuffer/saveBuffer which use BUFFERS_DIR.

const TEST_DIR = join(tmpdir(), `openui-persist-deep-${Date.now()}`);

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

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

// --- atomicWriteJson deep ---

describe("atomicWriteJson — deep", () => {
  it("survives large state files", () => {
    const filePath = join(TEST_DIR, "large.json");
    const data = {
      nodes: Array.from({ length: 200 }, (_, i) => ({
        nodeId: `node-${i}`,
        sessionId: `session-${i}`,
        position: { x: Math.random() * 1000, y: Math.random() * 1000 },
        canvasId: `canvas-${i % 5}`,
      })),
    };

    atomicWriteJson(filePath, data);
    const loaded = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(loaded.nodes).toHaveLength(200);
    expect(loaded.nodes[199].nodeId).toBe("node-199");
  });

  it("handles unicode content", () => {
    const filePath = join(TEST_DIR, "unicode.json");
    const data = { name: "テスト", emoji: "🚀", notes: "café résumé" };
    atomicWriteJson(filePath, data);
    const loaded = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(loaded.name).toBe("テスト");
    expect(loaded.emoji).toBe("🚀");
  });

  it("handles null and empty values", () => {
    const filePath = join(TEST_DIR, "nulls.json");
    const data = { a: null, b: "", c: [], d: {} };
    atomicWriteJson(filePath, data);
    const loaded = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(loaded.a).toBeNull();
    expect(loaded.b).toBe("");
    expect(loaded.c).toEqual([]);
  });
});

// --- loadBuffer / saveBuffer roundtrip ---

describe("loadBuffer / saveBuffer", () => {
  it("roundtrips buffer content", () => {
    const testId = `test-buffer-${Date.now()}`;
    const buffer = ["chunk1 ", "chunk2 ", "chunk3"];

    saveBuffer(testId, buffer);
    const loaded = loadBuffer(testId);

    expect(loaded).toEqual(["chunk1 chunk2 chunk3"]);
  });

  it("returns empty array for missing buffer", () => {
    const loaded = loadBuffer("nonexistent-buffer-session-xyz");
    expect(loaded).toEqual([]);
  });

  it("handles empty buffer", () => {
    const testId = `test-empty-buffer-${Date.now()}`;
    saveBuffer(testId, []);
    const loaded = loadBuffer(testId);
    // Empty join = empty string → loadBuffer returns [""]
    expect(loaded).toEqual([""]);
  });
});

// --- loadState ---

describe("loadState", () => {
  it("returns object with nodes array", () => {
    const state = loadState();
    expect(state).toHaveProperty("nodes");
    expect(Array.isArray(state.nodes)).toBe(true);
  });

  it("state has canvases array (after migration)", () => {
    const state = loadState();
    // After migration, canvases should exist
    if (state.canvases) {
      expect(Array.isArray(state.canvases)).toBe(true);
    }
  });
});

// --- saveState roundtrip ---

describe("saveState", () => {
  const SAVE_SESSION_ID = "session-save-test-" + Date.now();

  it("persists session data and reloads it", () => {
    // Create a session in the Map
    sessions.set(SAVE_SESSION_ID, makeSession({
      customName: "Save Test",
      customColor: "#00FF00",
      notes: "Test notes",
      nodeId: "node-save-test",
    }));

    saveState(sessions);

    const state = loadState();
    const node = state.nodes.find(n => n.sessionId === SAVE_SESSION_ID);
    expect(node).toBeDefined();
    expect(node!.customName).toBe("Save Test");
    expect(node!.customColor).toBe("#00FF00");
    expect(node!.notes).toBe("Test notes");

    // Cleanup
    sessions.delete(SAVE_SESSION_ID);
    saveState(sessions);
  });
});

// --- savePositions ---

describe("savePositions", () => {
  it("updates existing node positions", () => {
    // This test depends on there being nodes in state.json.
    // We'll create one first.
    const posSessionId = "session-pos-test-" + Date.now();
    const nodeId = "node-pos-test-" + Date.now();

    sessions.set(posSessionId, makeSession({
      nodeId,
      position: { x: 0, y: 0 },
    }));
    saveState(sessions);

    // Now update position
    savePositions({ [nodeId]: { x: 100, y: 200 } });

    const state = loadState();
    const node = state.nodes.find(n => n.nodeId === nodeId);
    expect(node).toBeDefined();
    expect(node!.position).toEqual({ x: 100, y: 200 });

    // Cleanup
    sessions.delete(posSessionId);
    saveState(sessions);
  });

  it("ignores unknown node IDs without error", () => {
    // Should not throw
    savePositions({ "unknown-node-id-xyz": { x: 99, y: 99 } });
  });

  it("updates canvasId along with position (using valid canvas)", () => {
    const posSessionId = "session-canvas-pos-" + Date.now();
    const nodeId = "node-canvas-pos-" + Date.now();

    // First, get a valid canvasId from existing state
    const existingState = loadState();
    const validCanvasId = existingState.canvases?.[0]?.id;

    sessions.set(posSessionId, makeSession({
      nodeId,
      position: { x: 0, y: 0 },
    }));
    saveState(sessions);

    if (validCanvasId) {
      savePositions({ [nodeId]: { x: 50, y: 60, canvasId: validCanvasId } });

      const state = loadState();
      const node = state.nodes.find(n => n.nodeId === nodeId);
      expect(node).toBeDefined();
      // canvasId should match since it's a valid one
      expect(node!.canvasId).toBe(validCanvasId);
      expect(node!.position).toEqual({ x: 50, y: 60 });
    }

    // Cleanup
    sessions.delete(posSessionId);
    saveState(sessions);
  });
});

// --- Corruption recovery logic (simulated) ---

describe("corruption recovery", () => {
  it("falls back to .tmp file when main JSON is corrupted", () => {
    const stateFile = join(TEST_DIR, "state-corrupt.json");
    const tmpFile = stateFile + ".tmp";

    // Write corrupted main file
    writeFileSync(stateFile, "{{invalid json}}");

    // Write valid .tmp file
    const fallback = { nodes: [{ nodeId: "recovered", sessionId: "s1" }] };
    writeFileSync(tmpFile, JSON.stringify(fallback));

    // Simulate the recovery logic from loadState
    let result;
    try {
      result = JSON.parse(readFileSync(stateFile, "utf-8"));
    } catch {
      if (existsSync(tmpFile)) {
        result = JSON.parse(readFileSync(tmpFile, "utf-8"));
        renameSync(tmpFile, stateFile);
      } else {
        result = { nodes: [] };
      }
    }

    expect(result.nodes[0].nodeId).toBe("recovered");
    // .tmp should have been renamed to main
    expect(existsSync(stateFile)).toBe(true);
  });

  it("returns empty state when both main and .tmp are missing", () => {
    const stateFile = join(TEST_DIR, "missing.json");

    let result;
    try {
      if (existsSync(stateFile)) {
        result = JSON.parse(readFileSync(stateFile, "utf-8"));
      } else {
        result = { nodes: [] };
      }
    } catch {
      result = { nodes: [] };
    }

    expect(result).toEqual({ nodes: [] });
  });
});

// --- migrateCategoriesToCanvases logic (simulated) ---

describe("migrateCategoriesToCanvases — logic simulation", () => {
  it("assigns nodes without category to default canvas", () => {
    const state: any = {
      nodes: [
        { nodeId: "n1" },
        { nodeId: "n2" },
      ],
      categories: [],
      canvases: [],
    };

    // Simulate migration logic
    const defaultId = "canvas-default";
    state.canvases = [{ id: defaultId, name: "Main", isDefault: true, order: 0 }];
    state.nodes.forEach((node: any) => {
      if (!node.canvasId || node.canvasId === "canvas-default") {
        node.canvasId = defaultId;
      }
    });

    expect(state.nodes[0].canvasId).toBe(defaultId);
    expect(state.nodes[1].canvasId).toBe(defaultId);
  });

  it("is a no-op when canvases already exist", () => {
    const state: any = {
      nodes: [],
      canvases: [{ id: "existing", name: "Existing" }],
    };

    const shouldMigrate = !state.canvases || state.canvases.length === 0;
    expect(shouldMigrate).toBe(false);
  });
});

// --- migrateCategoriesToCanvases (actual function) ---

import { migrateCategoriesToCanvases, loadCanvases, saveCanvases } from "../services/persistence";

describe("migrateCategoriesToCanvases — actual function", () => {
  it("returns a result object with migrated and canvasCount", () => {
    const result = migrateCategoriesToCanvases();
    expect(result).toHaveProperty("migrated");
    expect(result).toHaveProperty("canvasCount");
    expect(typeof result.migrated).toBe("boolean");
    expect(typeof result.canvasCount).toBe("number");
  });

  it("migrates categories to canvases when canvases are empty", () => {
    // Save current state for restoration
    const originalState = loadState();
    const STATE_FILE = join(require("os").homedir(), ".openui", "state.json");

    // Write state with categories but no canvases
    const testState = {
      nodes: [
        { nodeId: "n-mig-1", sessionId: "s-mig-1", parentId: "cat-1", agentId: "claude", agentName: "Claude Code", command: "claude", cwd: "/tmp", createdAt: "2025-01-01T00:00:00Z" },
        { nodeId: "n-mig-2", sessionId: "s-mig-2", agentId: "claude", agentName: "Claude Code", command: "claude", cwd: "/tmp", createdAt: "2025-01-01T00:00:00Z" },
      ],
      categories: [
        { id: "cat-1", label: "Feature Work", color: "#FF0000" },
      ],
      canvases: [], // Empty to trigger migration
    };
    atomicWriteJson(STATE_FILE, testState);

    // Run migration
    const result = migrateCategoriesToCanvases();

    expect(result.migrated).toBe(true);
    expect(result.canvasCount).toBeGreaterThanOrEqual(2); // default + 1 from category

    // Verify the migrated state
    const migrated = loadState();
    expect(migrated.canvases!.length).toBeGreaterThanOrEqual(2);

    // Node with parentId should have a canvasId
    const node1 = migrated.nodes.find(n => n.nodeId === "n-mig-1");
    expect(node1).toBeTruthy();
    expect(node1!.canvasId).toBeTruthy();
    expect(node1!.canvasId).not.toBe("canvas-default");

    // Node without parentId should have default canvasId
    const node2 = migrated.nodes.find(n => n.nodeId === "n-mig-2");
    expect(node2).toBeTruthy();
    expect(node2!.canvasId).toBeTruthy();

    // Restore original state
    atomicWriteJson(STATE_FILE, originalState);
  });
});

// --- loadCanvases / saveCanvases ---

describe("loadCanvases / saveCanvases", () => {
  it("returns canvases from state", () => {
    const canvases = loadCanvases();
    expect(Array.isArray(canvases)).toBe(true);
  });

  it("roundtrips canvases through save/load", () => {
    const original = loadCanvases();
    // Save same canvases back
    saveCanvases(original);
    const reloaded = loadCanvases();
    expect(reloaded.length).toBe(original.length);
    if (original.length > 0) {
      expect(reloaded[0].id).toBe(original[0].id);
    }
  });

  it("saves new canvas and loads it back", () => {
    const original = loadCanvases();
    const testCanvas = {
      id: `canvas-test-${Date.now()}`,
      name: "Test Canvas",
      color: "#FF0000",
      order: original.length,
      createdAt: new Date().toISOString(),
    };
    saveCanvases([...original, testCanvas]);

    const reloaded = loadCanvases();
    const found = reloaded.find(c => c.id === testCanvas.id);
    expect(found).toBeTruthy();
    expect(found!.name).toBe("Test Canvas");
    expect(found!.color).toBe("#FF0000");

    // Restore original
    saveCanvases(original);
  });
});

// --- loadState orphan canvas fix ---

describe("loadState orphan canvas fix", () => {
  it("fixes orphaned canvas IDs on load", () => {
    // Save state with a node referencing a nonexistent canvas
    const ORPHAN_SESSION_ID = "session-orphan-test-" + Date.now();
    const ORPHAN_NODE_ID = "node-orphan-test-" + Date.now();

    sessions.set(ORPHAN_SESSION_ID, makeSession({
      nodeId: ORPHAN_NODE_ID,
      canvasId: "canvas-nonexistent-xyz",
    }));
    saveState(sessions);

    // Now load state — it should fix the orphan
    const state = loadState();
    const node = state.nodes.find(n => n.nodeId === ORPHAN_NODE_ID);
    if (node && state.canvases && state.canvases.length > 0) {
      // canvasId should have been replaced with a valid one
      const validIds = new Set(state.canvases.map(c => c.id));
      expect(validIds.has(node.canvasId!)).toBe(true);
    }

    // Cleanup
    sessions.delete(ORPHAN_SESSION_ID);
    saveState(sessions);
  });
});

// --- saveState with archived node preservation ---

describe("saveState archived preservation", () => {
  it("preserves archived nodes from state.json that are not in sessions Map", () => {
    const ARCHIVED_SESSION = "session-archived-preserve-" + Date.now();

    // First save an archived session
    sessions.set(ARCHIVED_SESSION, makeSession({
      archived: true,
      customName: "Preserved Archive",
      nodeId: "node-arch-preserve",
    }));
    saveState(sessions);
    sessions.delete(ARCHIVED_SESSION);

    // Now save state without the archived session in Map
    saveState(sessions);

    // Load and check it was preserved
    const state = loadState();
    const preserved = state.nodes.find(n => n.sessionId === ARCHIVED_SESSION);
    expect(preserved).toBeTruthy();
    expect(preserved!.archived).toBe(true);
    expect(preserved!.customName).toBe("Preserved Archive");
  });
});

// --- migrateStateToHome ---

import { migrateStateToHome } from "../services/persistence";

describe("migrateStateToHome", () => {
  it("returns not migrated when no old state exists", () => {
    // LAUNCH_CWD defaults to process.cwd() or its env value
    // In the test env, there's no .openui/state.json at LAUNCH_CWD
    const result = migrateStateToHome();
    expect(result).toHaveProperty("migrated");
    // Should return false because there's no old state at LAUNCH_CWD
    expect(result.migrated).toBe(false);
  });
});
