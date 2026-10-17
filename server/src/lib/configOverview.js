const fs = require("fs");
const os = require("os");
const path = require("path");
const { readAllAgentDefs } = require("./agentDefs");
const { maskString, maskArgs, maskMapValue } = require("./secretMask");

// Read-only overview of a project's Claude Code setup for the "構成" view
// (docs/design/10-config-overview.md). Reads the project folder plus the user-wide
// ~/.claude/ folder — never ~/.claude.json, which also holds login data — and masks
// everything secret-looking here, before it leaves the server.

const DESCRIPTION_MAX = 300;

// Tests point this at a scratch folder so they never read the real home.
function userClaudeDir() {
  return process.env.AGENT_VILLAGE_USER_CLAUDE_DIR ? path.resolve(process.env.AGENT_VILLAGE_USER_CLAUDE_DIR) : path.join(os.homedir(), ".claude");
}

// `label` is how paths of that scope are shown (sources, item files).
function scopes(root) {
  return [
    { scope: "project", dir: path.join(root, ".claude"), label: ".claude" },
    { scope: "user", dir: userClaudeDir(), label: "~/.claude" },
  ];
}

// Lowest priority first, like Claude Code applies them.
function settingsFiles(root) {
  const user = userClaudeDir();
  return [
    { file: path.join(user, "settings.json"), label: "~/.claude/settings.json", scope: "user" },
    { file: path.join(root, ".claude", "settings.json"), label: ".claude/settings.json", scope: "project" },
    { file: path.join(root, ".claude", "settings.local.json"), label: ".claude/settings.local.json", scope: "project" },
  ];
}

function memoryFiles(root) {
  return [
    { file: path.join(root, "CLAUDE.md"), label: "CLAUDE.md", scope: "project" },
    { file: path.join(root, ".claude", "CLAUDE.md"), label: ".claude/CLAUDE.md", scope: "project" },
    { file: path.join(root, "CLAUDE.local.md"), label: "CLAUDE.local.md", scope: "project" },
    { file: path.join(userClaudeDir(), "CLAUDE.md"), label: "~/.claude/CLAUDE.md", scope: "user" },
  ];
}

function shortDescription(text) {
  const plain = String(text || "")
    .replace(/<example>[\s\S]*?<\/example>/gi, " ")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > DESCRIPTION_MAX ? plain.slice(0, DESCRIPTION_MAX - 1) + "…" : plain;
}

// Skill/command frontmatter: top-level `key: value` lines; a value may continue
// on indented lines (incl. YAML `>` / `|` blocks). Enough for name/description.
function frontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const fields = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const km = line.match(/^([A-Za-z][\w-]*):\s?(.*)$/);
    if (km) {
      key = km[1];
      fields[key] = /^[>|][+-]?$/.test(km[2].trim()) ? "" : km[2];
    } else if (key && /^\s/.test(line)) {
      fields[key] += " " + line.trim();
    }
  }
  for (const k of Object.keys(fields)) fields[k] = fields[k].trim().replace(/^(["'])([\s\S]*)\1$/, "$2");
  return fields;
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  return n;
}

function readJson({ file, label, scope }, sources) {
  if (!fs.existsSync(file)) {
    sources.push({ file: label, scope, status: "missing" });
    return null;
  }
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("中身がオブジェクト（{ … }）ではありません");
    sources.push({ file: label, scope, status: "ok" });
    return value;
  } catch (err) {
    sources.push({ file: label, scope, status: "error", error: err.message });
    return null;
  }
}

// Returns the folder if present, recording it in sources either way.
function openDir(sc, sub, sources) {
  const dir = path.join(sc.dir, sub);
  const ok = fs.existsSync(dir);
  sources.push({ file: `${sc.label}/${sub}/`, scope: sc.scope, status: ok ? "ok" : "missing" });
  return ok ? dir : null;
}

function readAgents(sc, sources) {
  const dir = openDir(sc, "agents", sources);
  if (!dir) return [];
  return Object.values(readAllAgentDefs(dir)).map((d) => ({
    name: d.displayName,
    scope: sc.scope,
    file: `${sc.label}/agents/${d.sourceFile}`,
    description: shortDescription(d.description),
    tools: d.tools || null,
    model: d.model || null,
  }));
}

function readSkills(sc, sources) {
  const dir = openDir(sc, "skills", sources);
  if (!dir) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const skillDir = path.join(dir, e.name);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    try {
      const fm = frontmatter(fs.readFileSync(skillFile, "utf8"));
      out.push({ name: fm.name || e.name, scope: sc.scope, dir: `${sc.label}/skills/${e.name}/`, description: shortDescription(fm.description), fileCount: countFiles(skillDir) });
    } catch (err) {
      sources.push({ file: `${sc.label}/skills/${e.name}/SKILL.md`, scope: sc.scope, status: "error", error: err.message });
    }
  }
  return out;
}

// commands/foo.md -> /foo, commands/git/push.md -> /git:push
function readCommands(sc, sources) {
  const base = openDir(sc, "commands", sources);
  if (!base) return [];
  const out = [];
  const walk = (dir, ns) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, [...ns, e.name]);
      else if (e.name.toLowerCase().endsWith(".md")) {
        const rel = `${sc.label}/commands/${[...ns, e.name].join("/")}`;
        try {
          const fm = frontmatter(fs.readFileSync(full, "utf8"));
          const cmd = e.name.slice(0, -3);
          out.push({ name: "/" + (ns.length ? `${ns.join(":")}:${cmd}` : cmd), scope: sc.scope, file: rel, description: shortDescription(fm.description), argumentHint: fm["argument-hint"] || null });
        } catch (err) {
          sources.push({ file: rel, scope: sc.scope, status: "error", error: err.message });
        }
      }
    }
  };
  walk(base, []);
  return out;
}

