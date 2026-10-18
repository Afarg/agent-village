const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const express = require("express");
const chokidar = require("chokidar");
const multer = require("multer");

const { readAllAgentDefs, readAgentDef, slugify } = require("./lib/agentDefs");
const { readAllStates } = require("./lib/agentState");
const { buildAgentCharacter } = require("./lib/normalize");
const { readPngSize } = require("./lib/png");
const {
  CHARACTER_SPRITE,
  ROOM_TILE,
  CHARACTER_ANIMATION,
  assetInfo,
  saveAsset,
  removeAsset,
  animationInfo,
  saveAnimationBundle,
  removeAnimationBundle,
} = require("./lib/customAssets");
const { renameAgentFile } = require("./lib/renameAgent");
const roomsStore = require("./lib/roomsStore");
const decorStore = require("./lib/decorStore");
const reportLog = require("./lib/reportLog");
const projectRegistry = require("./lib/projectRegistry");
const { readConfigOverview } = require("./lib/configOverview");
const villageSettings = require("./lib/villageSettings");

// See docs/design/04-multi-project-integration.md for the install-root vs.
// target-root split this implements.
//
// INSTALL_ROOT: where this tool's own code lives (server/, public/, the
// bundled rooms template) — always __dirname-relative, never configurable.
//
// TARGET_ROOT: the project being visualized (.claude/agents, agents/state,
// custom assets, rooms config). Resolution order: --target CLI arg >
// TARGET_PROJECT_ROOT env var > default to INSTALL_ROOT (so the existing
// "watch agents_app itself" demo workflow keeps working unchanged).
function resolveTargetRoot() {
  const argIdx = process.argv.indexOf("--target");
  if (argIdx !== -1 && process.argv[argIdx + 1]) return path.resolve(process.argv[argIdx + 1]);
  if (process.env.TARGET_PROJECT_ROOT) return path.resolve(process.env.TARGET_PROJECT_ROOT);
  return path.resolve(__dirname, "..", "..");
}

const INSTALL_ROOT = path.resolve(__dirname, "..", "..");
const DECOR_URL_PREFIX = "/assets/custom/decor";
const ROOMS_TEMPLATE_FILE = path.join(__dirname, "config", "rooms.default.json");
const PUBLIC_DIR = path.join(INSTALL_ROOT, "public");
const PORT = process.env.PORT || 4173;
// Loopback only by default (docs/design/11-project-switcher.md §5): the API can
// now repoint the server at another registered folder, so it must not be
// reachable from the LAN. HOST=0.0.0.0 restores the old behavior explicitly.
const HOST = process.env.HOST || "127.0.0.1";

// AGENT_VILLAGE_REGISTRY_FILE exists for tests, so they never touch the real list.
projectRegistry.init(process.env.AGENT_VILLAGE_REGISTRY_FILE || path.join(INSTALL_ROOT, ".agent-village", "projects.json"));

// Everything below is derived from the target root and is reassigned together
// by setTargetPaths() when the header's project switcher changes the target
// (docs/design/11-project-switcher.md §4).
let TARGET_ROOT;
let AGENTS_DEF_DIR;
let AGENTS_STATE_DIR;
let AGENTS_LOGS_DIR;
let CHARACTER_ASSET_DIR;
let ROOM_ASSET_DIR;
let DECOR_ASSET_DIR;
let ROOMS_FILE;

function setTargetPaths(root) {
  TARGET_ROOT = root;
  AGENTS_DEF_DIR = path.join(root, ".claude", "agents");
  AGENTS_STATE_DIR = path.join(root, "agents", "state");
  AGENTS_LOGS_DIR = path.join(root, "agents", "logs");
  CHARACTER_ASSET_DIR = path.join(root, "assets", "custom", "characters");
  ROOM_ASSET_DIR = path.join(root, "assets", "custom", "rooms");
  DECOR_ASSET_DIR = path.join(root, "assets", "custom", "decor");
  ROOMS_FILE = path.join(root, "agents", "config", "rooms.json");
}

// ---- in-memory store -------------------------------------------------
let defs = {}; // agentId -> def
let states = {}; // agentId -> raw state json

function characterSprite(agentId) {
  return assetInfo(CHARACTER_ASSET_DIR, agentId, "/assets/custom/characters");
}

function characterAnimation(agentId) {
  return animationInfo(CHARACTER_ASSET_DIR, agentId, "/assets/custom/characters");
}

function roomTile(roomId) {
  return assetInfo(ROOM_ASSET_DIR, roomId, "/assets/custom/rooms");
}

function buildCharacterWithAssets(def, computedRooms) {
  const character = buildAgentCharacter(def, states[def.agentId], computedRooms);
  const sprite = characterSprite(def.agentId);
  const anim = characterAnimation(def.agentId);
  // docs/design/07-directional-animation-support.md §2: animation (if present)
  // takes priority over spriteUrl on the client, but spriteUrl stays populated
  // too so older clients / the icon-only Phase 1 flow keep working unchanged.
  return { ...character, spriteUrl: sprite ? sprite.url : null, animation: anim ? { views: anim.views } : null };
}

