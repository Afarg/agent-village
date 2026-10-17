const fs = require("fs");
const path = require("path");
const { readAllAgentDefs } = require("./agentDefs");
const { maskString, maskArgs, maskMapValue } = require("./secretMask");

// Read-only overview of a project's Claude Code setup for the "構成" view
// (docs/design/10-config-overview.md). Only files inside the project folder are
// read, and everything secret-looking is masked here, before it leaves the server.

const SETTINGS_FILES = [".claude/settings.json", ".claude/settings.local.json"];
const MEMORY_FILES = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];
const DESCRIPTION_MAX = 300;

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

function readJson(root, rel, sources) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    sources.push({ file: rel, status: "missing" });
    return null;
  }
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("中身がオブジェクト（{ … }）ではありません");
    sources.push({ file: rel, status: "ok" });
    return value;
  } catch (err) {
    sources.push({ file: rel, status: "error", error: err.message });
    return null;
  }
}

function readAgents(root, sources) {
  const dir = path.join(root, ".claude", "agents");
  if (!fs.existsSync(dir)) {
    sources.push({ file: ".claude/agents/", status: "missing" });
    return [];
  }
  sources.push({ file: ".claude/agents/", status: "ok" });
  return Object.values(readAllAgentDefs(dir))
    .map((d) => ({ name: d.displayName, file: `.claude/agents/${d.sourceFile}`, description: shortDescription(d.description), tools: d.tools || null, model: d.model || null }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readSkills(root, sources) {
  const dir = path.join(root, ".claude", "skills");
  if (!fs.existsSync(dir)) {
    sources.push({ file: ".claude/skills/", status: "missing" });
    return [];
  }
  sources.push({ file: ".claude/skills/", status: "ok" });
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const skillDir = path.join(dir, e.name);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) continue;
    try {
      const fm = frontmatter(fs.readFileSync(skillFile, "utf8"));
      out.push({ name: fm.name || e.name, dir: `.claude/skills/${e.name}/`, description: shortDescription(fm.description), fileCount: countFiles(skillDir) });
    } catch (err) {
      sources.push({ file: `.claude/skills/${e.name}/SKILL.md`, status: "error", error: err.message });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// .claude/commands/foo.md -> /foo, .claude/commands/git/push.md -> /git:push
function readCommands(root, sources) {
  const base = path.join(root, ".claude", "commands");
  if (!fs.existsSync(base)) {
    sources.push({ file: ".claude/commands/", status: "missing" });
    return [];
  }
  sources.push({ file: ".claude/commands/", status: "ok" });
  const out = [];
  const walk = (dir, ns) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, [...ns, e.name]);
      else if (e.name.toLowerCase().endsWith(".md")) {
        const rel = path.relative(root, full).split(path.sep).join("/");
        try {
          const fm = frontmatter(fs.readFileSync(full, "utf8"));
          const cmd = e.name.slice(0, -3);
          out.push({ name: "/" + (ns.length ? `${ns.join(":")}:${cmd}` : cmd), file: rel, description: shortDescription(fm.description), argumentHint: fm["argument-hint"] || null });
        } catch (err) {
          sources.push({ file: rel, status: "error", error: err.message });
        }
      }
    }
  };
  walk(base, []);
  return out.sort((a, b) => a.name.localeCompare(b.name));
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
  const json = readJson(root, ".mcp.json", sources);
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

  for (const { file: source, data } of settingsList) {
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
              agentVillage: !!command && command.includes("agent-village-hook"),
            });
          }
        }
      }
    }
    if (isObj(data.permissions)) {
      const p = data.permissions;
      for (const kind of ["allow", "ask", "deny", "additionalDirectories"]) {
        for (const rule of asArray(p[kind])) permissions[kind].push({ rule: maskString(String(rule)), source });
      }
      if (p.defaultMode) permissions.defaultMode.push({ value: String(p.defaultMode), source });
    }
    if (isObj(data.enabledPlugins)) {
      for (const [id, enabled] of Object.entries(data.enabledPlugins)) plugins.push({ id, enabled: enabled !== false, source });
    }
    if (isObj(data.extraKnownMarketplaces)) {
      for (const [name, m] of Object.entries(data.extraKnownMarketplaces)) {
        const src = isObj(m) && isObj(m.source) ? m.source : {};
        const detail = src.repo || src.url || src.path || src.source || "";
        marketplaces.push({ name, detail: maskString(String(detail)), source });
      }
    }
    if (isObj(data.env)) {
      for (const [key, v] of Object.entries(data.env)) env.push({ key, value: maskMapValue(v), source });
    }
  }
  return { hooks, permissions, plugins, marketplaces, env };
}

function readMemory(root) {
  const out = [];
  for (const rel of MEMORY_FILES) {
    try {
      const text = fs.readFileSync(path.join(root, rel), "utf8");
      out.push({ file: rel, lines: text.split(/\r?\n/).length });
    } catch {
      // not present
    }
  }
  return out;
}

function readConfigOverview(root) {
  const sources = [];
  const settingsList = [];
  for (const rel of SETTINGS_FILES) {
    const data = readJson(root, rel, sources);
    if (data) settingsList.push({ file: rel, data });
  }
  return {
    root,
    generatedAt: new Date().toISOString(),
    agents: readAgents(root, sources),
    skills: readSkills(root, sources),
    commands: readCommands(root, sources),
    mcpServers: readMcp(root, sources, settingsList),
    ...readSettingsItems(settingsList),
    memory: readMemory(root),
    sources,
  };
}

module.exports = { readConfigOverview, frontmatter, shortDescription };
