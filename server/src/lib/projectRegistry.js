// Registered project folders for the header's project switcher
// (docs/design/11-project-switcher.md §3).
//
// The list belongs to this installation, not to any one target project, so it
// lives under INSTALL_ROOT/.agent-village/ (git-ignored: the paths are
// machine-specific). Only folders on this list can be switched to through the
// API — the switch endpoint never accepts an arbitrary path.
const fs = require("fs");
const path = require("path");

const LABEL_MAX = 40;

let REGISTRY_FILE = null;

function init(registryFilePath) {
  REGISTRY_FILE = registryFilePath;
}

function normalize(p) {
  return path.resolve(String(p).trim());
}

// Windows paths are case-insensitive: "D:\App" and "d:\app" are the same folder.
function samePath(a, b) {
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function load() {
  try {
    const parsed = JSON.parse(fs.readFileSync(REGISTRY_FILE, "utf8"));
    return Array.isArray(parsed.projects) ? parsed.projects.filter((p) => p && typeof p.path === "string") : [];
  } catch {
    return []; // missing or unreadable file = empty list
  }
}

function persist(projects) {
  fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
  const tmp = `${REGISTRY_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ projects }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, REGISTRY_FILE);
}

function find(p) {
  const target = normalize(p);
  return load().find((entry) => samePath(normalize(entry.path), target)) || null;
}

// Hooks are configured per project (docs/design/05, 06). Without them the
// dashboard still shows the agent definitions, but never any live status —
// worth flagging in the switcher so an empty office isn't a mystery.
function hookConfigured(root) {
  for (const name of ["settings.json", "settings.local.json"]) {
    try {
      if (fs.readFileSync(path.join(root, ".claude", name), "utf8").includes("agent-village-hook")) return true;
    } catch {
      // file absent — try the next one
    }
  }
  return false;
}

function describe(p, label) {
  const root = normalize(p);
  let exists = false;
  try {
    exists = fs.statSync(root).isDirectory();
  } catch {
    exists = false;
  }
  let agentCount = 0;
  if (exists) {
    try {
      agentCount = fs.readdirSync(path.join(root, ".claude", "agents")).filter((f) => f.toLowerCase().endsWith(".md")).length;
    } catch {
      agentCount = 0;
    }
  }
  return {
    path: root,
    label: label || path.basename(root) || root,
    exists,
    agentCount,
    hookConfigured: exists && hookConfigured(root),
  };
}

function list() {
  return load().map((entry) => describe(entry.path, entry.label));
}

// Returns an error message (Japanese, shown as-is in the UI), or null when valid.
function validateNewPath(p) {
  if (typeof p !== "string" || !p.trim()) return "フォルダのパスを入力してください";
  if (!path.isAbsolute(p.trim())) return "絶対パスで入力してください（例: D:\\app\\my_project）";
  const root = normalize(p);
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    return `フォルダが見つかりません: ${root}`;
  }
  if (!stat.isDirectory()) return `フォルダではありません: ${root}`;
  // The usual mistakes: the .claude folder itself, or .claude\agents, instead
  // of the project folder that contains them.
  const parts = root.split(/[\\/]+/);
  const claudeIdx = parts.map((s) => s.toLowerCase()).lastIndexOf(".claude");
  if (claudeIdx > 0) {
    const projectRoot = parts.slice(0, claudeIdx).join(path.sep);
    return `.claude フォルダの中が指定されています。その外側のプロジェクトのフォルダ（${projectRoot}）を登録してください`;
  }
  // A Claude Code project always has a .claude folder. Requiring it keeps a
  // typo'd path (e.g. a parent folder) from getting agents/ folders created in it
  // on switch.
  if (!fs.existsSync(path.join(root, ".claude"))) {
    // A parent folder like D:\app: point at the projects inside it.
    let inside = [];
    try {
      inside = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, ".claude")))
        .map((d) => d.name);
    } catch {
      inside = [];
    }
    if (inside.length) {
      const names = inside.slice(0, 3).join("、") + (inside.length > 3 ? ` ほか${inside.length - 3}件` : "");
      return `このフォルダには .claude フォルダがありません。中にあるプロジェクト（${names}）のどれかを登録してください`;
    }
    return `.claude フォルダがありません（Claude Code のプロジェクトではないようです）: ${root}`;
  }
  return null;
}

function add(p, label) {
  const error = validateNewPath(p);
  if (error) return { error };
  const root = normalize(p);
  const projects = load();
  if (projects.some((entry) => samePath(normalize(entry.path), root))) return { error: `すでに登録されています: ${root}` };
  const cleanLabel = String(label || "").trim().slice(0, LABEL_MAX) || path.basename(root);
  projects.push({ path: root, label: cleanLabel, addedAt: new Date().toISOString() });
  persist(projects);
  return { project: describe(root, cleanLabel) };
}

function remove(p) {
  const root = normalize(p);
  const projects = load();
  const next = projects.filter((entry) => !samePath(normalize(entry.path), root));
  if (next.length === projects.length) return false;
  persist(next);
  return true;
}

module.exports = { init, list, find, describe, add, remove, samePath, normalize };