function snapshotAgents() {
  const computed = roomsStore.getComputed();
  return Object.values(defs).map((def) => buildCharacterWithAssets(def, computed));
}

function roomsWithAssets() {
  const computed = roomsStore.getComputed();
  const withTile = (room) => ({ ...room, tileUrl: (roomTile(room.id) || {}).url || null });
  return {
    canvas: computed.canvas,
    metrics: computed.metrics,
    breakRoom: withTile(computed.breakRoom),
    rooms: computed.rooms.map(withTile),
    genericDesk: computed.genericDesk,
    constraints: { characterSprite: CHARACTER_SPRITE, roomTile: ROOM_TILE, characterAnimation: CHARACTER_ANIMATION },
  };
}

// Uploaded decor parts + the image spec per category (docs/design/09 §5-§6).
function decorLibrary() {
  return {
    spec: decorStore.DECOR_SPEC,
    maxBytes: decorStore.DECOR_MAX_BYTES,
    minSize: decorStore.DECOR_MIN_SIZE,
    slots: decorStore.DECOR_SLOTS,
    custom: decorStore.listCustomParts(DECOR_ASSET_DIR, DECOR_URL_PREFIX),
  };
}

// ---- SSE clients -------------------------------------------------
const clients = new Set();

function sendEvent(eventName, data) {
  const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(message);
}

function broadcast(kind, agentId, change) {
  const character = defs[agentId] ? buildCharacterWithAssets(defs[agentId], roomsStore.getComputed()) : null;
  sendEvent("agent-change", { kind, agentId, change, payload: character });
}

function broadcastServerStatus(status) {
  sendEvent("server-status", { status, serverTime: new Date().toISOString() });
}

function broadcastAssetChange(assetKind, id) {
  sendEvent("asset-change", { assetKind, id });
}

// Room rename/add/delete all change the grid layout (or at least the label
// shown on it), and every connected client needs the same picture — instead
// of diffing rects live in the browser, we just ask clients to refetch and
// reload. Rooms are edited rarely, so simplicity wins over a live in-place
// re-layout.
function broadcastRoomsChanged() {
  sendEvent("rooms-changed", { serverTime: new Date().toISOString() });
}

// Decor edits don't move anything, so unlike rooms-changed they're applied in
// place by the client (only the affected rooms are redrawn, no page reload).
function broadcastRoomDecorChanged(roomIds) {
  const rooms = roomIds.map((id) => ({ id, decor: (roomsStore.findRoom(id) || {}).decor || null }));
  if (rooms.length) sendEvent("room-decor-changed", { rooms });
}

function broadcastDecorLibraryChanged() {
  sendEvent("decor-library-changed", { serverTime: new Date().toISOString() });
}

// ---- debounce helpers -------------------------------------------------
const pendingTimers = new Map();
const DEBOUNCE_MS = 150;

// Bumped on every project switch. A watcher closed during a switch can still
// deliver one last event; stamping each event with the generation it was
// watched under lets us drop those instead of applying them to the new target.
let watchGeneration = 0;

function scheduleReload(kind, filePath, gen = watchGeneration) {
  if (gen !== watchGeneration) return;
  const key = `${kind}:${filePath}`;
  if (pendingTimers.has(key)) clearTimeout(pendingTimers.get(key));
  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key);
      if (gen === watchGeneration) reloadOne(kind, filePath);
    }, DEBOUNCE_MS)
  );
}

function reloadOne(kind, filePath) {
  if (kind === "definition") {
    if (!fs.existsSync(filePath)) {
      const removedId = Object.keys(defs).find((id) => defs[id].sourceFile === path.basename(filePath));
      if (removedId) {
        delete defs[removedId];
        broadcast("definition", removedId, "removed");
      }
      return;
    }
    try {
      const def = readAgentDef(filePath);
      if (def) {
        const isNew = !defs[def.agentId];
        defs[def.agentId] = def;
        broadcast("definition", def.agentId, isNew ? "added" : "updated");
      }
    } catch (err) {
      console.warn(`[watch] failed to parse definition ${filePath}: ${err.message}`);
    }
  } else if (kind === "state") {
    const agentId = path.basename(filePath, ".json");
    if (!fs.existsSync(filePath)) {
      delete states[agentId];
      broadcast("state", agentId, "removed");
      return;
    }
    try {
      states[agentId] = JSON.parse(fs.readFileSync(filePath, "utf8"));
      broadcast("state", agentId, "updated");
    } catch (err) {
      console.warn(`[watch] failed to parse state ${filePath}, keeping previous value: ${err.message}`);
    }
  } else if (kind === "character-asset") {
    // Animation bundles live one level down (`<CHARACTER_ASSET_DIR>/<agentId>/*`,
    // docs/design/07-directional-animation-support.md §3.1) - for those, the
    // agentId is the containing directory's name, not the changed file's own
    // basename (which would otherwise be misread as e.g. "front" from "front.png").
    const isNested = path.dirname(filePath) !== CHARACTER_ASSET_DIR;
    const agentId = isNested ? path.basename(path.dirname(filePath)) : path.basename(filePath, ".png");
    broadcastAssetChange("character", agentId);
  } else if (kind === "room-asset") {
    broadcastAssetChange("room", path.basename(filePath, ".png"));
  } else if (kind === "decor-asset") {
    broadcastDecorLibraryChanged();
  } else if (kind === "rooms-file") {
    const result = roomsStore.reloadIfChanged();
    if (result === "invalid") console.warn(`[watch] failed to parse ${filePath}, keeping previous rooms config`);
    if (result === "reloaded") broadcastRoomsChanged();
  } else if (kind === "report-log") {
    // agents/logs/*.ndjson is append-only history, not a whole-object status
    // file like agents/state/*.json — reloadOne can't reuse the "state"
    // branch above. reportLog.ingestFile() tails only the newly-appended
    // bytes and returns just the new entries.
    const added = reportLog.ingestFile(filePath);
    for (const entry of added) sendEvent("report-added", { agentId: entry.agentId, entry });
  }
}

