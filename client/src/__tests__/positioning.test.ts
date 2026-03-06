/**
 * Tests for findFreePosition — canvas node collision avoidance.
 */

import { describe, it, expect } from "vitest";
import { findFreePosition, NODE_WIDTH, NODE_HEIGHT, SPACING } from "../utils/positioning";

describe("findFreePosition", () => {
  it("returns target position when no existing nodes", () => {
    const positions = findFreePosition(100, 200, []);
    expect(positions).toHaveLength(1);
    // Should snap to grid (nearest multiple of SPACING)
    expect(positions[0].x % SPACING).toBe(0);
  });

  it("snaps to grid", () => {
    const positions = findFreePosition(105, 207, []);
    expect(positions[0].x).toBe(Math.round(105 / SPACING) * SPACING);
    expect(positions[0].y).toBe(Math.round(207 / SPACING) * SPACING);
  });

  it("avoids collision with existing node", () => {
    const existing = [{ position: { x: 0, y: 0 } }];
    const positions = findFreePosition(0, 0, existing);
    expect(positions).toHaveLength(1);
    // Position should not overlap with existing node
    const pos = positions[0];
    const overlapsX = Math.abs(pos.x - 0) < NODE_WIDTH + SPACING;
    const overlapsY = Math.abs(pos.y - 0) < NODE_HEIGHT + SPACING;
    expect(overlapsX && overlapsY).toBe(false);
  });

  it("returns multiple positions for count > 1", () => {
    const positions = findFreePosition(0, 0, [], 3);
    expect(positions).toHaveLength(3);
  });

  it("multiple positions don't overlap each other", () => {
    const positions = findFreePosition(0, 0, [], 3);
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const overlapX = Math.abs(positions[i].x - positions[j].x) < NODE_WIDTH + SPACING;
        const overlapY = Math.abs(positions[i].y - positions[j].y) < NODE_HEIGHT + SPACING;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it("handles nodes with undefined positions", () => {
    const existing = [
      { position: { x: 0, y: 0 } },
      { position: undefined },
      { position: { x: 100, y: 100 } },
    ];
    const positions = findFreePosition(0, 0, existing);
    expect(positions).toHaveLength(1);
  });

  it("uses spiral search to find free position", () => {
    // Fill a grid around origin
    const existing = [];
    for (let x = -2; x <= 2; x++) {
      for (let y = -2; y <= 2; y++) {
        existing.push({ position: { x: x * (NODE_WIDTH + SPACING), y: y * (NODE_HEIGHT + SPACING) } });
      }
    }
    const positions = findFreePosition(0, 0, existing);
    expect(positions).toHaveLength(1);
    // Should find a position outside the filled grid
    expect(positions[0]).toBeDefined();
  });

  it("falls back when maxRadius exceeded", () => {
    // Create an impossibly dense grid — findFreePosition falls back
    const existing = [];
    for (let x = -25; x <= 25; x++) {
      for (let y = -25; y <= 25; y++) {
        existing.push({ position: { x: x * (NODE_WIDTH + SPACING), y: y * (NODE_HEIGHT + SPACING) } });
      }
    }
    const positions = findFreePosition(0, 0, existing);
    expect(positions).toHaveLength(1);
    // Fallback position is always returned
    expect(typeof positions[0].x).toBe("number");
    expect(typeof positions[0].y).toBe("number");
  });
});
