// Hook setup from the dashboard (docs/design/15-setup-guide-and-glossary.md §4).
// Reads where Agent Village's hook is registered, and adds/removes it in the
// target project's .claude/settings.local.json or settings.json. Only the
// fixed hook command is ever written, everything else in the file is kept,
// and the previous file is kept as a timestamped backup next to it.
const fs = require("fs");
const path = require("path");
const { userClaudeDir } = require("./configOverview");

const HOOK_MARK = "agent-village-hook";
// SubagentStart/Stop drive working/done; PermissionRequest only adds the
// permission-wait bubble (docs/manual-install-guide.md §5).
const EVENTS = [
  { event: "SubagentStart", required: true },
  { event: "SubagentStop", required: true },
  { event: "PermissionRequest", required: false },
];
const TARGETS = {
  local: { name: "settings.local.json", label: ".claude/settings.local.json" },
  shared: { name: "settings.json", label: ".claude/settings.json" },
};

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

function hookScriptPath(installRoot) {
  return path.join(installRoot, "bin", "agent-village-hook.js").split(path.sep).join("/");
}

function hookCommand(installRoot) {
  return `node "${hookScriptPath(installRoot)}"`;
}

// The script path inside a registered command, to tell whether it still exists.
function scriptPathOf(command) {
  const m = /"([^"]*agent-village-hook(?:\.js)?)"/.exec(command) || /(\S*agent-village-hook(?:\.js)?)/.exec(command);
  return m ? m[1] : null;
}

function settingsCandidates(root) {
  return [
    { id: "local", file: path.join(root, ".claude", TARGETS.local.name), label: TARGETS.local.label, scope: "project" },
    { id: "shared", file: path.join(root, ".claude", TARGETS.shared.name), label: TARGETS.shared.label, scope: "project" },
    { id: "user", file: path.join(userClaudeDir(), "settings.json"), label: "~/.claude/settings.json", scope: "user" },
  ];
}

// { exists, data, error }: a missing file is fine (empty settings), an
// unreadable or non-object JSON one is reported and never written over.
function readSettings(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { exists: false, data: {}, text: "" };
    return { exists: true, error: `読めません: ${err.message}` };
  }
  if (!text.trim()) return { exists: true, data: {}, text };
  try {
    const data = JSON.parse(text.replace(/^﻿/, ""));
    if (!isObj(data)) return { exists: true, error: "中身が JSON のオブジェクト（{ … }）ではありません" };
    return { exists: true, data, text };
  } catch (err) {
    return { exists: true, error: `JSON として読めません: ${err.message}` };
  }
}

// Agent Village hook commands per event in one settings object.
function villageHooks(data) {
  const out = {};
  if (!isObj(data.hooks)) return out;
  for (const [event, groups] of Object.entries(data.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) continue;
      for (const h of g.hooks) {
        if (isObj(h) && typeof h.command === "string" && h.command.includes(HOOK_MARK)) (out[event] = out[event] || []).push(h.command);
      }
    }
  }
  return out;
}

function status(root, installRoot) {
  const command = hookCommand(installRoot);
  const files = settingsCandidates(root).map((c) => {
    const r = readSettings(c.file);
    return { ...c, exists: r.exists, error: r.error || null, hooks: r.error ? {} : villageHooks(r.data) };
  });
  const events = EVENTS.map(({ event, required }) => {
    const installed = [];
    for (const f of files) {
      for (const cmd of f.hooks[event] || []) {
        const script = scriptPathOf(cmd);
        installed.push({ file: f.label, scope: f.scope, command: cmd, scriptFound: !!script && fs.existsSync(script), current: cmd === command });
      }
    }
    return { event, required, installed };
  });
  const ok = (e) => e.installed.some((i) => i.scriptFound);
  return {
    root,
    // tests turn the automatic opening off (AGENT_VILLAGE_SETUP_AUTO_OPEN=0), like AGENT_VILLAGE_AUTO_OPEN
    autoOpen: process.env.AGENT_VILLAGE_SETUP_AUTO_OPEN !== "0",
    command,
    scriptPath: hookScriptPath(installRoot),
    events,
    requiredOk: events.filter((e) => e.required).every(ok),
    allOk: events.every(ok),
    targets: files
      .filter((f) => f.scope === "project")
      .map(({ id, label, exists, error }) => ({ id, label, exists, error })),
  };
}