// ---- target loading -------------------------------------------------
let roomsFileWasCreated = false;
// /assets/custom is served from the current target, so the static handler is
// rebuilt whenever the target changes (see the app.use near the bottom).
let customAssetStatic = null;

// Reads everything for `root` into memory. Throws (leaving module state
// half-updated) if e.g. rooms.json is unparseable — switchTarget() handles
// that by loading the previous root again.
function loadTarget(root) {
  setTargetPaths(root);
  fs.mkdirSync(AGENTS_DEF_DIR, { recursive: true });
  fs.mkdirSync(AGENTS_STATE_DIR, { recursive: true });
  fs.mkdirSync(AGENTS_LOGS_DIR, { recursive: true });
  fs.mkdirSync(CHARACTER_ASSET_DIR, { recursive: true });
  fs.mkdirSync(ROOM_ASSET_DIR, { recursive: true });
  fs.mkdirSync(DECOR_ASSET_DIR, { recursive: true });

  // The target project doesn't necessarily have a rooms.json of its own yet —
  // bootstrap-copy the bundled default on first run (docs/design/04-multi-project-integration.md §4).
  // Never overwrite an existing one: room edits made from the dashboard live here.
  fs.mkdirSync(path.dirname(ROOMS_FILE), { recursive: true });
  roomsFileWasCreated = !fs.existsSync(ROOMS_FILE);
  if (roomsFileWasCreated) fs.copyFileSync(ROOMS_TEMPLATE_FILE, ROOMS_FILE);
  roomsStore.init(ROOMS_FILE);

  reportLog.loadAll(AGENTS_LOGS_DIR);
  defs = readAllAgentDefs(AGENTS_DEF_DIR);
  states = readAllStates(AGENTS_STATE_DIR);
  customAssetStatic = express.static(path.join(root, "assets", "custom"));
}

// ---- watchers -------------------------------------------------
const watchOpts = { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } };
let watchers = [];

// Resolves once every watcher has finished its initial scan. Until then a
// write can go unnoticed, so switchTarget() waits for this and re-reads.
function startWatchers() {
  const gen = watchGeneration;
  const on = (kind, fixedPath) => (p) => scheduleReload(kind, fixedPath || p, gen);

  watchers = [
    chokidar
      .watch(AGENTS_DEF_DIR, watchOpts)
      .on("add", on("definition"))
      .on("change", on("definition"))
      .on("unlink", on("definition")),

    chokidar
      .watch(AGENTS_STATE_DIR, watchOpts)
      .on("add", on("state"))
      .on("change", on("state"))
      .on("unlink", on("state")),

    // Watching the asset folders too (not just the upload endpoints below) means
    // an artist can drop a PNG in by hand and the dashboard still picks it up.
    chokidar
      .watch(CHARACTER_ASSET_DIR, watchOpts)
      .on("add", on("character-asset"))
      .on("change", on("character-asset"))
      .on("unlink", on("character-asset")),

    chokidar
      .watch(ROOM_ASSET_DIR, watchOpts)
      .on("add", on("room-asset"))
      .on("change", on("room-asset"))
      .on("unlink", on("room-asset")),

    // Decor parts can also be dropped into assets/custom/decor/<category>/ by hand.
    // All changes collapse into one debounced "library changed" (same key).
    chokidar
      .watch(DECOR_ASSET_DIR, watchOpts)
      .on("add", on("decor-asset", DECOR_ASSET_DIR))
      .on("change", on("decor-asset", DECOR_ASSET_DIR))
      .on("unlink", on("decor-asset", DECOR_ASSET_DIR)),

    // Picks up hand-edits to rooms.json too, not just changes made through the API.
    chokidar.watch(ROOMS_FILE, watchOpts).on("change", on("rooms-file", ROOMS_FILE)),

    // agents/logs/*.ndjson — permanent report history (docs/design/08-report-history.md).
    // "add" fires for a brand-new agent's first-ever report line; "change" for
    // every subsequent append.
    chokidar
      .watch(AGENTS_LOGS_DIR, watchOpts)
      .on("add", on("report-log"))
      .on("change", on("report-log")),
  ];
  return Promise.all(watchers.map((w) => new Promise((resolve) => w.once("ready", resolve))));
}

