const fs = require("fs");
const { computeLayout } = require("./layout");
const { slugify } = require("./agentDefs");

const LAYOUT_CFG = { columns: 3 }; // cell size is fixed by layout.js (docs/design/09 §3.2)

// Set by init() at server startup — see docs/design/04-multi-project-integration.md §4.
// Unlike agentDefs/agentState/customAssets (which take the path as a call argument),
// rooms.json is loaded once and mutated in place by rename/add/delete, so we keep the
// resolved path in module state rather than threading it through every function.
let ROOMS_FILE = null;
let raw = null;

function init(roomsFilePath) {
  ROOMS_FILE = roomsFilePath;
  return load();
}

function load() {
  raw = JSON.parse(fs.readFileSync(ROOMS_FILE, "utf8"));
  return raw;
}

function persist() {
  fs.writeFileSync(ROOMS_FILE, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}

// Called by the rooms.json watcher. Our own API writes trigger it too, but
// those were already broadcast by the route that made them (decor edits in
// place, rename/add/delete as a full reload) — so only a file whose content
// differs from memory is a real hand-edit. Comparing against memory (not
// against "what we last wrote") matters: a hand-edit that reverts the file to
// our last write must still be picked up. Returns "unchanged" | "reloaded" |
// "invalid" (unparseable JSON: the previous state is kept).
function reloadIfChanged() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(ROOMS_FILE, "utf8"));
  } catch {
    return "invalid";
  }
  if (JSON.stringify(parsed) === JSON.stringify(raw)) return "unchanged";
  raw = parsed;
  return "reloaded";
}

function getRaw() {
  return raw;
}

// layout: "square" (mobile, default) | "wide" (desktop) — docs/design/14-desktop-layout.md
function getComputed(layout = "square") {
  return computeLayout(raw.rooms, raw.breakRoom, raw.genericDesk, raw.layout || LAYOUT_CFG, layout);
}

function roomIdSlug(label) {
  const base = slugify(label) || "room";
  const taken = new Set([raw.breakRoom.id, ...raw.rooms.map((r) => r.id)]);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function renameRoom(roomId, label) {
  if (roomId === raw.breakRoom.id) {
    raw.breakRoom.label = label;
  } else {
    const room = raw.rooms.find((r) => r.id === roomId);
    if (!room) return false;
    room.label = label;
  }
  persist();
  return true;
}

function addRoom(label, keywords) {
  const id = roomIdSlug(label);
  raw.rooms.push({ id, label, keywords: keywords || [] });
  persist();
  return id;
}

function deleteRoom(roomId) {
  if (roomId === raw.breakRoom.id) return false;
  const before = raw.rooms.length;
  raw.rooms = raw.rooms.filter((r) => r.id !== roomId);
  if (raw.rooms.length === before) return false;
  persist();
  return true;
}

function findRoom(roomId) {
  if (roomId === raw.breakRoom.id) return raw.breakRoom;
  return raw.rooms.find((r) => r.id === roomId) || null;
}

// `changes`: { [slotId]: partId | null } (docs/design/09 §6.2). floor/wall/rug
// are stored at the top level of `decor`, everything else under `decor.slots`.
// Slots not mentioned keep their current value (or the theme default).
function setRoomDecor(roomId, changes, topLevelSlots) {
  const room = findRoom(roomId);
  if (!room) return null;
  const decor = room.decor || {};
  for (const [slotId, partId] of Object.entries(changes)) {
    if (topLevelSlots.has(slotId)) {
      decor[slotId] = partId;
    } else {
      decor.slots = decor.slots || {};
      decor.slots[slotId] = partId;
    }
  }
  room.decor = decor;
  persist();
  return room.decor;
}

function resetRoomDecor(roomId) {
  const room = findRoom(roomId);
  if (!room) return false;
  delete room.decor;
  persist();
  return true;
}

// After a part is deleted from the library, drop every reference to it so
// those slots fall back to the room's theme default. Returns affected room ids.
function clearPartReferences(partId) {
  const affected = [];
  for (const room of [raw.breakRoom, ...raw.rooms]) {
    const decor = room.decor;
    if (!decor) continue;
    let hit = false;
    for (const key of ["floor", "wall", "rug"]) {
      if (decor[key] === partId) {
        delete decor[key];
        hit = true;
      }
    }
    for (const [slotId, value] of Object.entries(decor.slots || {})) {
      if (value === partId) {
        delete decor.slots[slotId];
        hit = true;
      }
    }
    if (hit) affected.push(room.id);
  }
  if (affected.length) persist();
  return affected;
}

function allRoomIds() {
  return new Set([raw.breakRoom.id, ...raw.rooms.map((r) => r.id)]);
}

module.exports = {
  init,
  load,
  getRaw,
  getComputed,
  reloadIfChanged,
  renameRoom,
  addRoom,
  deleteRoom,
  findRoom,
  setRoomDecor,
  resetRoomDecor,
  clearPartReferences,
  allRoomIds,
};
