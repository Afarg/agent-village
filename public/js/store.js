// Tiny dependency-free pub/sub store shared between the Phaser scene and the DOM HUD.

// A character whose def carries `tools: []` (empty, explicitly declared) is
// one of the decorative placeholder characters (test-character-*,
// business-character-*) that exist purely for pipeline/UI showcase and are
// never real delegation targets (see each one's .claude/agents/*.md
// description). Every currently-real agent def declares at least one tool.
export function isDummyAgent(agent) {
  return Array.isArray(agent.tools) && agent.tools.length === 0;
}

// docs/design/13-room-groups-and-stale.md §2.1 — "working"/"assigned" with no
// state write for staleAfterMs is shown as 応答なし？. Display only: the state
// file is never changed. Permission waits and dummies are never stale.
const STALE_CHECK_MS = 10000;

// Stale by the threshold alone, ignoring "まだ作業中" snoozes.
export function isOverdue(agent, now = Date.now()) {
  if (!agent || isDummyAgent(agent) || agent.pendingPermission) return false;
  if (agent.status !== "working" && agent.status !== "assigned") return false;
  const t = Date.parse(agent.updatedAt);
  return Number.isFinite(t) && now - t >= store.staleAfterMs;
}

// §6.1: the user said "still working" for this run (this updatedAt).
export function isSnoozed(agent, now = Date.now()) {
  const z = agent && store.snoozes[agent.agentId];
  if (!z || z.updatedAt !== agent.updatedAt) return false;
  return z.until === null || now < z.until;
}

export function isStale(agent, now = Date.now()) {
  return isOverdue(agent, now) && !isSnoozed(agent, now);
}

const SNOOZE_KEY = "agentVillage.staleSnooze";

function readAllSnoozes() {
  try {
    const all = JSON.parse(localStorage.getItem(SNOOZE_KEY) || "{}");
    return all && typeof all === "object" ? all : {};
  } catch {
    return {};
  }
}

