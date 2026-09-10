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

function handleSubagentStart(payload, projectRoot) {
  const agentId = slugify(payload.agent_type || "");
  if (!agentId) return;
  const now = nowIso();
  atomicWrite(stateFilePath(projectRoot, agentId), {
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
    log: [{ ts: now, level: "info", text: "開始しました" }],
    result: null,
  });
}

function handleSubagentStop(payload, projectRoot, hookScriptPath) {
  const agentId = slugify(payload.agent_type || "");
  if (!agentId) return;
  const now = nowIso();
  const file = stateFilePath(projectRoot, agentId);

  let prevTask = null;
  try {
    prevTask = JSON.parse(fs.readFileSync(file, "utf8")).task || null;
  } catch {
    // No previous state file (or it's unreadable) — fine, we just won't have
    // the original title/timestamps to carry into the "done" record.
  }

  const summary = String(payload.last_assistant_message || "").trim().slice(0, 300) || "完了しました";
  atomicWrite(file, {
    schemaVersion: 1,
    agentId,
    status: "done",
    updatedAt: now,
    task: prevTask,
    log: [{ ts: now, level: "result", text: summary }],
    result: { ok: true, summary, finishedAt: now },
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
  let existing;
  try {
    existing = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // No prior SubagentStart record for this agent (or it's unreadable) —
    // nothing to attach pendingPermission to. Fail soft, write nothing.
    return;
  }

  atomicWrite(file, {
    ...existing,
    updatedAt: nowIso(),
    pendingPermission: { tool: String(payload.tool_name || ""), requestedAt: nowIso() },
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
