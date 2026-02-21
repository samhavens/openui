/**
 * Property-based tests for client store using fast-check.
 *
 * Anti-vacuity rule applied: each property is checked against
 * "would a constant/no-op implementation pass?" If yes, it's strengthened.
 */

import { describe, it, expect, beforeEach } from "vitest";
import fc from "fast-check";
import { useStore } from "../stores/useStore";
import type { AgentSession, Canvas } from "../stores/useStore";

function resetStore() {
  useStore.setState({
    sessions: new Map(),
    nodes: [],
    canvases: [],
    activeCanvasId: null,
  });
}

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: "test",
    sessionId: "session-1",
    agentId: "claude",
    agentName: "Claude Code",
    command: "claude",
    color: "#F97316",
    createdAt: new Date().toISOString(),
    cwd: "/tmp",
    status: "idle",
    ...overrides,
  };
}

beforeEach(resetStore);

describe("store property tests", () => {
  // --- Session add/remove roundtrip ---
  // Anti-vacuity: a no-op addSession would fail (has() returns false),
  //               a no-op removeSession would fail (has() returns true).
  it("addSession/removeSession roundtrip: add makes present, remove makes absent", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s.length > 0 && s.length < 50),
        (nodeId) => {
          resetStore();
          const session = makeSession({ sessionId: `s-${nodeId}` });

          // Verify it's absent before add
          if (useStore.getState().sessions.has(nodeId)) return false;

          useStore.getState().addSession(nodeId, session);
          if (!useStore.getState().sessions.has(nodeId)) return false;
          if (useStore.getState().sessions.get(nodeId)?.sessionId !== `s-${nodeId}`) return false;

          useStore.getState().removeSession(nodeId);
          return !useStore.getState().sessions.has(nodeId);
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- Node add/remove roundtrip ---
  // Anti-vacuity: checks both presence after add AND absence after remove,
  // plus verifies the node count changes correctly.
  it("addNode/removeNode roundtrip: count increases then decreases", () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => s.length > 0 && s.length < 50),
        (nodeId) => {
          resetStore();
          const countBefore = useStore.getState().nodes.length;

          useStore.getState().addNode({ id: nodeId, type: "default", position: { x: 0, y: 0 }, data: {} } as any);
          const countAfterAdd = useStore.getState().nodes.length;
          if (countAfterAdd !== countBefore + 1) return false;

          useStore.getState().removeNode(nodeId);
          const countAfterRemove = useStore.getState().nodes.length;
          return countAfterRemove === countBefore;
        }
      ),
      { numRuns: 100 }
    );
  });

  // --- reorderCanvases preserves set membership ---
  // Anti-vacuity: a no-op would preserve count but might not preserve IDs.
  // We check that the same IDs exist AND the order matches the input.
  it("reorderCanvases preserves exactly the same IDs in the specified order", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.nat(),
        (count, seed) => {
          resetStore();
          const canvases: Canvas[] = Array.from({ length: count }, (_, i) => ({
            id: `c-${i}`,
            name: `Canvas ${i}`,
            color: "#000",
            order: i,
            createdAt: new Date().toISOString(),
          }));
          useStore.setState({ canvases });

          // Generate a permutation using the seed
          const ids = canvases.map((c) => c.id);
          const shuffled = [...ids];
          // Fisher-Yates shuffle using seed
          let s = seed;
          for (let i = shuffled.length - 1; i > 0; i--) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const j = s % (i + 1);
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }

          useStore.getState().reorderCanvases(shuffled);
          const resultIds = useStore.getState().canvases.map((c) => c.id);

          // Must preserve count
          if (resultIds.length !== count) return false;
          // Must match the specified order exactly
          return resultIds.every((id, i) => id === shuffled[i]);
        }
      ),
      { numRuns: 50 }
    );
  });

  // --- updateSession is a partial merge (doesn't clobber other fields) ---
  // Anti-vacuity: a no-op updateSession would fail (status wouldn't change).
  // A replace-all updateSession would fail (cwd would change).
  it("updateSession merges specified fields while preserving unspecified ones", () => {
    const statusArb = fc.constantFrom("idle", "running", "error") as fc.Arbitrary<"idle" | "running" | "error">;
    const nameArb = fc.option(fc.string().filter((s) => s.length > 0 && s.length < 30), { nil: undefined });

    fc.assert(
      fc.property(statusArb, nameArb, (newStatus, newName) => {
        resetStore();
        const original = makeSession({
          sessionId: "orig-session",
          agentId: "claude",
          cwd: "/tmp/original",
          status: "idle",
          customName: "Original Name",
        });
        useStore.getState().addSession("n1", original);

        const updates: Partial<AgentSession> = { status: newStatus };
        if (newName !== undefined) updates.customName = newName;
        useStore.getState().updateSession("n1", updates);

        const updated = useStore.getState().sessions.get("n1")!;

        // Updated fields should reflect the new values
        if (updated.status !== newStatus) return false;
        if (newName !== undefined && updated.customName !== newName) return false;

        // Unspecified fields must be preserved exactly
        if (updated.agentId !== "claude") return false;
        if (updated.cwd !== "/tmp/original") return false;
        if (updated.sessionId !== "orig-session") return false;

        return true;
      }),
      { numRuns: 100 }
    );
  });

  // --- removeCanvas switches activeCanvasId when active canvas is removed ---
  // Anti-vacuity: a no-op would fail (canvas still exists). A delete-without-switch
  // would fail when the active canvas is the removed one.
  it("removeCanvas: active canvas removed => activeCanvasId changes to a remaining canvas", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 5 }),
        fc.nat(),
        (count, removeIdx) => {
          resetStore();
          const canvases: Canvas[] = Array.from({ length: count }, (_, i) => ({
            id: `c-${i}`,
            name: `Canvas ${i}`,
            color: "#000",
            order: i,
            createdAt: new Date().toISOString(),
          }));
          const targetIdx = removeIdx % count;
          const targetId = canvases[targetIdx].id;

          useStore.setState({ canvases, activeCanvasId: targetId });
          useStore.getState().removeCanvas(targetId);

          const remaining = useStore.getState().canvases;
          const newActive = useStore.getState().activeCanvasId;

          // Canvas should be removed
          if (remaining.some((c) => c.id === targetId)) return false;
          // Count should decrease by 1
          if (remaining.length !== count - 1) return false;
          // If canvases remain, activeCanvasId should be one of them
          if (remaining.length > 0 && !remaining.some((c) => c.id === newActive)) return false;

          return true;
        }
      ),
      { numRuns: 50 }
    );
  });
});