// "2時間" / "45分" since the last state write.
export function sinceLabel(iso, now = Date.now()) {
  const min = Math.max(0, Math.floor((now - Date.parse(iso)) / 60000));
  if (min < 60) return `${min}分`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}時間`;
  return `${Math.floor(min / 1440)}日`;
}

class Store {
  constructor() {
    this.agents = new Map(); // agentId -> AgentCharacter
    this.rooms = null; // rooms.json + tileUrl, see /api/rooms
    this.decor = null; // uploaded decor parts + image spec, see /api/decor
    this.selectedAgentId = null;
    this.selectedRoomId = null;
    this.connected = false;
    this.serverTime = null;
    this.listeners = new Set();
    this.staleAfterMs = 60 * 60000;
    this.staleKey = "";
    this.projectKey = "";
    this.snoozes = {}; // agentId -> { updatedAt, until: ms | null (= this whole run) }
  }

  setProjectKey(key) {
    this.projectKey = key;
    this.loadSnoozes();
    if (!this.snoozeListener) {
      // Another tab snoozed (or a snooze ran out there): re-judge here too.
      this.snoozeListener = (e) => {
        if (e.key !== SNOOZE_KEY) return;
        this.loadSnoozes();
        this.checkStale(true);
      };
      window.addEventListener("storage", this.snoozeListener);
    }
  }

  loadSnoozes() {
    const mine = readAllSnoozes()[this.projectKey];
    this.snoozes = mine && typeof mine === "object" ? mine : {};
  }

  // ms: snooze length, or null for "この作業では知らせない".
  snoozeStale(agentId, ms) {
    const agent = this.getAgent(agentId);
    if (!agent) return;
    this.snoozes[agentId] = { updatedAt: agent.updatedAt, until: ms === null ? null : Date.now() + ms };
    try {
      const all = readAllSnoozes();
      all[this.projectKey] = this.snoozes;
      localStorage.setItem(SNOOZE_KEY, JSON.stringify(all));
    } catch {
      // storage blocked — the snooze lasts for this page only
    }
    this.checkStale(true);
  }

  setStaleAfterMinutes(min) {
    if (!Number.isInteger(min) || min <= 0) return;
    this.staleAfterMs = min * 60000;
    this.checkStale(true);
  }

  async loadDisplaySettings() {
    try {
      const body = await (await fetch("/api/village-settings")).json();
      this.setStaleAfterMinutes(body.settings?.display?.staleAfterMinutes);
    } catch {
      // keep the default threshold
    }
  }

  // Emits "stale-changed" only when the set of stale agents actually changes.
  checkStale(force = false) {
    const key = this.getAgents()
      .filter((a) => isStale(a))
      .map((a) => a.agentId)
      .sort()
      .join(",");
    if (!force && key === this.staleKey) return;
    this.staleKey = key;
    this.emit("stale-changed", {});
  }

  startStaleTimer() {
    if (this.staleTimer) return;
    this.staleTimer = setInterval(() => this.checkStale(), STALE_CHECK_MS);
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(type, data) {
    for (const fn of this.listeners) fn(type, data);
  }

  async init() {
    const [snapshotRes, roomsRes] = await Promise.all([fetch("/api/snapshot"), fetch("/api/rooms")]);
    const body = await snapshotRes.json();
    this.rooms = await roomsRes.json();

    this.agents.clear();
    for (const agent of body.agents) this.agents.set(agent.agentId, agent);
    this.serverTime = body.serverTime;
    this.emit("snapshot", { agents: this.getAgents() });
    this.emit("rooms", { rooms: this.rooms });
  }

  async ensureRooms() {
    if (!this.rooms) {
      const res = await fetch("/api/rooms");
      this.rooms = await res.json();
    }
    return this.rooms;
  }

  async ensureDecor() {
    if (!this.decor) await this.refreshDecor();
    return this.decor;
  }

  async refreshDecor() {
    const res = await fetch("/api/decor");
    this.decor = await res.json();
    this.emit("decor-library", { decor: this.decor });
    return this.decor;
  }

  // Uploaded parts of one category (built-ins live in decor/parts.js).
  customParts(category) {
    return (this.decor && this.decor.custom && this.decor.custom[category]) || [];
  }

  findRoom(roomId) {
    if (!this.rooms) return null;
    if (this.rooms.breakRoom.id === roomId) return this.rooms.breakRoom;
    return this.rooms.rooms.find((r) => r.id === roomId) || null;
  }

  async refreshRooms() {
    const res = await fetch("/api/rooms");
    this.rooms = await res.json();
    this.emit("rooms", { rooms: this.rooms });
  }

  connectSSE() {
    const es = new EventSource("/api/events");

    es.addEventListener("agent-change", (ev) => {
      const msg = JSON.parse(ev.data);
      const prev = this.agents.get(msg.agentId) || null;

      if (msg.change === "removed" && msg.kind === "definition") {
        this.agents.delete(msg.agentId);
        this.emit("agent-removed", { agentId: msg.agentId, prev });
        return;
      }

      if (msg.payload) {
        this.agents.set(msg.agentId, msg.payload);
        this.emit("agent-change", { agentId: msg.agentId, prev, next: msg.payload, kind: msg.kind });
      }
    });

    es.addEventListener("asset-change", async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.assetKind === "character") {
        const res = await fetch("/api/snapshot");
        const body = await res.json();
        const updated = body.agents.find((a) => a.agentId === msg.id);
        if (updated) this.agents.set(msg.id, updated);
      } else if (msg.assetKind === "room") {
        await this.refreshRooms();
      }
      this.emit("asset-change", { assetKind: msg.assetKind, id: msg.id });
    });

    // docs/design/08-report-history.md — permanent report history. The
    // store doesn't keep its own copy of the list (reports.js owns that
    // page-local state); it's purely a relay, same as the other event types.
    es.addEventListener("report-added", (ev) => {
      const msg = JSON.parse(ev.data);
      this.emit("report-added", msg);
    });

    // docs/design/09 §6-§7: decor edits are applied in place (no reload).
    es.addEventListener("room-decor-changed", (ev) => {
      const msg = JSON.parse(ev.data);
      const roomIds = [];
      for (const { id, decor } of msg.rooms) {
        const room = this.findRoom(id);
        if (!room) continue;
        if (decor) room.decor = decor;
        else delete room.decor;
        roomIds.push(id);
      }
      this.emit("room-decor", { roomIds });
    });

    es.addEventListener("decor-library-changed", () => {
      this.refreshDecor();
    });

    es.addEventListener("rooms-changed", () => {
      // Room rename/add/delete reshuffles the whole grid layout — simplest
      // correct behavior for every connected tab is to just reload rather
      // than re-deriving a live in-place re-layout in Phaser.
      window.location.reload();
    });

    // docs/design/11-project-switcher.md §4: the server now watches another
    // folder, so nothing on screen is valid any more.
    es.addEventListener("project-changed", () => {
      window.location.reload();
    });

    es.addEventListener("village-settings-changed", (ev) => {
      const msg = JSON.parse(ev.data);
      this.setStaleAfterMinutes(msg.settings?.display?.staleAfterMinutes);
    });

    es.addEventListener("server-status", (ev) => {
      const msg = JSON.parse(ev.data);
      this.connected = msg.status === "online";
      this.serverTime = msg.serverTime;
      this.emit("connection", { connected: this.connected });
    });

    es.onerror = () => {
      this.connected = false;
      this.emit("connection", { connected: false });
    };

    es.onopen = () => {
      this.connected = true;
      this.emit("connection", { connected: true });
      // Reconnects can miss events while disconnected — re-sync full state.
      this.init();
    };

    this.es = es;
  }

  select(agentId) {
    this.selectedAgentId = agentId;
    this.selectedRoomId = null;
    this.emit("select", { agentId });
  }

  selectRoom(roomId) {
    this.selectedRoomId = roomId;
    this.selectedAgentId = null;
    this.emit("select-room", { roomId });
  }

  getAgents() {
    return Array.from(this.agents.values());
  }

  getAgent(agentId) {
    return this.agents.get(agentId) || null;
  }

  getRooms() {
    return this.rooms;
  }

  getRoom(roomId) {
    if (!this.rooms) return null;
    if (roomId === this.rooms.breakRoom.id) return this.rooms.breakRoom;
    return this.rooms.rooms.find((room) => room.id === roomId) || null;
  }
}

export const store = new Store();
