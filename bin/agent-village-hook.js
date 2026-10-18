#!/usr/bin/env node
// Claude Code hook writer for Agent Village (docs/design/05-hooks-state-writer.md,
// docs/design/06-permission-wait-bubble.md).
//
// Registered for the SubagentStart / SubagentStop / PermissionRequest hook
// events in a target project's .claude/settings.json (matcher: "" — fires
// for every subagent type, custom or built-in). Reads the hook JSON payload
// from stdin and writes agents/state/<agentId>.json per
// docs/design/02-agent-state-model.md §4.
//
// Deliberately does NOT try to recover the task's human title/description by
// correlating this event with the preceding PreToolUse(Agent) call: the two
// events share no common id in practice when multiple subagents of the same
// type run concurrently in one turn (verified empirically — not documented).
// Skipping that correlation keeps this script simple and always-correct
// rather than occasionally wrong.
//
// SAFETY (docs/design/06-permission-wait-bubble.md §7.1): unlike
// SubagentStart/SubagentStop, PermissionRequest is a decision-capable hook —
// Claude Code honors a `{"hookSpecificOutput":{"decision":{"behavior":...}}}`
// JSON on stdout, and exit code 2 blocks the permission prompt from ever
// showing. This script must stay a pure observer: never write to stdout,
// and never call process.exit() with a non-zero code (the top-level
// main().catch() below intentionally does not call process.exit, so an
// unexpected error still exits 0 and the real permission dialog is
// unaffected).
const fs = require("fs");
const path = require("path");
const { slugify } = require(path.join(__dirname, "..", "server", "src", "lib", "agentDefs.js"));
const villageSettings = require(path.join(__dirname, "..", "server", "src", "lib", "villageSettings.js"));

const DELAYED_IDLE_FLAG = "--delayed-idle";
const IDLE_DELAY_MS = 5000;

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

function atomicWrite(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function stateFilePath(projectRoot, agentId) {
  return path.join(projectRoot, "agents", "state", `${agentId}.json`);
}

function nowIso() {
  return new Date().toISOString();
}

// docs/design/08-report-history.md — permanent, append-only per-agent report
// history, separate from the rolling `log` kept inside agents/state/*.json.
function readExistingState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null; // missing/corrupt — treat as "no prior state"
  }
}

// docs/design/02-agent-state-model.md §4.2 — `log` is meant to be append-only,
// keeping the most recent ~50 entries. (Previously each caller overwrote it
// with a single-entry array instead of appending — fixed here.)
function appendedLog(existing, entry) {
  const prevLog = Array.isArray(existing && existing.log) ? existing.log : [];
  return [...prevLog, entry].slice(-50);
}

function logFilePath(projectRoot, agentId) {
  return path.join(projectRoot, "agents", "logs", `${agentId}.ndjson`);
}

// Plain append (not the temp+rename atomicWrite pattern, which is for
// whole-file replacement): NDJSON is designed to be grown by appending, and
// write concurrency here is low (single local dev machine).
function appendNdjsonLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

// docs/design/12-unread-reports-and-machine-log.md §5 — one NDJSON line per
// event for investigating on the PC (grep/jq), in a folder the user can move
// via agents/config/village.json. Fixed field set; tool_input and the raw
// payload are never written (they can carry secrets). Any failure here is
// swallowed: the human-facing files above must still be written.
function writeMachineLog(projectRoot, agentId, payload, event, extra = {}) {
  try {
    const settings = villageSettings.readSettings(projectRoot);
    if (!settings.machineLog.enabled) return;
    const str = (v) => (typeof v === "string" && v ? v : null);
    appendNdjsonLine(villageSettings.machineLogFile(projectRoot, agentId, settings), {
      v: 1,
      ts: nowIso(),
      event,
      agentId,
      agentType: String(payload.agent_type || ""),
      taskId: str(payload.agent_id),
      sessionId: str(payload.session_id),
      project: path.resolve(projectRoot),
      cwd: str(payload.cwd),
      permissionMode: str(payload.permission_mode),
      transcriptPath: str(payload.agent_transcript_path) || str(payload.transcript_path),
      tool: null,
      message: null,
      durationMs: null,
      ...extra,
    });
  } catch (err) {
    process.stderr.write(`[agent-village-hook] machine log write failed: ${err.message}
`);
  }
}

function handleSubagentStart(payload, projectRoot) {
  const agentId = slugify(payload.agent_type || "");
  if (!agentId) return;
  const now = nowIso();
  const file = stateFilePath(projectRoot, agentId);
  const existing = readExistingState(file);
  const entry = { ts: now, level: "info", text: "開始しました" };

  atomicWrite(file, {
    schemaVersion: 1,
    agentId,
    status: "working",
    updatedAt: now,
    task: {
      taskId: payload.agent_id || `hook-${Date.now()}`,
      title: `${payload.agent_type} を実行中`,
      assignedAt: now,
      startedAt: now,
      progress: null,
    },
    log: appendedLog(existing, entry),
    result: null,
  });
  appendNdjsonLine(logFilePath(projectRoot, agentId), { ...entry, agentId, taskId: payload.agent_id || null });
  writeMachineLog(projectRoot, agentId, payload, "start");
}

