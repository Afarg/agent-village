// Computes room positions from a *variable-length* room list. Room count can
// change at runtime (add/delete), so nothing here may hardcode "8 rooms" —
// the grid grows/shrinks and the break room is re-centered automatically.
//
// Room geometry (cell size, wall height, furniture slots) is fixed by the
// office template in docs/design/09-ai-office-redesign.md §4 — the decor parts
// are drawn to exact pixel sizes, so cells can no longer be resized freely via
// rooms.json. Only `layout.columns` is still read from the config; any legacy
// `cellWidth/cellHeight/gap` values there are ignored.

const ROOM_W = 240; // 15 tiles
const ROOM_H = 224; // 14 tiles
const GAP = 12;
const HEADER_H = 16; // name-plate band
const WALL_BOTTOM = 64; // header + 48px wall

// All points below are room-local and name *bottom-center* anchors (where a
// piece of furniture or a character's feet touch the floor), not centers, so
// the client can stack parts back-to-front by y regardless of their height.
const WALL_SLOTS = [
  { id: "wall1", x: 24, y: WALL_BOTTOM - 4 },
  { id: "wall2", x: 120, y: WALL_BOTTOM - 4 },
  { id: "wall3", x: 216, y: WALL_BOTTOM - 4 },
];
const SIDE_SLOTS = [
  { id: "side1", x: 16, y: 112 },
  { id: "side2", x: 224, y: 112 },
];
const DESK_H = 32;
const OFFICE_DESKS = [
  { x: 72, y: 124 },
  { x: 168, y: 124 },
  { x: 72, y: 208 },
  { x: 168, y: 208 },
];
// Feet stand 14px below the desk's top edge, so the desk hides the lower body
// and the character reads as "working at the desk".
const FEET_BEHIND_DESK = 14;
// Where occupants beyond the 4th stand (between / beside the desks).
const OFFICE_OVERFLOW = [
  { x: 120, y: 106 },
  { x: 120, y: 190 },
  { x: 24, y: 212 },
  { x: 216, y: 212 },
];

const BREAK_TABLE = { x: 120, y: 150 };
const BREAK_IDLE = [
  { x: 56, y: 110 }, { x: 184, y: 110 }, { x: 56, y: 202 }, { x: 184, y: 202 },
  { x: 120, y: 110 }, { x: 120, y: 202 }, { x: 24, y: 160 }, { x: 216, y: 160 },
];

function cellRect(index, columns) {
  const row = Math.floor(index / columns);
  const col = index % columns;
  return { x: col * (ROOM_W + GAP), y: row * (ROOM_H + GAP), w: ROOM_W, h: ROOM_H };
}

function offset(rect, points) {
  return points.map((p) => ({ ...p, x: rect.x + p.x, y: rect.y + p.y }));
}

function officeGeometry(rect) {
  const desks = offset(rect, OFFICE_DESKS);
  const workSpots = [
    ...desks.map((d) => ({ x: d.x, y: d.y - DESK_H + FEET_BEHIND_DESK })),
    ...offset(rect, OFFICE_OVERFLOW),
  ];
  return {
    rect,
    wallSlots: offset(rect, WALL_SLOTS),
    sideSlots: offset(rect, SIDE_SLOTS),
    deskSlots: desks.map((d) => ({ ...d, chair: { x: d.x, y: d.y - DESK_H + 2 } })),
    rug: { x: rect.x + 120, y: rect.y + 150 },
    workSpots,
  };
}

function computeLayout(rooms, breakRoom, genericDesk, layoutCfg) {
  const columns = (layoutCfg && layoutCfg.columns) || 3;
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
    const geo = officeGeometry(cellRect(cursor, columns));
    // deskSpot (feet position of the first desk) is kept for normalize.js /
    // older clients; the dashboard itself uses workSpots.
    placedRooms.push({ ...room, ...geo, deskSpot: geo.workSpots[0] });
    cursor++;
  }

  const breakRect = cellRect(breakIndex, columns);
  const breakGeo = {
    rect: breakRect,
    wallSlots: offset(breakRect, WALL_SLOTS),
    sideSlots: offset(breakRect, SIDE_SLOTS),
    deskSlots: [{ x: breakRect.x + BREAK_TABLE.x, y: breakRect.y + BREAK_TABLE.y, chair: null }],
    rug: { x: breakRect.x + 120, y: breakRect.y + 150 },
    idleSpots: offset(breakRect, BREAK_IDLE),
  };

  return {
    canvas: {
      width: columns * ROOM_W + (columns - 1) * GAP,
      height: rows * ROOM_H + (rows - 1) * GAP,
    },
    metrics: { roomW: ROOM_W, roomH: ROOM_H, gap: GAP, headerH: HEADER_H, wallBottom: WALL_BOTTOM },
    breakRoom: { ...breakRoom, ...breakGeo },
    rooms: placedRooms,
    genericDesk: { ...genericDesk, deskSpot: { x: breakRect.x + 24, y: breakRect.y + 160 } },
  };
}

module.exports = { computeLayout };