// Returns the new settings object (input is not modified) and what changed.
function planInstall(data, command) {
  const next = JSON.parse(JSON.stringify(data));
  if (!isObj(next.hooks)) next.hooks = {};
  const added = [];
  const updated = [];
  for (const { event } of EVENTS) {
    const groups = Array.isArray(next.hooks[event]) ? next.hooks[event] : (next.hooks[event] = []);
    let found = false;
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) continue;
      for (const h of g.hooks) {
        if (isObj(h) && typeof h.command === "string" && h.command.includes(HOOK_MARK)) {
          found = true;
          // an older install location: point it at this one
          if (h.command !== command) {
            h.command = command;
            updated.push(event);
          }
        }
      }
    }
    if (!found) {
      groups.push({ matcher: "", hooks: [{ type: "command", command }] });
      added.push(event);
    }
  }
  return { next, added, updated: [...new Set(updated)] };
}

function planUninstall(data) {
  const next = JSON.parse(JSON.stringify(data));
  const removed = [];
  if (!isObj(next.hooks)) return { next, removed };
  for (const [event, groups] of Object.entries(next.hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    for (const g of groups) {
      if (!isObj(g) || !Array.isArray(g.hooks)) {
        kept.push(g);
        continue;
      }
      const hooks = g.hooks.filter((h) => !(isObj(h) && typeof h.command === "string" && h.command.includes(HOOK_MARK)));
      if (hooks.length !== g.hooks.length && !removed.includes(event)) removed.push(event);
      if (hooks.length) kept.push({ ...g, hooks });
    }
    if (kept.length) next.hooks[event] = kept;
    else delete next.hooks[event];
  }
  if (!Object.keys(next.hooks).length) delete next.hooks;
  return { next, removed };
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// action "install" | "uninstall", target "local" | "shared". With dryRun the
// file is left alone and only the would-be result is returned.
function apply(root, installRoot, { action, target, dryRun }) {
  const t = TARGETS[target];
  if (!t) return { error: "書き込み先は local か shared を指定してください" };
  if (action !== "install" && action !== "uninstall") return { error: "action は install か uninstall を指定してください" };
  const file = path.join(root, ".claude", t.name);
  const cur = readSettings(file);
  if (cur.error) return { error: `${t.label} が${cur.error}。ファイルを直してから、もう一度お試しください` };

  const plan = action === "install" ? planInstall(cur.data, hookCommand(installRoot)) : planUninstall(cur.data);
  const changes = action === "install" ? { added: plan.added, updated: plan.updated } : { removed: plan.removed };
  const changed = action === "install" ? plan.added.length + plan.updated.length > 0 : plan.removed.length > 0;
  const after = `${JSON.stringify(plan.next, null, 2)}\n`;
  const result = { file: t.label, existed: cur.exists, before: cur.text, after, changed, ...changes, backup: null };
  if (dryRun || !changed) return result;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (cur.exists) {
    const backup = `${file}.bak-${stamp()}`;
    fs.copyFileSync(file, backup);
    result.backup = path.relative(root, backup).split(path.sep).join("/");
  }
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, after, "utf8");
  fs.renameSync(tmp, file);
  // read back: the file Claude Code will load must be valid JSON
  const check = readSettings(file);
  if (check.error) return { ...result, error: `書き込んだ ${t.label} を読み直せませんでした: ${check.error}` };
  return result;
}

module.exports = { status, apply, hookCommand, EVENTS, HOOK_MARK };