function handleSubagentStop(payload, projectRoot, hookScriptPath) {
  const agentId = slugify(payload.agent_type || "");
  if (!agentId) return;
  const now = nowIso();
  const file = stateFilePath(projectRoot, agentId);

  // No previous state file (or it's unreadable) — fine, we just won't have
  // the original title/timestamps/log to carry into the "done" record.
  const existing = readExistingState(file);
  const prevTask = (existing && existing.task) || null;

  const summary = String(payload.last_assistant_message || "").trim().slice(0, 300) || "完了しました";
  const entry = { ts: now, level: "result", text: summary };
  atomicWrite(file, {
    schemaVersion: 1,
    agentId,
    status: "done",
    updatedAt: now,
    task: prevTask,
    log: appendedLog(existing, entry),
    result: { ok: true, summary, finishedAt: now },
  });
  appendNdjsonLine(logFilePath(projectRoot, agentId), { ...entry, agentId, taskId: payload.agent_id || null });
  const startedMs = Date.parse(prevTask && prevTask.startedAt);
  writeMachineLog(projectRoot, agentId, payload, "stop", {
    message: String(payload.last_assistant_message || ""),
    durationMs: Number.isFinite(startedMs) ? Date.parse(now) - startedMs : null,
  });

  // Returning to idle after a "done" is the writer's responsibility
  // (docs/design/02-agent-state-model.md §4.2, "doneの寿命"). Do it from a
  // detached child so this hook process can exit immediately instead of
  // blocking the Claude Code turn for IDLE_DELAY_MS.
  const child = require("child_process").spawn(process.execPath, [hookScriptPath, DELAYED_IDLE_FLAG, file, agentId], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

function handlePermissionRequest(payload, projectRoot) {
  // Correlation requires `agent_type` (the same key SubagentStart/Stop use to
  // name the state file). Without it we cannot tell which character is
  // asking, and docs/design/06-permission-wait-bubble.md §6 "Case B" says to
  // stay silent rather than guess (wrong attribution is worse than no bubble).
  const agentId = slugify(payload.agent_type || "");
  if (!agentId) return;

  const file = stateFilePath(projectRoot, agentId);
  const existing = readExistingState(file);
  if (!existing) {
    // No prior SubagentStart record for this agent (or it's unreadable) —
    // nothing to attach pendingPermission to. Fail soft, write nothing.
    return;
  }

  atomicWrite(file, {
    ...existing,
    updatedAt: nowIso(),
    pendingPermission: { tool: String(payload.tool_name || ""), requestedAt: nowIso() },
  });

  // Permission-wait is the one extra lifecycle-adjacent event this hook can
  // observe (see docs/design/05-hooks-state-writer.md §4 — start/stop are the
  // only two guaranteed endpoints). Record it in the permanent report history
  // even though it doesn't touch the rolling `log` above.
  appendNdjsonLine(logFilePath(projectRoot, agentId), {
    ts: nowIso(),
    level: "warn",
    text: `許可待ち: ${payload.tool_name || "(unknown tool)"}`,
    agentId,
    // PermissionRequest payloads carry no subagent id; the running task's id
    // from the state file ties this line to its context (docs/design/12 §3.1).
    taskId: (existing.task && existing.task.taskId) || null,
  });
  writeMachineLog(projectRoot, agentId, { ...payload, agent_id: payload.agent_id || (existing.task && existing.task.taskId) }, "permission", {
    tool: String(payload.tool_name || "") || null,
  });
}

function handleDelayedIdle(file, agentId) {
  setTimeout(() => {
    try {
      atomicWrite(file, {
        schemaVersion: 1,
        agentId,
        status: "idle",
        updatedAt: nowIso(),
        task: null,
        log: [],
        result: null,
      });
    } catch (err) {
      process.stderr.write(`[agent-village-hook] delayed idle write failed: ${err.message}\n`);
    }
    process.exit(0);
  }, IDLE_DELAY_MS);
}

async function main() {
  if (process.argv[2] === DELAYED_IDLE_FLAG) {
    handleDelayedIdle(process.argv[3], process.argv[4]);
    return;
  }

  const raw = await readStdin();
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return; // Malformed input — fail soft, never block the Claude Code turn.
  }

  const projectRoot = process.env.CLAUDE_PROJECT_DIR || payload.cwd;
  if (!projectRoot) return;

  if (payload.hook_event_name === "SubagentStart") {
    handleSubagentStart(payload, projectRoot);
  } else if (payload.hook_event_name === "SubagentStop") {
    handleSubagentStop(payload, projectRoot, __filename);
  } else if (payload.hook_event_name === "PermissionRequest") {
    handlePermissionRequest(payload, projectRoot);
  }
}

main().catch((err) => {
  process.stderr.write(`[agent-village-hook] ${err.message}\n`);
});
