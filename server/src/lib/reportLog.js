// Permanent, append-only report history — docs/design/08-report-history.md.
//
// Complements agents/state/<agentId>.json (a rolling "current status" cache,
// see agentState.js) with agents/logs/<agentId>.ndjson (one line per report
// event, never trimmed/removed). This module keeps an in-memory index built
// once at startup by reading every *.ndjson file in full, then kept current
// by tailing only the newly-appended bytes on each chokidar change event
// (server/src/index.js owns the watcher; this module just knows how to read
// the files it's pointed at).
const fs = require("fs");
const path = require("path");

let reportIndex = []; // ReportEntry[], in ascending `seq` order (== ingestion order)
let nextSeq = 0;
const offsets = new Map(); // absolute file path -> byte offset already parsed

function agentIdFromFile(file) {
  return path.basename(file, ".ndjson");
}

// Reads whatever new, *complete* lines exist past `prevOffset`. A line still
// being written when we read (rare, since the hook does a single small
// fs.appendFileSync per event) is simply left for the next change event —
// we never parse a partial trailing line.
function readNewLines(file, prevOffset) {
  const stat = fs.statSync(file);
  if (stat.size <= prevOffset) return { lines: [], nextOffset: prevOffset };

  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(stat.size - prevOffset);
  fs.readSync(fd, buf, 0, buf.length, prevOffset);
  fs.closeSync(fd);

  const text = buf.toString("utf8");
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline === -1) return { lines: [], nextOffset: prevOffset }; // no complete line yet

  return {
    lines: text.slice(0, lastNewline).split("\n").filter(Boolean),
    nextOffset: prevOffset + Buffer.byteLength(text.slice(0, lastNewline + 1), "utf8"),
  };
}

// Parses any lines appended since the last call for this file, appends them
// to the in-memory index, and returns just the newly-added entries (for SSE
// broadcast). Safe to call from loadAll() (prevOffset defaults to 0) or from
// a chokidar add/change handler.
function ingestFile(file) {
  const prevOffset = offsets.get(file) || 0;
  const { lines, nextOffset } = readNewLines(file, prevOffset);
  offsets.set(file, nextOffset);
  if (lines.length === 0) return [];

  const fallbackAgentId = agentIdFromFile(file);
  const added = [];
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // malformed line — skip, keep going (fail-soft, matches project convention)
    }
    const entry = {
      seq: nextSeq++,
      ts: parsed.ts || new Date().toISOString(),
      level: parsed.level || "info",
      text: String(parsed.text || ""),
      agentId: parsed.agentId || fallbackAgentId,
      taskId: parsed.taskId ?? null,
    };
    reportIndex.push(entry);
    added.push(entry);
  }
  return added;
}

// Full (re)build from disk — call once at server startup. Reads every
// *.ndjson file in `logsDir` in full and sorts the combined result
// chronologically before assigning `seq`, so the very first request already
// sees consistent newest-first ordering across agents.
function loadAll(logsDir) {
  reportIndex = [];
  nextSeq = 0;
  offsets.clear();
  if (!fs.existsSync(logsDir)) return;

  const files = fs
    .readdirSync(logsDir)
    .filter((f) => f.toLowerCase().endsWith(".ndjson"))
    .map((f) => path.join(logsDir, f));

  // Parse every file's full contents first (without assigning seq yet), then
  // sort by ts across all files, THEN assign seq — otherwise seq would just
  // reflect directory listing order, not chronological order.
  const parsed = [];
  for (const file of files) {
    const fallbackAgentId = agentIdFromFile(file);
    const stat = fs.statSync(file);
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split("\n").filter(Boolean)) {
      try {
        const obj = JSON.parse(line);
        parsed.push({
          ts: obj.ts || new Date().toISOString(),
          level: obj.level || "info",
          text: String(obj.text || ""),
          agentId: obj.agentId || fallbackAgentId,
          taskId: obj.taskId ?? null,
        });
      } catch {
        // malformed line — skip
      }
    }
    offsets.set(file, stat.size);
  }
  parsed.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  for (const entry of parsed) {
    reportIndex.push({ ...entry, seq: nextSeq++ });
  }
}

// Filters + paginates the in-memory index. Newest-first (descending `seq`).
// `cursor`, when given, means "strictly older than this seq" (i.e. pass back
// a previous response's `nextCursor`).
function query({ agentId, levels, q, since, until, cursor, limit = 50 } = {}) {
  const levelSet = levels && levels.length ? new Set(levels) : null;
  const needle = q ? q.toLowerCase() : null;
  const sinceTs = since || null;
  const untilTs = until || null;
  const cursorSeq = Number.isFinite(cursor) ? cursor : null;

  const matches = [];
  for (let i = reportIndex.length - 1; i >= 0; i--) {
    const entry = reportIndex[i];
    if (agentId && entry.agentId !== agentId) continue;
    if (levelSet && !levelSet.has(entry.level)) continue;
    if (needle && !entry.text.toLowerCase().includes(needle)) continue;
    if (sinceTs && entry.ts < sinceTs) continue;
    if (untilTs && entry.ts > untilTs) continue;
    matches.push(entry);
  }

  const startIdx = cursorSeq === null ? 0 : matches.findIndex((e) => e.seq < cursorSeq);
  const sliceStart = startIdx === -1 ? matches.length : startIdx;
  const page = matches.slice(sliceStart, sliceStart + limit);
  const nextCursor = sliceStart + limit < matches.length ? page[page.length - 1]?.seq ?? null : null;

  return { reports: page, nextCursor, total: matches.length };
}

module.exports = { loadAll, ingestFile, query };
