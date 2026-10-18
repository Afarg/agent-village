// レポートモニター(docs/design/08-report-history.md) — 全エージェントの
// 永続履歴(agents/logs/<agentId>.ndjson 経由、GET /api/reports)を横断表示する、
// office画面とは独立した専用ビュー。hud.js の進捗ログ描画(.log-entry/.level-*)を
// そのまま流用する。
// 同じエージェントの同じ作業（コンテキスト）が続く行は、薄い枠の区画に
// まとめ、作業の開始時刻を見出しにする(docs/design/12 §3.3)。
import { store } from "./store.js";
import { escapeHtml, contextBlockHtml } from "./contexts.js";
import { isShownUnread, openedAgent, closedAgent } from "./unread.js";

const LEVELS = ["info", "warn", "error", "result"];

const filters = {
  agentId: "",
  levels: new Set(LEVELS),
  q: "",
};

let nextCursor = null;
let rows = []; // newest first, as shown
let loading = false;
let wasConnected = false;

function displayNameFor(agentId) {
  const agent = store.getAgent(agentId);
  return agent ? agent.displayName : agentId;
}

function matchesFilter(entry) {
  if (filters.agentId && entry.agentId !== filters.agentId) return false;
  if (!filters.levels.has(entry.level)) return false;
  if (filters.q && !entry.text.toLowerCase().includes(filters.q)) return false;
  return true;
}

// Consecutive rows of one agent's one context -> one block.
function groupRows(list) {
  const blocks = [];
  for (const entry of list) {
    const last = blocks[blocks.length - 1];
    if (last && last.agentId === entry.agentId && last.taskId === (entry.taskId ?? null)) last.reports.push(entry);
    else blocks.push({ agentId: entry.agentId, taskId: entry.taskId ?? null, startedAt: entry.taskStartedAt || null, state: "none", reports: [entry] });
  }
  return blocks;
}

function renderRows() {
  const listEl = document.getElementById("reports-list");
  listEl.classList.toggle("empty", rows.length === 0);
  listEl.innerHTML = rows.length
    ? groupRows(rows)
        .map((b) => contextBlockHtml(b, { isUnread: isShownUnread, agentLabel: displayNameFor(b.agentId), fullTime: !b.startedAt }))
        .join("")
    : `<p class="hint">まだ報告はありません</p>`;
}

// Filtering to one agent shows its reports, so they count as read (§4).
function readFilteredAgent() {
  if (filters.agentId && !document.getElementById("reports-view").hidden) openedAgent(filters.agentId);
}

function buildQuery({ cursor } = {}) {
  const params = new URLSearchParams();
  if (filters.agentId) params.set("agentId", filters.agentId);
  if (filters.levels.size < LEVELS.length) params.set("level", Array.from(filters.levels).join(","));
  if (filters.q) params.set("q", filters.q);
  if (cursor != null) params.set("cursor", String(cursor));
  params.set("limit", "50");
  return params.toString();
}

function renderAgentOptions() {
  const select = document.getElementById("reports-agent-filter");
  const current = select.value;
  const agents = store.getAgents().sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));
  select.innerHTML =
    `<option value="">すべてのエージェント</option>` +
    agents.map((a) => `<option value="${a.agentId}">${escapeHtml(a.displayName)}</option>`).join("");
  select.value = current;
}

async function fetchPage({ reset }) {
  if (loading) return;
  loading = true;
  const listEl = document.getElementById("reports-list");
  const loadMoreBtn = document.getElementById("reports-load-more-btn");

  try {
    const res = await fetch(`/api/reports?${buildQuery({ cursor: reset ? null : nextCursor })}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "取得に失敗しました");

    nextCursor = body.nextCursor;
    loadMoreBtn.hidden = nextCursor == null;

    rows = reset ? body.reports : [...rows, ...body.reports];
    renderRows();
  } catch (err) {
    listEl.innerHTML = `<p class="hint">読み込みに失敗しました: ${escapeHtml(err.message)}</p>`;
  } finally {
    loading = false;
  }
}

function refetch() {
  nextCursor = null;
  fetchPage({ reset: true });
}

function prependRow(entry) {
  rows = [entry, ...rows];
  renderRows();
}

let searchDebounce = null;

function initFilterControls() {
  document.getElementById("reports-agent-filter").addEventListener("change", (e) => {
    if (filters.agentId) closedAgent(filters.agentId);
    filters.agentId = e.target.value;
    readFilteredAgent();
    refetch();
  });

  document.querySelectorAll(".reports-level-cb").forEach((cb) => {
    cb.addEventListener("change", () => {
      if (cb.checked) filters.levels.add(cb.value);
      else filters.levels.delete(cb.value);
      refetch();
    });
  });

  document.getElementById("reports-search-input").addEventListener("input", (e) => {
    const value = e.target.value;
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      filters.q = value.trim().toLowerCase();
      refetch();
    }, 300);
  });

  document.getElementById("reports-load-more-btn").addEventListener("click", () => fetchPage({ reset: false }));
}

export function initReports() {
  renderAgentOptions();
  initFilterControls();
  refetch();
  document.addEventListener("village:view", (e) => {
    if (e.detail.view === "reports") {
      readFilteredAgent();
      renderRows();
    }
  });

  store.subscribe((type, data) => {
    if (type === "report-added" && matchesFilter(data.entry)) {
      prependRow(data.entry);
    }
    if (type === "snapshot" || type === "agent-change" || type === "agent-removed") {
      renderAgentOptions();
    }
    if (type === "unread-changed" && !document.getElementById("reports-view").hidden) renderRows();
    if (type === "connection") {
      // SSE reconnects can miss report-added events during the gap — self-heal
      // by resyncing the current page, same idea as store.init() does for
      // agents/rooms on reconnect.
      if (data.connected && !wasConnected) refetch();
      wasConnected = data.connected;
    }
  });
}
