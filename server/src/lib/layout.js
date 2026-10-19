// Computes room positions from a *variable-length* room list. Room count can
// change at runtime (add/delete), so nothing here may hardcode "8 rooms" —
// the grid grows/shrinks and the break room is re-centered automatically.
//
// Room geometry (cell size, wall height, furniture slots) is fixed by the
// office template in docs/design/09-ai-office-redesign.md §4 — the decor parts
// are drawn to exact pixel sizes, so cells can no longer be resized freely via
// rooms.json. Only `layout.columns` is still read from the config; any legacy
// `cellWidth/cellHeight/gap` values there are ignored.

const ROOM_H = 224; // 14 tiles
const GAP = 12;
const HEADER_H = 16; // name-plate band
const WALL_BOTTOM = 64; // header + 48px wall

// Two room templates (docs/design/14-desktop-layout.md): "square" is the
// original 240-wide cell (mobile), "wide" keeps the height and stretches the
// width so a 3x3 office is 16:9 (desktop, 1236x696). Floors/walls are tiled
// and furniture parts have fixed sizes, so both share every decor part.
//
// All points are room-local and name *bottom-center* anchors (where a
// piece of furniture or a character's feet touch the floor), not centers, so
// the client can stack parts back-to-front by y regardless of their height.
const TEMPLATES = {
  square: {
    roomW: 240, // 15 tiles
    wallSlots: [24, 120, 216],
    sideSlots: [16, 224],
    desks: [[72, 124], [168, 124], [72, 208], [168, 208]],
    // Where occupants beyond the desks stand (between / beside the desks).
    overflow: [[120, 106], [120, 190], [24, 212], [216, 212]],
    breakIdle: [[56, 110], [184, 110], [56, 202], [184, 202], [120, 110], [120, 202], [24, 160], [216, 160]],
  },
  wide: {
    roomW: 404,
    wallSlots: [60, 202, 344],
    sideSlots: [16, 388],
    desks: [[76, 124], [202, 124], [328, 124], [76, 208], [202, 208], [328, 208]],
    overflow: [[139, 106], [265, 106], [139, 190], [265, 190], [36, 212], [368, 212]],
    breakIdle: [
      [70, 110], [334, 110], [70, 202], [334, 202], [202, 110], [202, 202],
      [36, 160], [368, 160], [136, 110], [268, 110], [136, 202], [268, 202],
    ],
  },
};
const LAYOUTS = Object.keys(TEMPLATES);
const DESK_H = 32;
// Feet stand 14px below the desk's top edge, so the desk hides the lower body
// and the character reads as "working at the desk".
const FEET_BEHIND_DESK = 14;

function cellRect(index, columns, roomW) {
  const row = Math.floor(index / columns);
  const col = index % columns;
  return { x: col * (roomW + GAP), y: row * (ROOM_H + GAP), w: roomW, h: ROOM_H };
}

function offset(rect, points) {
  return points.map((p) => ({ ...p, x: rect.x + p.x, y: rect.y + p.y }));
}

const xy = (pairs) => pairs.map(([x, y]) => ({ x, y }));

function commonGeometry(rect, t) {
  return {
    rect,
    wallSlots: offset(rect, t.wallSlots.map((x, i) => ({ id: `wall${i + 1}`, x, y: WALL_BOTTOM - 4 }))),
    sideSlots: offset(rect, t.sideSlots.map((x, i) => ({ id: `side${i + 1}`, x, y: 112 }))),
    rug: { x: rect.x + t.roomW / 2, y: rect.y + 150 },
  };
}

function officeGeometry(rect, t) {
  const desks = offset(rect, xy(t.desks));
  const workSpots = [
    ...desks.map((d) => ({ x: d.x, y: d.y - DESK_H + FEET_BEHIND_DESK })),
    ...offset(rect, xy(t.overflow)),
  ];
  return {
    ...commonGeometry(rect, t),
    deskSlots: desks.map((d) => ({ ...d, chair: { x: d.x, y: d.y - DESK_H + 2 } })),
    workSpots,
  };
}

function computeLayout(rooms, breakRoom, genericDesk, layoutCfg, layout = "square") {
  const t = TEMPLATES[layout] || TEMPLATES.square;
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
    const geo = officeGeometry(cellRect(cursor, columns, t.roomW), t);
    // deskSpot (feet position of the first desk) is kept for normalize.js /
    // older clients; the dashboard itself uses workSpots.
    placedRooms.push({ ...room, ...geo, deskSpot: geo.workSpots[0] });
    cursor++;
  }

  const breakRect = cellRect(breakIndex, columns, t.roomW);
  const breakGeo = {
    ...commonGeometry(breakRect, t),
    deskSlots: [{ x: breakRect.x + t.roomW / 2, y: breakRect.y + 150, chair: null }],
    idleSpots: offset(breakRect, xy(t.breakIdle)),
  };

  return {
    canvas: {
      width: columns * t.roomW + (columns - 1) * GAP,
      height: rows * ROOM_H + (rows - 1) * GAP,
    },
    layout: TEMPLATES[layout] ? layout : "square",
    metrics: { roomW: t.roomW, roomH: ROOM_H, gap: GAP, headerH: HEADER_H, wallBottom: WALL_BOTTOM },
    breakRoom: { ...breakRoom, ...breakGeo },
    rooms: placedRooms,
    genericDesk: { ...genericDesk, deskSpot: { x: breakRect.x + 24, y: breakRect.y + 160 } },
  };
}

module.exports = { computeLayout, LAYOUTS };