// Picks up writes that landed between loadTarget()'s read and the watchers
// becoming ready (seen in testing: a state write right after a switch was lost).
function rereadAfterReady() {
  defs = readAllAgentDefs(AGENTS_DEF_DIR);
  states = readAllStates(AGENTS_STATE_DIR);
}

async function stopWatchers() {
  watchGeneration++;
  for (const timer of pendingTimers.values()) clearTimeout(timer);
  pendingTimers.clear();
  const closing = watchers;
  watchers = [];
  await Promise.all(closing.map((w) => w.close()));
}

// docs/design/11-project-switcher.md §4. Every connected tab reloads on
// project-changed (same as rooms-changed): the whole picture — agents, rooms,
// decor, report history — belongs to the old project.
let switching = false;

async function switchTarget(root) {
  const previous = TARGET_ROOT;
  await stopWatchers();
  try {
    loadTarget(root);
  } catch (err) {
    loadTarget(previous);
    await startWatchers();
    rereadAfterReady();
    throw err;
  }
  await startWatchers();
  rereadAfterReady();
  console.log(`[project] switched target: ${previous} -> ${TARGET_ROOT} (${Object.keys(defs).length} agents)`);
  sendEvent("project-changed", { path: TARGET_ROOT, serverTime: new Date().toISOString() });
}

function currentProject() {
  const entry = projectRegistry.find(TARGET_ROOT);
  return { ...projectRegistry.describe(TARGET_ROOT, entry && entry.label), registered: Boolean(entry) };
}

loadTarget(resolveTargetRoot());
startWatchers();

// ---- http app -------------------------------------------------
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(express.json());

app.get("/api/snapshot", (req, res) => {
  res.json({ agents: snapshotAgents(), serverTime: new Date().toISOString() });
});

app.get("/api/rooms", (req, res) => {
  res.json(roomsWithAssets());
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  clients.add(res);
  broadcastServerStatus("online");

  req.on("close", () => {
    clients.delete(res);
  });
});

// ---- report history (docs/design/08-report-history.md) -------------------------------------------------
const VALID_LEVELS = new Set(["info", "warn", "error", "result"]);

app.get("/api/reports", (req, res) => {
  const { agentId, level, q, since, until, cursor, limit } = req.query;

  let levels;
  if (level) {
    levels = String(level)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const invalid = levels.find((l) => !VALID_LEVELS.has(l));
    if (invalid) return res.status(400).json({ error: `未知のlevelです: ${invalid}` });
  }

  let limitNum = 50;
  if (limit !== undefined) {
    limitNum = Number(limit);
    if (!Number.isFinite(limitNum) || limitNum <= 0) return res.status(400).json({ error: "limitは正の整数で指定してください" });
    limitNum = Math.min(limitNum, 200);
  }

  let cursorNum;
  if (cursor !== undefined) {
    cursorNum = Number(cursor);
    if (!Number.isFinite(cursorNum)) return res.status(400).json({ error: "cursorが不正です" });
  }

  const result = reportLog.query({
    agentId: agentId || undefined,
    levels,
    q: q || undefined,
    since: since || undefined,
    until: until || undefined,
    cursor: cursorNum,
    limit: limitNum,
  });
  res.json(result);
});

// docs/design/12-unread-reports-and-machine-log.md §3.2 — one agent's reports grouped by context.
app.get("/api/reports/contexts", (req, res) => {
  const { agentId, limit, before } = req.query;
  if (!agentId) return res.status(400).json({ error: "agentIdを指定してください" });
  let limitNum = 5;
  if (limit !== undefined) {
    limitNum = Number(limit);
    if (!Number.isInteger(limitNum) || limitNum <= 0) return res.status(400).json({ error: "limitは正の整数で指定してください" });
    limitNum = Math.min(limitNum, 50);
  }
  res.json(reportLog.contexts({ agentId: String(agentId), limit: limitNum, before: before ? String(before) : undefined }));
});

// docs/design/12 §4.2 — unread counts against the browser's read marks.
app.post("/api/reports/unread", (req, res) => {
  const marks = req.body && req.body.marks;
  if (marks !== undefined && (typeof marks !== "object" || marks === null || Array.isArray(marks))) {
    return res.status(400).json({ error: "marksはオブジェクトで指定してください" });
  }
  const clean = {};
  for (const [k, v] of Object.entries(marks || {})) if (typeof v === "string") clean[k] = v;
  res.json({ counts: reportLog.unreadCounts(clean) });
});

