// レポートモニター(docs/design/08-report-history.md) — 全エージェントの
// 永続履歴(agents/logs/<agentId>.ndjson 経由、GET /api/reports)を横断表示する、
// office画面とは独立した専用ビュー。hud.js の進捗ログ描画(.log-entry/.level-*)を
// そのまま流用する。
import { store } from "./store.js";

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const LEVELS = ["info", "warn", "error", "result"];

const filters = {
  agentId: "",
  levels: new Set(LEVELS),
  q: "",
};

let nextCursor = null;
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

function rowHtml(entry) {
  return `
    <div class="log-entry level-${entry.level} report-row">
      <span class="ts">${new Date(entry.ts).toLocaleString("ja-JP")}</span>
      <span class="chip report-agent">${escapeHtml(displayNameFor(entry.agentId))}</span>
      ${escapeHtml(entry.text)}
    </div>`;
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

    if (reset) {
      listEl.classList.toggle("empty", body.reports.length === 0);
      listEl.innerHTML = body.reports.length
        ? body.reports.map(rowHtml).join("")
        : `<p class="hint">まだ報告はありません</p>`;
    } else {
      listEl.insertAdjacentHTML("beforeend", body.reports.map(rowHtml).join(""));
    }
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
  const listEl = document.getElementById("reports-list");
  if (listEl.classList.contains("empty")) {
    listEl.classList.remove("empty");
    listEl.innerHTML = "";
  }
  listEl.insertAdjacentHTML("afterbegin", rowHtml(entry));
}

let searchDebounce = null;

function initFilterControls() {
  document.getElementById("reports-agent-filter").addEventListener("change", (e) => {
    filters.agentId = e.target.value;
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

  store.subscribe((type, data) => {
    if (type === "report-added" && matchesFilter(data.entry)) {
      prependRow(data.entry);
    }
    if (type === "snapshot" || type === "agent-change" || type === "agent-removed") {
      renderAgentOptions();
    }
    if (type === "connection") {
      // SSE reconnects can miss report-added events during the gap — self-heal
      // by resyncing the current page, same idea as store.init() does for
      // agents/rooms on reconnect.
      if (data.connected && !wasConnected) refetch();
      wasConnected = data.connected;
    }
  });
}
