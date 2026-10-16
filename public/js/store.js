// Tiny dependency-free pub/sub store shared between the Phaser scene and the DOM HUD.
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