// ---- agent rename -------------------------------------------------
app.patch("/api/agents/:agentId/name", (req, res) => {
  const { agentId } = req.params;
  const def = defs[agentId];
  if (!def) return res.status(404).json({ error: `未知のエージェントです: ${agentId}` });

  const newName = String(req.body?.name || "").trim();
  if (!newName) return res.status(400).json({ error: "新しい名前を入力してください" });

  const newSlug = slugify(newName);
  if (!newSlug) return res.status(400).json({ error: "有効な名前を入力してください" });
  if (newSlug !== agentId && defs[newSlug]) {
    return res.status(400).json({ error: `そのIDのエージェントは既に存在します: ${newSlug}` });
  }

  try {
    const { newSlug: confirmedSlug, newFile } = renameAgentFile(AGENTS_DEF_DIR, def.sourceFile, newName);

    const oldStatePath = path.join(AGENTS_STATE_DIR, `${agentId}.json`);
    const newStatePath = path.join(AGENTS_STATE_DIR, `${confirmedSlug}.json`);
    if (agentId !== confirmedSlug && fs.existsSync(oldStatePath)) fs.renameSync(oldStatePath, newStatePath);

    const oldSprite = path.join(CHARACTER_ASSET_DIR, `${agentId}.png`);
    const newSprite = path.join(CHARACTER_ASSET_DIR, `${confirmedSlug}.png`);
    const spriteMoved = agentId !== confirmedSlug && fs.existsSync(oldSprite);
    if (spriteMoved) fs.renameSync(oldSprite, newSprite);

    // Animation bundles (docs/design/07-directional-animation-support.md §3.1)
    // live in a same-named directory alongside the single-file sprite - move
    // it too, or a rename would silently orphan the agent's animation.
    const oldAnimDir = path.join(CHARACTER_ASSET_DIR, agentId);
    const newAnimDir = path.join(CHARACTER_ASSET_DIR, confirmedSlug);
    const animMoved = agentId !== confirmedSlug && fs.existsSync(oldAnimDir);
    if (animMoved) fs.renameSync(oldAnimDir, newAnimDir);

    delete defs[agentId];
    if (agentId !== confirmedSlug && states[agentId]) {
      states[confirmedSlug] = states[agentId];
      delete states[agentId];
    }
    defs[confirmedSlug] = readAgentDef(path.join(AGENTS_DEF_DIR, newFile));

    broadcast("definition", agentId, "removed");
    broadcast("definition", confirmedSlug, "added");
    if (spriteMoved || animMoved) {
      broadcastAssetChange("character", agentId);
      broadcastAssetChange("character", confirmedSlug);
    }

    res.json({
      ok: true,
      agentId: confirmedSlug,
      warning:
        "他のエージェントの指示文やドキュメント内で名前が直接参照されている場合、そちらは自動更新されません。必要に応じて手動で確認してください。",
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---- custom character sprite upload -------------------------------------------------
app.post("/api/agents/:agentId/sprite", upload.single("sprite"), (req, res) => {
  const { agentId } = req.params;
  if (!defs[agentId]) return res.status(404).json({ error: `未知のエージェントです: ${agentId}` });
  if (!req.file) return res.status(400).json({ error: "画像ファイルが送信されていません" });
  if (req.file.mimetype !== "image/png") return res.status(400).json({ error: "PNG形式の画像のみアップロードできます" });
  if (req.file.size > CHARACTER_SPRITE.maxBytes) {
    return res.status(400).json({ error: `ファイルサイズが大きすぎます（上限 ${Math.floor(CHARACTER_SPRITE.maxBytes / 1024)}KB）` });
  }

  const size = readPngSize(req.file.buffer);
  if (!size) return res.status(400).json({ error: "PNGファイルとして読み取れませんでした" });
  if (size.width !== size.height) {
    return res.status(400).json({ error: `正方形の画像のみ対応しています（アップロードされた画像: ${size.width}×${size.height}px）` });
  }
  if (size.width < CHARACTER_SPRITE.minSize || size.width > CHARACTER_SPRITE.maxSize) {
    return res.status(400).json({
      error: `画像サイズは ${CHARACTER_SPRITE.minSize}〜${CHARACTER_SPRITE.maxSize}px の範囲にしてください（アップロードされた画像: ${size.width}px）`,
    });
  }

  saveAsset(CHARACTER_ASSET_DIR, agentId, req.file.buffer);
  broadcastAssetChange("character", agentId);
  res.json({ ok: true, ...characterSprite(agentId) });
});

app.delete("/api/agents/:agentId/sprite", (req, res) => {
  const { agentId } = req.params;
  removeAsset(CHARACTER_ASSET_DIR, agentId);
  broadcastAssetChange("character", agentId);
  res.json({ ok: true });
});

// ---- custom character animation bundle upload -------------------------------------------------
// docs/design/07-directional-animation-support.md §3.2. `ani_convert_app`'s
// output folder (anim-manifest.json + frame PNGs) is uploaded as a batch of
// files under one field name ("files") - a <input webkitdirectory multiple>
// selection sends every file in the folder that way (server/public/js/hud.js).
app.post("/api/agents/:agentId/animation", upload.array("files", 20), (req, res) => {
  const { agentId } = req.params;
  if (!defs[agentId]) return res.status(404).json({ error: `未知のエージェントです: ${agentId}` });

  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: "ファイルが送信されていません" });

  const manifestFile = files.find((f) => path.basename(f.originalname) === "anim-manifest.json");
  if (!manifestFile) {
    return res.status(400).json({ error: "anim-manifest.json が見つかりません。バンドルのフォルダごと選択してください。" });
  }

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  if (totalBytes > CHARACTER_ANIMATION.maxTotalBytes) {
    return res.status(400).json({
      error: `バンドルの合計サイズが大きすぎます（上限 ${Math.floor(CHARACTER_ANIMATION.maxTotalBytes / 1024 / 1024)}MB）`,
    });
  }

  for (const f of files) {
    const base = path.basename(f.originalname);
    if (base === "anim-manifest.json") continue;
    if (f.mimetype !== "image/png") return res.status(400).json({ error: `PNG形式以外のファイルが含まれています: ${base}` });

    const size = readPngSize(f.buffer);
    if (!size) return res.status(400).json({ error: `PNGファイルとして読み取れませんでした: ${base}` });
    if (size.width !== size.height) {
      return res.status(400).json({ error: `正方形以外の画像が含まれています: ${base}（${size.width}×${size.height}px）` });
    }
    if (size.width < CHARACTER_ANIMATION.minSize || size.width > CHARACTER_ANIMATION.maxSize) {
      return res.status(400).json({
        error: `画像サイズが範囲外です: ${base}（${size.width}px、対応範囲 ${CHARACTER_ANIMATION.minSize}〜${CHARACTER_ANIMATION.maxSize}px）`,
      });
    }
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestFile.buffer.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "anim-manifest.json の形式が不正です（JSONとして読み取れませんでした）" });
  }
  if (!manifest.views || typeof manifest.views !== "object" || !manifest.views.front) {
    return res.status(400).json({ error: "anim-manifest.json に front ビューがありません（正面は必須です）" });
  }

  saveAnimationBundle(CHARACTER_ASSET_DIR, agentId, files);
  broadcastAssetChange("character", agentId);
  res.json({ ok: true, ...characterAnimation(agentId) });
});

app.delete("/api/agents/:agentId/animation", (req, res) => {
  const { agentId } = req.params;
  removeAnimationBundle(CHARACTER_ASSET_DIR, agentId);
  broadcastAssetChange("character", agentId);
  res.json({ ok: true });
});

// ---- rooms: rename / add / delete -------------------------------------------------
app.patch("/api/rooms/:roomId", (req, res) => {
  const { roomId } = req.params;
  const label = String(req.body?.label || "").trim();
  if (!label) return res.status(400).json({ error: "新しい名前を入力してください" });

  const ok = roomsStore.renameRoom(roomId, label);
  if (!ok) return res.status(404).json({ error: `未知の部屋です: ${roomId}` });
  broadcastRoomsChanged();
  res.json({ ok: true });
});

app.post("/api/rooms", (req, res) => {
  const label = String(req.body?.label || "").trim();
  if (!label) return res.status(400).json({ error: "部屋名を入力してください" });
  const keywords = Array.isArray(req.body?.keywords) ? req.body.keywords.map(String).filter(Boolean) : [];

  const roomId = roomsStore.addRoom(label, keywords);
  broadcastRoomsChanged();
  res.json({ ok: true, roomId });
});

app.delete("/api/rooms/:roomId", (req, res) => {
  const { roomId } = req.params;
  if (roomId === roomsStore.getRaw().breakRoom.id) {
    return res.status(400).json({ error: "休憩所は削除できません" });
  }
  const ok = roomsStore.deleteRoom(roomId);
  if (!ok) return res.status(404).json({ error: `未知の部屋です: ${roomId}` });

  removeAsset(ROOM_ASSET_DIR, roomId);
  broadcastRoomsChanged();
  res.json({ ok: true });
});

// ---- custom room tile upload -------------------------------------------------
app.post("/api/rooms/:roomId/tile", upload.single("tile"), (req, res) => {
  const { roomId } = req.params;
  if (!roomsStore.allRoomIds().has(roomId)) return res.status(404).json({ error: `未知の部屋です: ${roomId}` });
  if (!req.file) return res.status(400).json({ error: "画像ファイルが送信されていません" });
  if (req.file.mimetype !== "image/png") return res.status(400).json({ error: "PNG形式の画像のみアップロードできます" });
  if (req.file.size > ROOM_TILE.maxBytes) {
    return res.status(400).json({ error: `ファイルサイズが大きすぎます（上限 ${Math.floor(ROOM_TILE.maxBytes / 1024)}KB）` });
  }

  const size = readPngSize(req.file.buffer);
  if (!size) return res.status(400).json({ error: "PNGファイルとして読み取れませんでした" });
  if (
    size.width < ROOM_TILE.minSize ||
    size.width > ROOM_TILE.maxSize ||
    size.height < ROOM_TILE.minSize ||
    size.height > ROOM_TILE.maxSize
  ) {
    return res.status(400).json({
      error: `画像サイズは ${ROOM_TILE.minSize}〜${ROOM_TILE.maxSize}px の範囲にしてください（アップロードされた画像: ${size.width}×${size.height}px）`,
    });
  }

  saveAsset(ROOM_ASSET_DIR, roomId, req.file.buffer);
  broadcastAssetChange("room", roomId);
  res.json({ ok: true, ...roomTile(roomId) });
});

app.delete("/api/rooms/:roomId/tile", (req, res) => {
  const { roomId } = req.params;
  if (!roomsStore.allRoomIds().has(roomId)) return res.status(404).json({ error: `未知の部屋です: ${roomId}` });
  removeAsset(ROOM_ASSET_DIR, roomId);
  broadcastAssetChange("room", roomId);
  res.json({ ok: true });
});

// ---- decor part library (docs/design/09-ai-office-redesign.md §6.3) -------------------------------------------------
app.get("/api/decor", (req, res) => {
  res.json(decorLibrary());
});

app.post("/api/decor/:category", upload.single("image"), (req, res) => {
  const { category } = req.params;
  const error = decorStore.validateDecorImage(category, req.file);
  if (error) return res.status(400).json({ error });

  const name = decorStore.saveCustomPart(DECOR_ASSET_DIR, category, req.file.originalname, req.file.buffer);
  const partId = `custom:${category}/${name}`;
  broadcastDecorLibraryChanged();
  const part = decorLibrary().custom[category].find((p) => p.id === partId);
  res.json({ ok: true, part });
});

app.delete("/api/decor/:category/:name", (req, res) => {
  const { category, name } = req.params;
  if (!decorStore.removeCustomPart(DECOR_ASSET_DIR, category, name)) {
    return res.status(404).json({ error: `部品が見つかりません: custom:${category}/${name}` });
  }
  // Rooms that used it fall back to their theme default (§6.3).
  const affected = roomsStore.clearPartReferences(`custom:${category}/${name}`);
  broadcastDecorLibraryChanged();
  broadcastRoomDecorChanged(affected);
  res.json({ ok: true, affectedRooms: affected });
});

// Body: { changes: { [slotId]: partId | null } } — only the listed slots change.
app.put("/api/rooms/:roomId/decor", (req, res) => {
  const { roomId } = req.params;
  if (!roomsStore.findRoom(roomId)) return res.status(404).json({ error: `未知の部屋です: ${roomId}` });
  const changes = req.body && req.body.changes;
  if (!changes || typeof changes !== "object" || Array.isArray(changes) || Object.keys(changes).length === 0) {
    return res.status(400).json({ error: "変更内容（changes）がありません" });
  }
  for (const [slotId, partId] of Object.entries(changes)) {
    const error = decorStore.validateSlotValue(DECOR_ASSET_DIR, slotId, partId);
    if (error) return res.status(400).json({ error });
  }

  const decor = roomsStore.setRoomDecor(roomId, changes, decorStore.TOP_LEVEL_SLOTS);
  broadcastRoomDecorChanged([roomId]);
  res.json({ ok: true, decor });
});

// "この部屋を初期状態に戻す" — back to the room's theme defaults.
app.delete("/api/rooms/:roomId/decor", (req, res) => {
  const { roomId } = req.params;
  if (!roomsStore.resetRoomDecor(roomId)) return res.status(404).json({ error: `未知の部屋です: ${roomId}` });
  broadcastRoomDecorChanged([roomId]);
  res.json({ ok: true });
});

// ---- config overview (docs/design/10-config-overview.md) -------------------------------------------------
// Re-read on every request: settings files change rarely, so no watcher.
app.get("/api/config", (req, res) => {
  try {
    res.json(readConfigOverview(TARGET_ROOT));
  } catch (err) {
    res.status(500).json({ error: `構成の読み込みに失敗しました: ${err.message}` });
  }
});

// ---- Agent Village's own settings (docs/design/12-unread-reports-and-machine-log.md §5.2) ----------
function villageSettingsBody() {
  const settings = villageSettings.readSettings(TARGET_ROOT);
  return {
    settings,
    resolvedMachineLogDir: villageSettings.resolveDir(TARGET_ROOT, settings.machineLog.dir),
    defaultMachineLogDir: villageSettings.DEFAULT_MACHINE_LOG_DIR,
    defaultStaleAfterMinutes: villageSettings.DEFAULT_STALE_AFTER_MINUTES,
    file: path.relative(TARGET_ROOT, villageSettings.settingsFile(TARGET_ROOT)).split(path.sep).join("/"),
  };
}

app.get("/api/village-settings", (req, res) => {
  res.json(villageSettingsBody());
});

// Body: { machineLog: {...} } or { display: { staleAfterMinutes } } (docs/design/13 §2.1).
app.put("/api/village-settings", (req, res) => {
  const disp = req.body && req.body.display;
  if (disp !== undefined) {
    if (!disp || typeof disp !== "object") return res.status(400).json({ error: "displayはオブジェクトで指定してください" });
    try {
      const r = villageSettings.writeDisplay(TARGET_ROOT, disp);
      if (r.error) return res.status(400).json({ error: r.error });
    } catch (err) {
      return res.status(500).json({ error: `設定を保存できませんでした: ${err.message}` });
    }
    // Every open tab re-judges 応答なし？ with the new threshold.
    sendEvent("village-settings-changed", villageSettingsBody());
    return res.json(villageSettingsBody());
  }
  const ml = req.body && req.body.machineLog;
  if (!ml || typeof ml !== "object") return res.status(400).json({ error: "machineLogを指定してください" });
  if (ml.enabled !== undefined && typeof ml.enabled !== "boolean") return res.status(400).json({ error: "enabledはtrue/falseで指定してください" });
  if (ml.dir !== undefined && typeof ml.dir !== "string") return res.status(400).json({ error: "保存場所は文字列で指定してください" });
  try {
    const result = villageSettings.writeMachineLog(TARGET_ROOT, ml);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(villageSettingsBody());
  } catch (err) {
    res.status(500).json({ error: `設定を保存できませんでした: ${err.message}` });
  }
});

// ---- project switcher (docs/design/11-project-switcher.md §3-§4) -------------------------------------------------
app.get("/api/projects", (req, res) => {
  res.json({ current: currentProject(), projects: projectRegistry.list() });
});

app.post("/api/projects", (req, res) => {
  const result = projectRegistry.add(req.body?.path, req.body?.label);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, project: result.project, current: currentProject(), projects: projectRegistry.list() });
});

