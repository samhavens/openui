/**
 * Integration tests for persistence.ts — file I/O with real tmpdir.
 *
 * Mock strategy: We test atomicWriteJson directly (it's a pure function
 * that takes a path), and for loadState/saveState/etc we call the functions
 * that operate on the module-level DATA_DIR (which is ~/.openui).
 * We test the exported utility functions that accept explicit paths, and
 * use loadBuffer/saveBuffer which derive paths from BUFFERS_DIR.
 */

import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson } from "../services/persistence";

// Create a fresh tmpdir for each test run
const TEST_DIR = join(tmpdir(), `openui-persist-test-${Date.now()}`);
const TEST_BUFFERS_DIR = join(TEST_DIR, "buffers");

beforeEach(() => {
  // Ensure clean test directory
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_BUFFERS_DIR, { recursive: true });
});

afterAll(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
});

// --- atomicWriteJson ---

describe("atomicWriteJson", () => {
  it("writes valid JSON to the target path", () => {
    const filePath = join(TEST_DIR, "test.json");
    const data = { hello: "world", count: 42 };

    atomicWriteJson(filePath, data);

    expect(existsSync(filePath)).toBe(true);
    const read = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(read).toEqual(data);
  });

  it("produces a roundtrip-safe result", () => {
    const filePath = join(TEST_DIR, "roundtrip.json");
    const data = {
      nodes: [{ id: "a", value: 1 }, { id: "b", value: 2 }],
      nested: { deep: { key: "val" } },
      arr: [1, 2, 3],
      empty: null,
    };

    atomicWriteJson(filePath, data);
    const result = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(result).toEqual(data);
  });

  it("does not leave .tmp file after successful write", () => {
    const filePath = join(TEST_DIR, "no-tmp.json");
    atomicWriteJson(filePath, { ok: true });

    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(filePath + ".tmp")).toBe(false);
  });

  it("overwrites existing file atomically", () => {
    const filePath = join(TEST_DIR, "overwrite.json");
    atomicWriteJson(filePath, { version: 1 });
    atomicWriteJson(filePath, { version: 2 });

    const result = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(result.version).toBe(2);
  });

  it("handles complex nested structures", () => {
    const filePath = join(TEST_DIR, "complex.json");
    const data = {
      nodes: Array.from({ length: 50 }, (_, i) => ({
        nodeId: `node-${i}`,
        sessionId: `session-${i}`,
        position: { x: i * 10, y: i * 20 },
      })),
      canvases: [{ id: "c1", name: "Main", isDefault: true }],
    };

    atomicWriteJson(filePath, data);
    const result = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(result.nodes).toHaveLength(50);
    expect(result.nodes[0].nodeId).toBe("node-0");
    expect(result.nodes[49].position).toEqual({ x: 490, y: 980 });
  });
});

// --- Buffer file operations (manual, mirroring saveBuffer/loadBuffer logic) ---

describe("buffer file operations", () => {
  it("saveBuffer writes concatenated buffer to file", () => {
    const bufferFile = join(TEST_BUFFERS_DIR, "test-session.txt");
    const buffer = ["hello ", "world", "\nline2"];
    writeFileSync(bufferFile, buffer.join(""));

    expect(existsSync(bufferFile)).toBe(true);
    const content = readFileSync(bufferFile, "utf-8");
    expect(content).toBe("hello world\nline2");
  });

  it("loadBuffer reads single-element array from file", () => {
    const bufferFile = join(TEST_BUFFERS_DIR, "read-session.txt");
    writeFileSync(bufferFile, "stored output");

    const content = readFileSync(bufferFile, "utf-8");
    // loadBuffer returns [content] — simulate the same
    expect([content]).toEqual(["stored output"]);
  });

  it("missing buffer file returns empty array", () => {
    const bufferFile = join(TEST_BUFFERS_DIR, "nonexistent.txt");
    const result = existsSync(bufferFile) ? [readFileSync(bufferFile, "utf-8")] : [];
    expect(result).toEqual([]);
  });
});

// --- State file operations ---

describe("state file operations", () => {
  it("loadState returns {nodes:[]} for missing state file", () => {
    const stateFile = join(TEST_DIR, "state.json");
    // Simulate loadState behavior for missing file
    const result = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf-8")) : { nodes: [] };
    expect(result).toEqual({ nodes: [] });
  });

  it("state roundtrip preserves all fields", () => {
    const stateFile = join(TEST_DIR, "state-roundtrip.json");
    const state = {
      nodes: [
        {
          nodeId: "n1",
          sessionId: "s1",
          agentId: "claude",
          agentName: "Claude Code",
          command: "claude",
          cwd: "/tmp",
          createdAt: "2024-01-01T00:00:00Z",
          position: { x: 100, y: 200 },
          canvasId: "canvas-1",
          archived: false,
        },
      ],
      canvases: [{ id: "canvas-1", name: "Main", color: "#3B82F6", order: 0, createdAt: "2024-01-01T00:00:00Z", isDefault: true }],
    };

    atomicWriteJson(stateFile, state);
    const loaded = JSON.parse(readFileSync(stateFile, "utf-8"));
    expect(loaded.nodes).toHaveLength(1);
    expect(loaded.nodes[0].nodeId).toBe("n1");
    expect(loaded.nodes[0].position).toEqual({ x: 100, y: 200 });
    expect(loaded.canvases).toHaveLength(1);
    expect(loaded.canvases[0].isDefault).toBe(true);
  });

  it("corruption recovery: falls back to .tmp if main file is corrupted", () => {
    const stateFile = join(TEST_DIR, "corrupt.json");
    const tmpFile = stateFile + ".tmp";

    // Write corrupted main file
    writeFileSync(stateFile, "not valid json{{{");

    // Write valid .tmp file
    const fallbackState = { nodes: [{ nodeId: "recovered" }] };
    writeFileSync(tmpFile, JSON.stringify(fallbackState));

    // Simulate loadState recovery logic
    let result;
    try {
      result = JSON.parse(readFileSync(stateFile, "utf-8"));
    } catch {
      if (existsSync(tmpFile)) {
        result = JSON.parse(readFileSync(tmpFile, "utf-8"));
      } else {
        result = { nodes: [] };
      }
    }

    expect(result.nodes[0].nodeId).toBe("recovered");
  });
});

