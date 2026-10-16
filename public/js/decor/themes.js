// Default decor per room (docs/design/09-ai-office-redesign.md §6.2). A room's
// own `decor` in rooms.json (set from the room panel, phase 2-3) overrides
// these field by field; rooms added by the user fall back to OFFICE_BASE.

const b = (category, name) => `builtin:${category}/${name}`;

const OFFICE_BASE = {
  floor: b("floor", "carpet-gray"),
  wall: b("wall", "cream"),
  rug: null,
  slots: {
    wall1: b("wallDecor", "window-city"),
    wall2: b("wallDecor", "whiteboard"),
    wall3: b("wallDecor", "clock"),
    desk: b("desk", "oak-monitor"),
    chair: b("chair", "mesh-black"),
    side1: b("sideDecor", "plant-tall"),
    side2: b("sideDecor", "file-cabinet"),
  },
};

const ROOM_THEMES = {
  break: {
    floor: b("floor", "beige-tile"),
    wall: b("wall", "oak-wainscot"),
    rug: b("rug", "round-beige"),
    slots: {
      wall1: b("wallDecor", "window-city"),
      wall2: b("wallDecor", "clock"),
      wall3: b("wallDecor", "notice-board"),
      desk: b("desk", "lounge-table"),
      chair: null,
      side1: b("sideDecor", "coffee-counter"),
      side2: b("sideDecor", "water-server"),
    },
  },
  reviewer: {
    slots: { wall1: b("wallDecor", "clock"), wall2: b("wallDecor", "whiteboard"), wall3: b("wallDecor", "notice-board"), side1: b("sideDecor", "bookshelf"), side2: b("sideDecor", "plant-tall") },
  },
  tester: {
    slots: { wall1: b("wallDecor", "window-city"), wall2: b("wallDecor", "wall-tv"), wall3: b("wallDecor", "clock"), side2: b("sideDecor", "copier") },
  },
  coder: {},
  researcher: {
    floor: b("floor", "oak-plank"),
    slots: { wall1: b("wallDecor", "book-shelf"), wall2: b("wallDecor", "window-city"), wall3: b("wallDecor", "book-shelf"), side1: b("sideDecor", "bookshelf"), side2: b("sideDecor", "bookshelf") },
  },
  designer: {
    floor: b("floor", "oak-plank"),
    wall: b("wall", "oak-wainscot"),
    slots: { wall1: b("wallDecor", "framed-art"), wall2: b("wallDecor", "window-city"), wall3: b("wallDecor", "framed-art"), desk: b("desk", "white-laptop"), chair: b("chair", "navy"), side1: b("sideDecor", "plant-tall"), side2: b("sideDecor", "plant-tall") },
  },
  documenter: {
    slots: { wall1: b("wallDecor", "book-shelf"), wall2: b("wallDecor", "clock"), wall3: b("wallDecor", "notice-board"), side1: b("sideDecor", "file-cabinet"), side2: b("sideDecor", "bookshelf") },
  },
  planner: {
    floor: b("floor", "walnut-plank"),
    wall: b("wall", "navy"),
    rug: b("rug", "navy-rect"),
    slots: { wall1: b("wallDecor", "chart-poster"), wall2: b("wallDecor", "wall-tv"), wall3: b("wallDecor", "chart-poster"), chair: b("chair", "navy"), side1: b("sideDecor", "plant-tall"), side2: b("sideDecor", "copier") },
  },
  ops: {
    slots: { wall1: b("wallDecor", "wall-tv"), wall2: b("wallDecor", "window-city"), wall3: b("wallDecor", "wall-tv"), side1: b("sideDecor", "copier"), side2: b("sideDecor", "file-cabinet") },
  },
};

function merge(base, over) {
  if (!over) return base;
  return {
    floor: over.floor !== undefined ? over.floor : base.floor,
    wall: over.wall !== undefined ? over.wall : base.wall,
    rug: over.rug !== undefined ? over.rug : base.rug,
    slots: { ...base.slots, ...(over.slots || {}) },
  };
}

// Final decor for a room: office base <- per-room theme <- the room's own saved decor.
export function resolveDecor(room) {
  const theme = merge(OFFICE_BASE, ROOM_THEMES[room.id]);
  return merge(theme, room.decor);
}
