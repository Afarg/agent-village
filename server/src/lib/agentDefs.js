const fs = require("fs");
const path = require("path");

// Claude Code subagent frontmatter is *not* strict YAML in practice: the
// `description` field routinely spans many lines (including <example>
// blocks) with no quoting/indentation. A strict YAML parser (e.g.
// gray-matter) chokes on that. Instead we do the same thing Claude Code
// itself effectively does: split the frontmatter into top-level `key:`
// lines and let each value run until the next recognized key.
const KNOWN_KEYS = ["name", "description", "model", "color", "room", "tools"];
const KEY_LINE = new RegExp(`^(${KNOWN_KEYS.join("|")}):\\s?(.*)$`);

function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseToolsValue(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed.replace(/'/g, '"'));
    } catch {
      // fall through to comma-split below
    }
  }
  return trimmed.split(",").map((t) => t.trim()).filter(Boolean);
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);

  const fields = {};
  let currentKey = null;
  let buffer = [];

  const flush = () => {
    if (currentKey) fields[currentKey] = buffer.join("\n").trim();
  };

  for (const line of lines) {
    const keyMatch = line.match(KEY_LINE);
    if (keyMatch) {
      flush();
      currentKey = keyMatch[1];
      buffer = [keyMatch[2]];
    } else if (currentKey) {
      buffer.push(line);
    }
  }
  flush();

  if (fields.tools !== undefined) fields.tools = parseToolsValue(fields.tools);
  return fields;
}

function readAgentDef(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const fm = parseFrontmatter(raw);
  if (!fm || !fm.name) return null;

  return {
    agentId: slugify(fm.name),
    displayName: String(fm.name),
    description: String(fm.description || ""),
    model: fm.model ? String(fm.model) : undefined,
    color: fm.color ? String(fm.color) : undefined,
    tools: Array.isArray(fm.tools) ? fm.tools : undefined,
    room: fm.room ? String(fm.room) : undefined,
    sourceFile: path.basename(filePath),
  };
}

function readAllAgentDefs(agentsDir) {
  if (!fs.existsSync(agentsDir)) return {};
  const files = fs
    .readdirSync(agentsDir)
    .filter((f) => f.toLowerCase().endsWith(".md"));

  const result = {};
  for (const file of files) {
    try {
      const def = readAgentDef(path.join(agentsDir, file));
      if (def) result[def.agentId] = def;
    } catch (err) {
      console.warn(`[agentDefs] failed to parse ${file}: ${err.message}`);
    }
  }
  return result;
}

module.exports = { slugify, readAgentDef, readAllAgentDefs };
