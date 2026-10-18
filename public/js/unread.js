// Unread reports (docs/design/12-unread-reports-and-machine-log.md §4).
//
// Read marks live in this browser only (localStorage, per project, per
// agent: the ts of the newest report already read). Counts come from the
// server (POST /api/reports/unread) and are then kept current from SSE
// report-added events. Only results, warnings and errors count.
import { store } from "./store.js";
import { escapeHtml } from "./contexts.js";

const STORAGE_KEY = "agentVillage.readMarks";
const COUNTED = new Set(["result", "warn", "error"]);
const LEVEL_LABEL = { result: "結果", warn: "警告", error: "エラー" };
const TOAST_MS = 5000;

let projectKey = "";
let marks = {}; // agentId -> ts (this project only)
let counts = {}; // agentId -> { total, error, warn, result, latestTs }
// While an agent's reports are on screen, the ones that were unread when it
// was opened keep their ● (§3.3); agentId -> the mark before opening.
const highlightSince = new Map();
let toastTimer = null;

// ------------------------------------------------------------ storage ---
function loadAllMarks() {
  try {
    const obj = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function loadMarks() {
  const all = loadAllMarks();
  marks = all[projectKey] && typeof all[projectKey] === "object" ? { ...all[projectKey] } : marks;
}

function saveMarks() {
  try {
    const all = loadAllMarks();
    all[projectKey] = marks;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // private window / storage blocked: keep the marks for this page only
  }
}

// --------------------------------------------------------------- state ---
export function projectKeyOf() {
  return projectKey;
}

export function isCounted(entry) {
  return COUNTED.has(entry.level);
}

export function unreadOf(agentId) {
  return counts[agentId] || null;
}

// For the ● marks: unread as of when the agent's reports were opened.
export function isShownUnread(entry) {
  if (!isCounted(entry)) return false;
  const since = highlightSince.has(entry.agentId) ? highlightSince.get(entry.agentId) : marks[entry.agentId];
  return !since || entry.ts > since;
}

function changed() {
  renderBadge();
  store.emit("unread-changed", {});
}

export async function refreshCounts() {
  try {
    const res = await fetch("/api/reports/unread", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marks }) });
    if (!res.ok) return;
    counts = (await res.json()).counts || {};
    changed();
  } catch {
    // offline: keep the last counts; the reconnect handler refreshes
  }
}

// Marks everything up to `ts` (default: the newest counted report) as read.
export function markRead(agentId, ts = counts[agentId]?.latestTs) {
  if (!ts || (marks[agentId] && marks[agentId] >= ts)) return;
  marks[agentId] = ts;
  saveMarks();
  if (counts[agentId] && counts[agentId].latestTs <= ts) delete counts[agentId];
  changed();
}

// Called when an agent's reports come on screen (detail panel or the report
// monitor filtered to it): remember what was unread, then mark it read.
export function openedAgent(agentId) {
  for (const id of highlightSince.keys()) if (id !== agentId) highlightSince.delete(id);
  if (!highlightSince.has(agentId)) highlightSince.set(agentId, marks[agentId] || "");
  markRead(agentId);
}

export function closedAgent(agentId) {
  highlightSince.delete(agentId);
}

function markAllRead() {
  for (const [agentId, c] of Object.entries(counts)) {
    if (c.latestTs && (!marks[agentId] || marks[agentId] < c.latestTs)) marks[agentId] = c.latestTs;
  }
  counts = {};
  saveMarks();
  changed();
}

const isVisible = (id) => !document.getElementById(id).hidden;

// Is this agent's report list on screen right now?
function viewing(agentId) {
  if (isVisible("hud-main") && !document.getElementById("tab-agents").hidden && store.selectedAgentId === agentId) return true;
  const filter = document.getElementById("reports-agent-filter");
  return isVisible("reports-view") && filter && filter.value === agentId;
}

function onReport(entry) {
  if (!isCounted(entry)) return;
  if (viewing(entry.agentId)) {
    if (!highlightSince.has(entry.agentId)) highlightSince.set(entry.agentId, marks[entry.agentId] || "");
    markRead(entry.agentId, entry.ts);
    return;
  }
  if (marks[entry.agentId] && entry.ts <= marks[entry.agentId]) return;
  const c = (counts[entry.agentId] ||= { total: 0, error: 0, warn: 0, result: 0, latestTs: null });
  c.total++;
  c[entry.level]++;
  if (!c.latestTs || entry.ts > c.latestTs) c.latestTs = entry.ts;
  changed();
  showToast(entry, c.total);
}

// ------------------------------------------------------------------ UI ---
function nameOf(agentId) {
  return store.getAgent(agentId)?.displayName || agentId;
}

function totals() {
  const list = Object.entries(counts).filter(([, c]) => c.total > 0);
  return {
    list: list.sort((a, b) => b[1].total - a[1].total || nameOf(a[0]).localeCompare(nameOf(b[0]), "ja")),
    total: list.reduce((n, [, c]) => n + c.total, 0),
    error: list.some(([, c]) => c.error > 0),
  };
}

