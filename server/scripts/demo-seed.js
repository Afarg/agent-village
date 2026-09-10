/**
 * Demo/verification tool only — NOT a real Claude Code hook integration.
 * Writing agents/state/*.json from an actual running agent is out of scope
 * for this project (see docs/design/03-tech-recommendation.md §5). This
 * script simulates that writer so the dashboard can be exercised end to end.
 */
const fs = require("fs");
const path = require("path");

// Same --target / TARGET_PROJECT_ROOT resolution as src/index.js (see
// docs/design/04-multi-project-integration.md §3.1) so the demo can seed
// state for whichever project the dashboard is currently pointed at.
function resolveTargetRoot() {
  const argIdx = process.argv.indexOf("--target");
  if (argIdx !== -1 && process.argv[argIdx + 1]) return path.resolve(process.argv[argIdx + 1]);
  if (process.env.TARGET_PROJECT_ROOT) return path.resolve(process.env.TARGET_PROJECT_ROOT);
  return path.resolve(__dirname, "..", "..");
}

const STATE_DIR = path.join(resolveTargetRoot(), "agents", "state");
fs.mkdirSync(STATE_DIR, { recursive: true });

function writeState(agentId, state) {
  const file = path.join(STATE_DIR, `${agentId}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

function nowIso() {
  return new Date().toISOString();
}

const SCENARIOS = {
  "agent-creator": [
    { status: "idle", log: [] },
    {
      status: "assigned",
      task: { taskId: "demo-1", title: "PDF抽出エージェントの新規作成", assignedAt: nowIso() },
      log: [],
    },
    {
      status: "working",
      task: { taskId: "demo-1", title: "PDF抽出エージェントの新規作成", assignedAt: nowIso(), startedAt: nowIso(), progress: 0.2 },
      log: [{ level: "info", text: "既存エージェント一覧を確認中…" }],
    },
    {
      status: "working",
      log: [{ level: "info", text: "重複なし。role: coder として設計します" }],
      progressBump: 0.5,
    },
    {
      status: "working",
      log: [{ level: "info", text: "pdf-data-extractor.md を作成中…" }],
      progressBump: 0.85,
    },
    {
      status: "done",
      log: [{ level: "result", text: "作成完了。agent-dispatcher に処理を返します" }],
      result: { ok: true, summary: "pdf-data-extractor を作成しました", finishedAt: nowIso() },
    },
    { status: "idle", log: [], clearTask: true },
  ],
  "agent-dispatcher": [
    { status: "idle", log: [] },
    {
      status: "assigned",
      task: { taskId: "demo-2", title: "PR #42 のレビュー依頼を振り分け", assignedAt: nowIso() },
      log: [],
    },
    {
      status: "working",
      task: { taskId: "demo-2", title: "PR #42 のレビュー依頼を振り分け", assignedAt: nowIso(), startedAt: nowIso(), progress: 0.3 },
      log: [{ level: "info", text: ".claude/agents/*.md を棚卸し中…" }],
    },
    {
      status: "working",
      log: [{ level: "info", text: "reviewer ロールの適任者なし。agent-creator に作成依頼" }],
      progressBump: 0.6,
    },
    {
      status: "working",
      log: [{ level: "info", text: "code-reviewer エージェントが作成されたため委任" }],
      progressBump: 0.9,
    },
    {
      status: "done",
      log: [{ level: "result", text: "code-reviewer に委任完了" }],
      result: { ok: true, summary: "code-reviewer へ委任しました", finishedAt: nowIso() },
    },
    { status: "idle", log: [], clearTask: true },
  ],
};

const STEP_MS = 4000;

function runScenario(agentId, steps) {
  let i = 0;
  let current = {
    schemaVersion: 1,
    agentId,
    status: "idle",
    updatedAt: nowIso(),
    task: null,
    log: [],
    result: null,
  };

  function tick() {
    const step = steps[i % steps.length];
    i += 1;

    current = {
      ...current,
      status: step.status,
      updatedAt: nowIso(),
      task: step.clearTask ? null : step.task || (current.task ? { ...current.task, progress: step.progressBump ?? current.task.progress } : null),
      result: step.status === "done" ? step.result || current.result : null,
      log: [...current.log, ...(step.log || []).map((l) => ({ ts: nowIso(), level: l.level, text: l.text }))].slice(-50),
    };

    writeState(agentId, current);
    console.log(`[demo] ${agentId} -> ${step.status}${step.log?.length ? ` (${step.log[0].text})` : ""}`);
  }

  tick();
  return setInterval(tick, STEP_MS);
}

console.log(`[demo] writing simulated state to ${STATE_DIR}`);
console.log("[demo] press Ctrl+C to stop");

const offsets = Object.keys(SCENARIOS);
offsets.forEach((agentId, idx) => {
  setTimeout(() => runScenario(agentId, SCENARIOS[agentId]), idx * (STEP_MS / 2));
});
