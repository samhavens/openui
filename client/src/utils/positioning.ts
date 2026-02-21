// Node dimensions for collision detection
export const NODE_WIDTH = 200;
export const NODE_HEIGHT = 120;
export const SPACING = 24; // Grid snap size

// Find a free position near the target that doesn't overlap existing nodes
export function findFreePosition(
  targetX: number,
  targetY: number,
  existingNodes: { position?: { x: number; y: number } }[],
  count: number = 1
): { x: number; y: number }[] {
  const positions: { x: number; y: number }[] = [];
  const GRID = SPACING;

  // Snap target to grid
  const startX = Math.round(targetX / GRID) * GRID;
  const startY = Math.round(targetY / GRID) * GRID;

  // Filter to only nodes with valid positions
  const validNodes = existingNodes.filter(
    (n): n is { position: { x: number; y: number } } =>
      n.position !== undefined &&
      typeof n.position.x === 'number' &&
      typeof n.position.y === 'number'
  );

  // Check if a position overlaps with any existing node or already-placed new node
  const isOverlapping = (x: number, y: number, placedPositions: { x: number; y: number }[]) => {
    const allPositions = [...validNodes.map(n => n.position), ...placedPositions];
    for (const pos of allPositions) {
      const overlapX = Math.abs(x - pos.x) < NODE_WIDTH + SPACING;
      const overlapY = Math.abs(y - pos.y) < NODE_HEIGHT + SPACING;
      if (overlapX && overlapY) return true;
    }
    return false;
  };

  // Spiral outward from target position to find free spots
  for (let i = 0; i < count; i++) {
    let found = false;
    let radius = 0;
    const maxRadius = 20; // Max search radius in grid units

    while (!found && radius <= maxRadius) {
      // Try positions in a spiral pattern
      for (let dx = -radius; dx <= radius && !found; dx++) {
        for (let dy = -radius; dy <= radius && !found; dy++) {
          // Only check positions on the current ring
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

          const x = startX + dx * (NODE_WIDTH + SPACING);
          const y = startY + dy * (NODE_HEIGHT + SPACING);

          if (!isOverlapping(x, y, positions)) {
            positions.push({ x, y });
            found = true;
          }
        }
      }
      radius++;
    }

    // Fallback if no free position found
    if (!found) {
      positions.push({
        x: startX + i * (NODE_WIDTH + SPACING),
        y: startY,
      });
    }
  }

  return positions;
}
