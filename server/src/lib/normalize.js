const palette = require("../config/palette.json");

function resolveRoom(def, computedRooms) {
  // Explicit `room:` frontmatter field always wins over keyword inference.
  if (def.room) {
    if (def.room === computedRooms.breakRoom.id) return computedRooms.breakRoom;
    const explicit = computedRooms.rooms.find((r) => r.id === def.room);
    if (explicit) return explicit;
  }

  const haystack = `${def.displayName} ${def.description}`.toLowerCase();
  for (const room of computedRooms.rooms) {
    if ((room.keywords || []).some((kw) => haystack.includes(kw.toLowerCase()))) return room;
  }

  return null; // caller falls back to the generic desk
}

function hashColorKey(agentId) {
  const keys = Object.keys(palette).filter((k) => k !== "_default");
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
  }
  return keys[hash % keys.length];
}

function resolvePalette(def) {
  if (def.color && palette[def.color]) return palette[def.color];
  return palette[hashColorKey(def.agentId)] || palette._default;
}

function modelStars(model) {
  if (!model) return 0;
  const m = model.toLowerCase();
  if (m.includes("opus")) return 3;
  if (m.includes("sonnet")) return 2;
  if (m.includes("haiku")) return 1;
  return 0;
}

const VALID_STATUSES = new Set(["idle", "assigned", "working", "done", "error"]);

function normalizeState(state) {
  if (!state || !VALID_STATUSES.has(state.status)) {
    return { status: "idle", task: null, log: [], result: null, updatedAt: null, pendingPermission: null };
  }
  return {
    status: state.status,
    task: state.task || null,
    log: Array.isArray(state.log) ? state.log.slice(-50) : [],
    result: state.result || null,
    updatedAt: state.updatedAt || null,
    // docs/design/06-permission-wait-bubble.md §4 — overlay on top of `status`, not a status value itself.
    pendingPermission: state.pendingPermission || null,
  };
}

/**
 * Merge a static agent definition with its runtime state into the
 * AgentCharacter shape described in docs/design/02-agent-state-model.md.
 * `computedRooms` is the live, possibly-just-edited room layout (see
 * roomsStore.getComputed()) — never cached across calls, since rooms can be
 * renamed/added/removed at runtime.
 */
function buildAgentCharacter(def, rawState, computedRooms) {
  const room = resolveRoom(def, computedRooms);
  const pal = resolvePalette(def);
  const state = normalizeState(rawState);

  const roomId = room ? room.id : "generic";
  const roomLabel = room ? room.label : computedRooms.genericDesk.label;
  const deskSpot = room ? room.deskSpot : computedRooms.genericDesk.deskSpot;

  return {
    agentId: def.agentId,
    displayName: def.displayName,
    description: def.description,
    model: def.model,
    modelStars: modelStars(def.model),
    color: def.color,
    tools: def.tools || [],
    sourceFile: def.sourceFile,

    roomId,
    roomLabel,
    deskSpot,
    paletteMain: pal.main,
    paletteShade: pal.shade,

    status: state.status,
    task: state.task,
    log: state.log,
    result: state.result,
    updatedAt: state.updatedAt,
    pendingPermission: state.pendingPermission,
  };
}

module.exports = { resolveRoom, resolvePalette, buildAgentCharacter };