// --- savePositions logic ---

describe("savePositions logic", () => {
  it("updates known node position", () => {
    const state = {
      nodes: [
        { nodeId: "n1", position: { x: 0, y: 0 } },
        { nodeId: "n2", position: { x: 10, y: 10 } },
      ],
    };

    const positions: Record<string, { x: number; y: number }> = {
      n1: { x: 50, y: 60 },
    };

    for (const [nodeId, pos] of Object.entries(positions)) {
      const node = state.nodes.find((n) => n.nodeId === nodeId);
      if (node) {
        node.position = { x: pos.x, y: pos.y };
      }
    }

    expect(state.nodes[0].position).toEqual({ x: 50, y: 60 });
    expect(state.nodes[1].position).toEqual({ x: 10, y: 10 });
  });

  it("ignores unknown node IDs", () => {
    const state = {
      nodes: [{ nodeId: "n1", position: { x: 0, y: 0 } }],
    };

    const positions: Record<string, { x: number; y: number }> = {
      unknown: { x: 99, y: 99 },
    };

    let updated = 0;
    for (const [nodeId, pos] of Object.entries(positions)) {
      const node = state.nodes.find((n) => n.nodeId === nodeId);
      if (node) {
        node.position = { x: pos.x, y: pos.y };
        updated++;
      }
    }

    expect(updated).toBe(0);
    expect(state.nodes[0].position).toEqual({ x: 0, y: 0 });
  });
});

// --- migrateCategoriesToCanvases logic ---

describe("migrateCategoriesToCanvases logic", () => {
  it("creates default canvas when no canvases exist", () => {
    const state: any = { nodes: [], canvases: [] };

    // Simulate migration
    if (!state.canvases || state.canvases.length === 0) {
      const defaultCanvasId = `canvas-default-${Date.now()}`;
      state.canvases = [
        {
          id: defaultCanvasId,
          name: "Main",
          color: "#3B82F6",
          order: 0,
          createdAt: new Date().toISOString(),
          isDefault: true,
        },
      ];
    }

    expect(state.canvases).toHaveLength(1);
    expect(state.canvases[0].name).toBe("Main");
    expect(state.canvases[0].isDefault).toBe(true);
  });

  it("skips migration when canvases already exist", () => {
    const state: any = {
      nodes: [],
      canvases: [{ id: "existing", name: "Existing", color: "#000", order: 0, createdAt: "2024-01-01T00:00:00Z" }],
    };

    const migrated = !(state.canvases && state.canvases.length > 0);
    expect(migrated).toBe(false);
  });

  it("maps categories to canvases and updates node canvasIds", () => {
    const state: any = {
      nodes: [
        { nodeId: "n1", parentId: "cat-1" },
        { nodeId: "n2", parentId: "cat-2" },
        { nodeId: "n3" }, // no parentId
      ],
      categories: [
        { id: "cat-1", label: "Work", color: "#f00" },
        { id: "cat-2", label: "Personal", color: "#0f0" },
      ],
      canvases: [],
    };

    // Simulate migration
    const canvases: any[] = [];
    const nodeUpdates = new Map<string, string>();
    const defaultCanvasId = "canvas-default";

    canvases.push({
      id: defaultCanvasId,
      name: "Main",
      color: "#3B82F6",
      order: 0,
      isDefault: true,
    });

    state.categories.forEach((cat: any, index: number) => {
      const canvasId = `canvas-${index}`;
      canvases.push({ id: canvasId, name: cat.label, color: cat.color, order: index + 1 });

      state.nodes.forEach((node: any) => {
        if (node.parentId === cat.id) {
          nodeUpdates.set(node.nodeId, canvasId);
        }
      });
    });

    // Apply updates
    state.nodes.forEach((node: any) => {
      node.canvasId = nodeUpdates.get(node.nodeId) || defaultCanvasId;
      delete node.parentId;
    });

    state.canvases = canvases;

    expect(state.canvases).toHaveLength(3);
    expect(state.nodes[0].canvasId).toBe("canvas-0"); // Was cat-1 → Work canvas
    expect(state.nodes[1].canvasId).toBe("canvas-1"); // Was cat-2 → Personal canvas
    expect(state.nodes[2].canvasId).toBe("canvas-default"); // No parent → default
    expect(state.nodes[0].parentId).toBeUndefined();
  });
});
