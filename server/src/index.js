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
const TARGET_ROOT = resolveTargetRoot();
const AGENTS_DEF_DIR = path.join(TARGET_ROOT, ".claude", "agents");
const AGENTS_STATE_DIR = path.join(TARGET_ROOT, "agents", "state");
const CHARACTER_ASSET_DIR = path.join(TARGET_ROOT, "assets", "custom", "characters");
const ROOM_ASSET_DIR = path.join(TARGET_ROOT, "assets", "custom", "rooms");
const ROOMS_FILE = path.join(TARGET_ROOT, "agents", "config", "rooms.json");
const ROOMS_TEMPLATE_FILE = path.join(__dirname, "config", "rooms.default.json");
const PUBLIC_DIR = path.join(INSTALL_ROOT, "public");
const PORT = process.env.PORT || 4173;

// ---- in-memory store -------------------------------------------------
let defs = readAllAgentDefs(AGENTS_DEF_DIR); // agentId -> def
let states = readAllStates(AGENTS_STATE_DIR); // agentId -> raw state json

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
    breakRoom: withTile(computed.breakRoom),
    rooms: computed.rooms.map(withTile),
    genericDesk: computed.genericDesk,
    constraints: { characterSprite: CHARACTER_SPRITE, roomTile: ROOM_TILE, characterAnimation: CHARACTER_ANIMATION },
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

// ---- debounce helpers -------------------------------------------------
const pendingTimers = new Map();
const DEBOUNCE_MS = 150;

function scheduleReload(kind, filePath) {
  const key = `${kind}:${filePath}`;
  if (pendingTimers.has(key)) clearTimeout(pendingTimers.get(key));
  pendingTimers.set(
    key,
    setTimeout(() => {
      pendingTimers.delete(key);
      reloadOne(kind, filePath);
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
  } else if (kind === "rooms-file") {
    roomsStore.load();
    broadcastRoomsChanged();
  }
}

// ---- watchers -------------------------------------------------
fs.mkdirSync(AGENTS_DEF_DIR, { recursive: true });
fs.mkdirSync(AGENTS_STATE_DIR, { recursive: true });
fs.mkdirSync(CHARACTER_ASSET_DIR, { recursive: true });
fs.mkdirSync(ROOM_ASSET_DIR, { recursive: true });

// The target project doesn't necessarily have a rooms.json of its own yet —
// bootstrap-copy the bundled default on first run (docs/design/04-multi-project-integration.md §4).
// Never overwrite an existing one: room edits made from the dashboard live here.
fs.mkdirSync(path.dirname(ROOMS_FILE), { recursive: true });
const roomsFileWasCreated = !fs.existsSync(ROOMS_FILE);
if (roomsFileWasCreated) fs.copyFileSync(ROOMS_TEMPLATE_FILE, ROOMS_FILE);
roomsStore.init(ROOMS_FILE);

const watchOpts = { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 } };

chokidar
  .watch(AGENTS_DEF_DIR, watchOpts)
  .on("add", (p) => scheduleReload("definition", p))
  .on("change", (p) => scheduleReload("definition", p))
  .on("unlink", (p) => scheduleReload("definition", p));

chokidar
  .watch(AGENTS_STATE_DIR, watchOpts)
  .on("add", (p) => scheduleReload("state", p))
  .on("change", (p) => scheduleReload("state", p))
  .on("unlink", (p) => scheduleReload("state", p));

// Watching the asset folders too (not just the upload endpoints below) means
// an artist can drop a PNG in by hand and the dashboard still picks it up.
chokidar
  .watch(CHARACTER_ASSET_DIR, watchOpts)
  .on("add", (p) => scheduleReload("character-asset", p))
  .on("change", (p) => scheduleReload("character-asset", p))
  .on("unlink", (p) => scheduleReload("character-asset", p));

chokidar
  .watch(ROOM_ASSET_DIR, watchOpts)
  .on("add", (p) => scheduleReload("room-asset", p))
  .on("change", (p) => scheduleReload("room-asset", p))
  .on("unlink", (p) => scheduleReload("room-asset", p));

// Picks up hand-edits to rooms.json too, not just changes made through the API.
chokidar.watch(ROOMS_FILE, watchOpts).on("change", () => scheduleReload("rooms-file", ROOMS_FILE));

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

app.use("/assets/custom", express.static(path.join(TARGET_ROOT, "assets", "custom")));
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

app.listen(PORT, () => {
  console.log(`Agent Village server listening on http://localhost:${PORT}`);
  console.log(`  target project:      ${TARGET_ROOT}`);
  console.log(`  watching definitions: ${AGENTS_DEF_DIR}`);
  console.log(`  watching state:       ${AGENTS_STATE_DIR}`);
  console.log(`  watching assets:      ${CHARACTER_ASSET_DIR}, ${ROOM_ASSET_DIR}`);
  console.log(`  rooms config:         ${ROOMS_FILE}${roomsFileWasCreated ? " (created from template)" : ""}`);
  console.log(`  agents loaded:        ${Object.keys(defs).length} (${Object.keys(defs).join(", ") || "none"})`);

  if (process.env.AGENT_VILLAGE_AUTO_OPEN === "1") openBrowser(`http://localhost:${PORT}`);
});