// Removing only forgets the entry — nothing in the project folder is touched.
app.delete("/api/projects", (req, res) => {
  if (!projectRegistry.remove(req.body?.path || "")) return res.status(404).json({ error: "登録されていないプロジェクトです" });
  res.json({ ok: true, current: currentProject(), projects: projectRegistry.list() });
});

// Only registered folders can be switched to — the list is the allow-list.
app.post("/api/projects/switch", async (req, res) => {
  const entry = req.body?.path ? projectRegistry.find(req.body.path) : null;
  if (!entry) return res.status(400).json({ error: "登録されていないプロジェクトには切り替えられません" });
  const root = projectRegistry.normalize(entry.path);
  if (projectRegistry.samePath(root, TARGET_ROOT)) return res.json({ ok: true, unchanged: true, current: currentProject() });
  const info = projectRegistry.describe(root, entry.label);
  if (!info.exists) return res.status(400).json({ error: `フォルダが見つかりません: ${root}` });
  if (switching) return res.status(409).json({ error: "別の切り替えを処理中です。少し待ってからやり直してください" });

  switching = true;
  try {
    await switchTarget(root);
    res.json({ ok: true, current: currentProject() });
  } catch (err) {
    res.status(500).json({ error: `切り替えに失敗したため、元のプロジェクトに戻しました: ${err.message}` });
  } finally {
    switching = false;
  }
});

