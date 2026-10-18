// Agent Village's own per-project settings — docs/design/12-unread-reports-and-machine-log.md §5.2.
//
// Stored in <project>/agents/config/village.json. Shared by the server (GET/PUT
// /api/village-settings) and bin/agent-village-hook.js, which re-reads it on
// every hook call — so a missing or corrupt file must quietly fall back to the
// defaults instead of throwing.
const fs = require("fs");
const path = require("path");

const DEFAULT_MACHINE_LOG_DIR = "agents/machine-logs";
// docs/design/13-room-groups-and-stale.md §2.1 — "working" with no update for
// this long is shown as 応答なし？ (hooks only write on start/stop/permission).
const DEFAULT_STALE_AFTER_MINUTES = 60;
const STALE_MIN = 1;
const STALE_MAX = 1440;

function settingsFile(root) {
  return path.join(root, "agents", "config", "village.json");
}

function defaults() {
  return { machineLog: { enabled: true, dir: DEFAULT_MACHINE_LOG_DIR }, display: { staleAfterMinutes: DEFAULT_STALE_AFTER_MINUTES } };
}

function readRaw(root) {
  try {
    const obj = JSON.parse(fs.readFileSync(settingsFile(root), "utf8"));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function readSettings(root) {
  const raw = readRaw(root);
  const ml = raw.machineLog && typeof raw.machineLog === "object" ? raw.machineLog : {};
  const d = defaults().machineLog;
  const disp = raw.display && typeof raw.display === "object" ? raw.display : {};
  return {
    machineLog: {
      enabled: typeof ml.enabled === "boolean" ? ml.enabled : d.enabled,
      dir: typeof ml.dir === "string" && ml.dir.trim() ? ml.dir.trim() : d.dir,
    },
    display: {
      staleAfterMinutes: validStaleMinutes(disp.staleAfterMinutes) ? disp.staleAfterMinutes : DEFAULT_STALE_AFTER_MINUTES,
    },
  };
}

function validStaleMinutes(v) {
  return Number.isInteger(v) && v >= STALE_MIN && v <= STALE_MAX;
}

function saveRaw(root, raw) {
  const file = settingsFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(raw, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

function writeDisplay(root, { staleAfterMinutes }) {
  if (!validStaleMinutes(staleAfterMinutes)) return { error: `分数は ${STALE_MIN}〜${STALE_MAX} の整数で指定してください` };
  const raw = readRaw(root);
  raw.display = { ...(raw.display && typeof raw.display === "object" ? raw.display : {}), staleAfterMinutes };
  saveRaw(root, raw);
  return { settings: readSettings(root) };
}

function resolveDir(root, dir) {
  return path.resolve(root, dir);
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Returns an error message (Japanese, shown as-is in the UI) or null.
function validateMachineLogDir(root, dir) {
  if (typeof dir !== "string" || !dir.trim()) return "保存場所を入力してください";
  if (/[\u0000-\u001f]/.test(dir)) return "保存場所に使えない文字が含まれています";
  const abs = resolveDir(root, dir.trim());
  if (isInside(abs, path.join(root, ".claude"))) return ".claude フォルダの中には保存できません（Claude Code の設定用のフォルダです）";
  try {
    if (fs.existsSync(abs) && !fs.statSync(abs).isDirectory()) return "その場所にはフォルダではなくファイルがあります";
    fs.mkdirSync(abs, { recursive: true });
  } catch (err) {
    return `フォルダを作れませんでした（${err.code || err.message}）`;
  }
  return null;
}

// Validates and saves; keeps any unrelated keys already in the file.
function writeMachineLog(root, { enabled, dir }) {
  const current = readSettings(root).machineLog;
  const next = {
    enabled: typeof enabled === "boolean" ? enabled : current.enabled,
    dir: dir === undefined ? current.dir : dir,
  };
  const err = validateMachineLogDir(root, next.dir);
  if (err) return { error: err };
  next.dir = next.dir.trim();
  const raw = readRaw(root);
  raw.machineLog = next;
  saveRaw(root, raw);
  return { settings: readSettings(root) };
}

// Local calendar date, so one file == one day as the user sees it.
function localDateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function machineLogFile(root, agentId, settings = readSettings(root), date = new Date()) {
  return path.join(resolveDir(root, settings.machineLog.dir), agentId, `${localDateStamp(date)}.ndjson`);
}

module.exports = {
  DEFAULT_MACHINE_LOG_DIR,
  DEFAULT_STALE_AFTER_MINUTES,
  settingsFile,
  readSettings,
  resolveDir,
  validateMachineLogDir,
  writeMachineLog,
  writeDisplay,
  machineLogFile,
  localDateStamp,
};