// Project first, then user; a user item whose name also exists in the project is
// flagged (the UI says so neutrally — which one wins differs per kind).
function mergeScopes(lists) {
  const all = lists.flat();
  const projectNames = new Set(all.filter((i) => i.scope === "project").map((i) => i.name));
  for (const i of all) if (i.scope === "user") i.sameNameInProject = projectNames.has(i.name);
  return all.sort((a, b) => (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "project" ? -1 : 1));
}

const asArray = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

function mcpStatus(name, settingsList) {
  let status = "pending";
  for (const { data } of settingsList) {
    if (asArray(data.disabledMcpjsonServers).includes(name)) return "disabled";
    if (data.enableAllProjectMcpServers === true || asArray(data.enabledMcpjsonServers).includes(name)) status = "enabled";
  }
  return status;
}

function readMcp(root, sources, settingsList) {
  const json = readJson({ file: path.join(root, ".mcp.json"), label: ".mcp.json", scope: "project" }, sources);
  if (!json || !isObj(json.mcpServers)) return [];
  return Object.entries(json.mcpServers).map(([name, s]) => {
    s = isObj(s) ? s : {};
    return {
      name,
      type: s.type || (s.url ? "http" : "stdio"),
      command: s.command ? maskString(String(s.command)) : null,
      args: maskArgs(s.args),
      url: s.url ? maskString(String(s.url)) : null,
      envKeys: isObj(s.env) ? Object.entries(s.env).map(([key, v]) => ({ key, value: maskMapValue(v) })) : [],
      headerKeys: isObj(s.headers) ? Object.entries(s.headers).map(([key, v]) => ({ key, value: maskMapValue(v) })) : [],
      status: mcpStatus(name, settingsList),
    };
  });
}

function readSettingsItems(settingsList) {
  const hooks = [];
  const permissions = { allow: [], ask: [], deny: [], defaultMode: [], additionalDirectories: [] };
  const plugins = [];
  const marketplaces = [];
  const env = [];

  for (const { label: source, scope, data } of settingsList) {
    if (isObj(data.hooks)) {
      for (const [event, groups] of Object.entries(data.hooks)) {
        for (const group of asArray(groups)) {
          for (const h of asArray(group && group.hooks)) {
            const command = h && h.command != null ? String(h.command) : null;
            hooks.push({
              event,
              matcher: group.matcher != null && group.matcher !== "" ? maskString(String(group.matcher)) : null,
              type: (h && h.type) || "command",
              command: command ? maskString(command) : h && h.prompt ? maskString(String(h.prompt)) : null,
              timeout: h && h.timeout != null ? h.timeout : null,
              source,
              scope,
              agentVillage: !!command && command.includes("agent-village-hook"),
            });
          }
        }
      }
    }
    if (isObj(data.permissions)) {
      const p = data.permissions;
      for (const kind of ["allow", "ask", "deny", "additionalDirectories"]) {
        for (const rule of asArray(p[kind])) permissions[kind].push({ rule: maskString(String(rule)), source, scope });
      }
      if (p.defaultMode) permissions.defaultMode.push({ value: String(p.defaultMode), source, scope });
    }
    if (isObj(data.enabledPlugins)) {
      for (const [id, enabled] of Object.entries(data.enabledPlugins)) plugins.push({ id, enabled: enabled !== false, source, scope });
    }
    if (isObj(data.extraKnownMarketplaces)) {
      for (const [name, m] of Object.entries(data.extraKnownMarketplaces)) {
        const src = isObj(m) && isObj(m.source) ? m.source : {};
        const detail = src.repo || src.url || src.path || src.source || "";
        marketplaces.push({ name, detail: maskString(String(detail)), source, scope });
      }
    }
    if (isObj(data.env)) {
      for (const [key, v] of Object.entries(data.env)) env.push({ key, value: maskMapValue(v), source, scope });
    }
  }
  return { hooks, permissions, plugins, marketplaces, env };
}

function readMemory(root) {
  const out = [];
  for (const { file, label, scope } of memoryFiles(root)) {
    try {
      out.push({ file: label, scope, lines: fs.readFileSync(file, "utf8").split(/\r?\n/).length });
    } catch {
      // not present
    }
  }
  return out;
}

function readConfigOverview(root) {
  const sources = [];
  const settingsList = [];
  for (const f of settingsFiles(root)) {
    const data = readJson(f, sources);
    if (data) settingsList.push({ ...f, data });
  }
  const sc = scopes(root);
  return {
    root,
    userDir: userClaudeDir(),
    generatedAt: new Date().toISOString(),
    agents: mergeScopes(sc.map((s) => readAgents(s, sources))),
    skills: mergeScopes(sc.map((s) => readSkills(s, sources))),
    commands: mergeScopes(sc.map((s) => readCommands(s, sources))),
    mcpServers: readMcp(root, sources, settingsList),
    ...readSettingsItems(settingsList),
    memory: readMemory(root),
    sources,
  };
}

module.exports = { readConfigOverview, userClaudeDir, frontmatter, shortDescription };
