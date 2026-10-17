// Status summary bar + browser notifications (docs/design/09 §10, phase 2-4).
// Both answer "does anything need me right now?" without reading the map:
// permission waits first (they block an agent until a human answers), then
// errors, then plain counts.
import { store, isDummyAgent } from "./store.js";

const NOTIFY_PREF_KEY = "agentVillage.notify";

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Showcase characters (tools: []) are permanently "working"; counting them
// would make the bar always read busy.
function realAgents() {
  return store.getAgents().filter((a) => !isDummyAgent(a));
}

// Brings the office view + agent tab forward and selects the agent.
function focusAgent(agentId) {
  document.querySelector('#view-switcher .tab-btn[data-view="office"]')?.click();
  document.querySelector('#tab-bar .tab-btn[data-tab="agents"]')?.click();
  store.select(agentId);
  document.querySelector(`#agent-list .list-item[data-agent-id="${CSS.escape(agentId)}"]`)?.scrollIntoView({ block: "nearest" });
}

// --------------------------------------------------------- summary bar ---
let baseTitle = "";

function renderSummary() {
  const el = document.getElementById("status-summary");
  if (!el) return;
  const agents = realAgents();
  const waiting = agents
    .filter((a) => a.pendingPermission)
    .sort((a, b) => String(a.pendingPermission.requestedAt).localeCompare(String(b.pendingPermission.requestedAt)));
  const errors = agents.filter((a) => a.status === "error" && !a.pendingPermission);
  const count = (s) => agents.filter((a) => a.status === s).length;

  const alerts = [
    ...waiting.map(
      (a) => `<button class="sum-alert kind-permission" type="button" data-agent-id="${escapeHtml(a.agentId)}"
        title="${escapeHtml(a.pendingPermission.tool)} の実行許可を待っています（クリックで詳細）">
        🔒 ${escapeHtml(a.displayName)}・${escapeHtml(a.pendingPermission.tool)}
        <span class="sum-elapsed pp-elapsed" data-requested-at="${escapeHtml(a.pendingPermission.requestedAt)}">00:00</span></button>`
    ),
    ...errors.map(
      (a) => `<button class="sum-alert kind-error" type="button" data-agent-id="${escapeHtml(a.agentId)}" title="クリックで詳細">
        ⚠ ${escapeHtml(a.displayName)}</button>`
    ),
  ];

  const counts = [
    ["working", "作業中"],
    ["assigned", "割当済み"],
    ["done", "完了"],
    ["idle", "待機中"],
  ]
    .map(([s, label]) => [s, label, count(s)])
    .filter(([s, , n]) => n > 0 || s === "working")
    .map(([s, label, n]) => `<span class="sum-count"><span class="status-dot status-${s}"></span>${label} <b>${n}</b></span>`);

  el.innerHTML = [
    ...alerts,
    alerts.length ? "" : `<span class="sum-quiet">対応が必要なものはありません</span>`,
    ...counts,
  ].join("");

  for (const btn of el.querySelectorAll(".sum-alert")) {
    btn.addEventListener("click", () => focusAgent(btn.dataset.agentId));
  }

  // The tab title carries the wait count so it shows in the browser's tab strip.
  document.title = waiting.length ? `(${waiting.length}) 🔒 ${baseTitle}` : baseTitle;
}

// The project switcher (projects.js) puts the project name in the title so
// several dashboard tabs can be told apart.
export function setBaseTitle(title) {
  baseTitle = title;
  renderSummary();
}

// ------------------------------------------------------- notifications ---
const supported = typeof window !== "undefined" && "Notification" in window && window.isSecureContext;
const openNotices = new Map(); // tag -> Notification

function readPref() {
  try {
    return localStorage.getItem(NOTIFY_PREF_KEY) === "on";
  } catch {
    return false;
  }
}

function writePref(on) {
  try {
    localStorage.setItem(NOTIFY_PREF_KEY, on ? "on" : "off");
  } catch {
    // storage blocked (private mode etc.) — the toggle just won't persist
  }
}

function notifyEnabled() {
  return supported && Notification.permission === "granted" && readPref();
}

function renderToggle() {
  const btn = document.getElementById("notify-toggle");
  if (!btn) return;
  const on = notifyEnabled();
  btn.classList.toggle("on", on);
  btn.textContent = on ? "🔔 通知オン" : "🔕 通知オフ";
  if (!supported) {
    btn.disabled = true;
    btn.title = window.isSecureContext
      ? "このブラウザはデスクトップ通知に対応していません"
      : "通知は http://localhost で開いたときだけ使えます（ブラウザの制限）";
  } else if (Notification.permission === "denied") {
    btn.title = "ブラウザの設定でこのページの通知がブロックされています。サイトの設定から許可してください。";
  } else {
    btn.title = "権限待ち・エラー・完了を、このページを見ていないときにデスクトップ通知します";
  }
}

async function onToggleClick() {
  if (!supported) return;
  if (notifyEnabled()) {
    writePref(false);
  } else {
    let perm = Notification.permission;
    if (perm === "default") perm = await Notification.requestPermission();
    writePref(perm === "granted");
  }
  renderToggle();
}

function notify(tag, title, body, agentId) {
  // Only while the user is looking elsewhere; on screen the bar already shows it.
  if (!notifyEnabled() || (!document.hidden && document.hasFocus())) return;
  try {
    openNotices.get(tag)?.close();
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      focusAgent(agentId);
      n.close();
    };
    n.onclose = () => {
      if (openNotices.get(tag) === n) openNotices.delete(tag);
    };
    openNotices.set(tag, n);
  } catch (err) {
    console.warn("[alerts] notification failed", err);
  }
}

function lastLogText(agent) {
  const log = agent.log || [];
  return log.length ? log[log.length - 1].text : "";
}

// Only live transitions (agent-change carries the previous state); the
// initial snapshot and SSE reconnect re-syncs never notify.
function onAgentChange({ agentId, prev, next }) {
  if (!prev || isDummyAgent(next)) return;
  const name = next.displayName;
  const pp = next.pendingPermission;

  if (pp && (!prev.pendingPermission || prev.pendingPermission.requestedAt !== pp.requestedAt)) {
    notify(`perm-${agentId}`, `🔒 ${name} が許可を待っています`, `${pp.tool} の実行許可が必要です`, agentId);
  } else if (!pp && prev.pendingPermission) {
    openNotices.get(`perm-${agentId}`)?.close();
  }

  if (next.status !== prev.status) {
    if (next.status === "error") {
      notify(`status-${agentId}`, `⚠ ${name} でエラー`, lastLogText(next) || "エラーが発生しました", agentId);
    } else if (next.status === "done") {
      notify(`status-${agentId}`, `✓ ${name} が完了しました`, next.result?.summary || lastLogText(next) || "", agentId);
    }
  }
}

export function initAlerts() {
  baseTitle = document.title;
  document.getElementById("notify-toggle")?.addEventListener("click", onToggleClick);
  renderToggle();
  renderSummary();

  store.subscribe((type, data) => {
    if (type === "agent-change") onAgentChange(data);
    if (type === "snapshot" || type === "agent-change" || type === "agent-removed") renderSummary();
  });
}
