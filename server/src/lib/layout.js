// Computes room positions from a *variable-length* room list. Room count can
// change at runtime (add/delete), so nothing here may hardcode "8 rooms" —
// the grid grows/shrinks and the break room is re-centered automatically.

// Fractional idle-spot positions inside the break room rect, derived from
// the original hand-placed 8-slot layout (docs/design/01-visual-concept.md).
const IDLE_SPOT_FRACTIONS = [
  [0.25, 0.29], [0.75, 0.29], [0.25, 0.71], [0.75, 0.71],
  [0.5, 0.29], [0.37, 0.5], [0.63, 0.5], [0.5, 0.71],
];

function cellRect(index, columns, cellWidth, cellHeight, gap) {
  const row = Math.floor(index / columns);
  const col = index % columns;
  return {
    x: col * (cellWidth + gap),
    y: row * (cellHeight + gap),
    w: cellWidth,
    h: cellHeight,
  };
}

function computeLayout(rooms, breakRoom, genericDesk, layoutCfg) {
  const { columns, cellWidth, cellHeight, gap } = layoutCfg;
  const totalCells = rooms.length + 1; // +1 for the break room
  const rows = Math.max(1, Math.ceil(totalCells / columns));

  // Break room sits at the grid's middle cell — for the common 3x3 case
  // (8 rooms) this reproduces the original "break room in the center" look.
  const middleRow = Math.floor(rows / 2);
  const middleCol = Math.floor(columns / 2);
  const breakIndex = Math.min(middleRow * columns + middleCol, rows * columns - 1);

  const placedRooms = [];
  let cursor = 0;
  for (const room of rooms) {
    if (cursor === breakIndex) cursor++;
    const rect = cellRect(cursor, columns, cellWidth, cellHeight, gap);
    placedRooms.push({
      ...room,
      rect,
      deskSpot: { x: rect.x + cellWidth * 0.5, y: rect.y + cellHeight * 0.625 },
    });
    cursor++;
  }

  const breakRect = cellRect(breakIndex, columns, cellWidth, cellHeight, gap);
  const idleSpots = IDLE_SPOT_FRACTIONS.map(([fx, fy]) => ({
    x: breakRect.x + breakRect.w * fx,
    y: breakRect.y + breakRect.h * fy,
  }));

  return {
    canvas: {
      width: columns * cellWidth + (columns - 1) * gap,
      height: rows * cellHeight + (rows - 1) * gap,
    },
    breakRoom: { ...breakRoom, rect: breakRect, idleSpots },
    rooms: placedRooms,
    genericDesk: { ...genericDesk, deskSpot: { x: breakRect.x + 18, y: breakRect.y + 18 } },
  };
}

module.exports = { computeLayout };