app.use("/assets/custom", (req, res, next) => customAssetStatic(req, res, next));
app.use(express.static(PUBLIC_DIR));

// Only opened when launched through the `agent-village` CLI (bin/agent-village.js
// sets this) — the raw `node server/src/index.js` dev entry point stays silent so
// restarting during development doesn't keep popping new browser tabs.
function openBrowser(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) console.warn(`[startup] could not auto-open browser: ${err.message}`);
  });
}

app.listen(PORT, HOST, () => {
  console.log(`Agent Village server listening on http://localhost:${PORT}${HOST === "127.0.0.1" ? "" : ` (host ${HOST})`}`);
  console.log(`  target project:      ${TARGET_ROOT}`);
  console.log(`  watching definitions: ${AGENTS_DEF_DIR}`);
  console.log(`  watching state:       ${AGENTS_STATE_DIR}`);
  console.log(`  watching report logs: ${AGENTS_LOGS_DIR}`);
  console.log(`  watching assets:      ${CHARACTER_ASSET_DIR}, ${ROOM_ASSET_DIR}, ${DECOR_ASSET_DIR}`);
  console.log(`  rooms config:         ${ROOMS_FILE}${roomsFileWasCreated ? " (created from template)" : ""}`);
  console.log(`  agents loaded:        ${Object.keys(defs).length} (${Object.keys(defs).join(", ") || "none"})`);

  if (process.env.AGENT_VILLAGE_AUTO_OPEN === "1") openBrowser(`http://localhost:${PORT}`);
});
