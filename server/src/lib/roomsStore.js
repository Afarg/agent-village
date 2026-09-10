const fs = require("fs");
const { computeLayout } = require("./layout");
const { slugify } = require("./agentDefs");

const LAYOUT_CFG = { columns: 3, cellWidth: 140, cellHeight: 120, gap: 14 };

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

function getRaw() {
  return raw;
}

function getComputed() {
  return computeLayout(raw.rooms, raw.breakRoom, raw.genericDesk, raw.layout || LAYOUT_CFG);
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

function allRoomIds() {
  return new Set([raw.breakRoom.id, ...raw.rooms.map((r) => r.id)]);
}

module.exports = { init, load, getRaw, getComputed, renameRoom, addRoom, deleteRoom, allRoomIds };