function renderBadge() {
  const btn = document.getElementById("unread-badge");
  if (!btn) return;
  const { list, total, error } = totals();
  btn.className = `unread-badge${total ? (error ? " has-error" : " has-unread") : ""}`;
  btn.innerHTML = total ? `✉ 未読 <b>${total}</b>件（${list.length}人）` : "未読なし";
  btn.setAttribute("aria-label", total ? `未読の報告 ${total}件、${list.length}人` : "未読の報告はありません");
  const tab = document.querySelector('#tab-bar .tab-btn[data-tab="agents"]');
  if (tab) tab.innerHTML = `エージェント${total ? ` <span class="count-badge${error ? " error" : ""}">${total}</span>` : ""}`;
  if (!document.getElementById("unread-pop").hidden) renderPop();
}

function renderPop() {
  const pop = document.getElementById("unread-pop");
  const { list } = totals();
  pop.innerHTML = list.length
    ? `<ul>${list
        .map(
          ([id, c]) => `<li><button type="button" class="unread-row" data-agent-id="${escapeHtml(id)}">
            <span class="unread-name">${escapeHtml(nameOf(id))}</span>
            <span class="count-badge${c.error ? " error" : ""}">${c.total}</span>
            <span class="unread-kinds">${["error", "warn", "result"].filter((l) => c[l]).map((l) => `${LEVEL_LABEL[l]} ${c[l]}`).join("・")}</span>
          </button></li>`
        )
        .join("")}</ul>
      <button type="button" class="btn" id="unread-all-read">すべて既読にする</button>`
    : `<p class="hint">未読の報告はありません</p>`;
}

function setPop(open) {
  const pop = document.getElementById("unread-pop");
  pop.hidden = !open;
  document.getElementById("unread-badge").setAttribute("aria-expanded", String(open));
  if (open) {
    hideToast();
    renderPop();
  }
}

function showToast(entry, total) {
  const el = document.getElementById("unread-toast");
  if (!document.getElementById("unread-pop").hidden) return;
  el.innerHTML = `<b>${escapeHtml(nameOf(entry.agentId))}</b> から報告（${LEVEL_LABEL[entry.level]}）・未読 ${total}件`;
  el.className = `unread-toast level-${entry.level}`;
  el.hidden = false;
  const btn = document.getElementById("unread-badge");
  btn.classList.remove("bump");
  void btn.offsetWidth; // restart the one-shot animation
  btn.classList.add("bump");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, TOAST_MS);
}

function hideToast() {
  clearTimeout(toastTimer);
  const el = document.getElementById("unread-toast");
  if (el) el.hidden = true;
}

// Brings an agent's detail panel up (office view, agents tab).
function openAgent(agentId) {
  if (document.getElementById("hud-main").hidden) document.querySelector('#view-switcher .tab-btn[data-view="office"]').click();
  if (document.getElementById("tab-agents").hidden) document.querySelector('#tab-bar .tab-btn[data-tab="agents"]').click();
  store.select(agentId);
}

function initUi() {
  const btn = document.getElementById("unread-badge");
  const pop = document.getElementById("unread-pop");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setPop(pop.hidden);
  });
  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const row = e.target.closest(".unread-row");
    if (row) {
      setPop(false);
      openAgent(row.dataset.agentId);
    } else if (e.target.id === "unread-all-read") {
      markAllRead();
      setPop(false);
    }
  });
  document.getElementById("unread-toast").addEventListener("click", () => setPop(true));
  document.addEventListener("click", () => setPop(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !pop.hidden) setPop(false);
  });
}

export async function initUnread() {
  initUi();
  renderBadge();
  try {
    const data = await (await fetch("/api/projects")).json();
    projectKey = String(data.current?.path || "").toLowerCase();
  } catch {
    projectKey = "";
  }
  loadMarks();
  await refreshCounts();

  // Another tab read something: pick up its marks and recount.
  window.addEventListener("storage", (e) => {
    if (e.key !== STORAGE_KEY) return;
    loadMarks();
    refreshCounts();
  });

  let wasConnected = false;
  store.subscribe((type, data) => {
    if (type === "report-added") onReport(data.entry);
    if (type === "select") {
      if (data.agentId && viewing(data.agentId)) openedAgent(data.agentId);
    }
    if (type === "snapshot" || type === "agent-change") renderBadge();
    if (type === "connection") {
      if (data.connected && !wasConnected) refreshCounts();
      wasConnected = data.connected;
    }
  });

  // Coming back to the office tab with an agent still selected reads it.
  document.addEventListener("village:view", (e) => {
    if (e.detail.view === "office" && store.selectedAgentId) openedAgent(store.selectedAgentId);
  });
  document.querySelector('#tab-bar .tab-btn[data-tab="agents"]').addEventListener("click", () => {
    if (store.selectedAgentId && viewing(store.selectedAgentId)) openedAgent(store.selectedAgentId);
  });
}
