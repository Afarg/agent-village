// Context blocks (docs/design/12-unread-reports-and-machine-log.md §3.3): one
// subagent run's reports framed by a thin border, headed by when the run
// started. Shared by the agent detail panel (hud.js) and the report monitor
// (reports.js).

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const WEEKDAY = ["日", "月", "火", "水", "木", "金", "土"];
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function dayDiff(d, now) {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((b - a) / 86400000);
}

// 今日 14:03 / 昨日 22:40 / 10/16(木) 09:12 / 2025/10/16(木) 09:12
export function fmtWhen(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "時刻不明";
  const diff = dayDiff(d, now);
  if (diff === 0) return `今日 ${hhmm(d)}`;
  if (diff === 1) return `昨日 ${hhmm(d)}`;
  const md = `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY[d.getDay()]})`;
  return d.getFullYear() === now.getFullYear() ? `${md} ${hhmm(d)}` : `${d.getFullYear()}/${md} ${hhmm(d)}`;
}

export function fmtExact(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ja-JP");
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "1分未満";
  if (min < 60) return `${min}分`;
  return `${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ""}`;
}

// Time of the end mark: same day -> 14:07, otherwise the full fmtWhen().
function fmtEnd(startIso, endIso) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  return dayDiff(s, e) === 0 ? hhmm(e) : fmtWhen(endIso);
}

function startLabel(startedAt) {
  return `<span class="ctx-when" title="${escapeHtml(fmtExact(startedAt))}">${escapeHtml(fmtWhen(startedAt))}</span> 開始`;
}

// state: done | running | unknown (see server reportLog.contexts()), or
// "none" in the report monitor, which only knows when a context started.
export function contextHeaderHtml(ctx, { unread = 0, agentLabel = "" } = {}) {
  let tail = "";
  if (ctx.state === "done" && ctx.endedAt) {
    tail = ` → <span title="${escapeHtml(fmtExact(ctx.endedAt))}">${escapeHtml(fmtEnd(ctx.startedAt, ctx.endedAt))}</span> 完了（${fmtDuration(Date.parse(ctx.endedAt) - Date.parse(ctx.startedAt))}）`;
  } else if (ctx.state === "running") {
    tail = ` ・ <span class="ctx-running">作業中（<span class="ctx-elapsed" data-since="${escapeHtml(ctx.startedAt)}">${fmtDuration(Date.now() - Date.parse(ctx.startedAt))}</span>経過）</span>`;
  } else if (ctx.taskId && ctx.state === "unknown") {
    tail = ` ・ <span class="ctx-muted">終了の記録なし</span>`;
  }
  return `<div class="ctx-head">
      ${agentLabel ? `<span class="chip report-agent">${escapeHtml(agentLabel)}</span>` : ""}
      <span class="ctx-time">${ctx.startedAt ? startLabel(ctx.startedAt) : ""}${tail}</span>
      ${unread ? `<span class="ctx-unread">未読 ${unread}</span>` : ""}
    </div>`;
}

// Long reports (a final answer can be 300 chars) are clamped to 3 lines;
// clicking one opens it. Kept by seq so a re-render does not fold it again.
const LONG_TEXT = 90;
const expandedSeqs = new Set();

document.addEventListener("click", (e) => {
  const row = e.target.closest(".ctx-block .log-entry.long");
  if (!row) return;
  const open = row.classList.toggle("expanded");
  if (open) expandedSeqs.add(row.dataset.seq);
  else expandedSeqs.delete(row.dataset.seq);
});

export function reportRowHtml(entry, { unread = false, fullTime = false } = {}) {
  const d = new Date(entry.ts);
  const ts = fullTime ? d.toLocaleString("ja-JP") : hhmm(d);
  const seq = String(entry.seq ?? "");
  const long = entry.text.length > LONG_TEXT;
  const cls = `${unread ? " unread" : ""}${long ? " long" : ""}${long && expandedSeqs.has(seq) ? " expanded" : ""}`;
  return `<div class="log-entry level-${escapeHtml(entry.level)}${cls}" data-seq="${escapeHtml(seq)}"${long ? ' title="クリックで全文を表示"' : ""}>
      <span class="ts" title="${escapeHtml(fmtExact(entry.ts))}">${unread ? '<span class="unread-dot" aria-label="未読"></span>' : ""}${escapeHtml(ts)}</span>${escapeHtml(entry.text)}
    </div>`;
}

// isUnread(entry) -> boolean decides the ● marks and the block's 未読 N.
export function contextBlockHtml(ctx, { isUnread = () => false, agentLabel = "", fullTime = false } = {}) {
  const flags = ctx.reports.map((r) => isUnread(r));
  const unread = flags.filter(Boolean).length;
  return `<section class="ctx-block${unread ? " has-unread" : ""}" data-task-id="${escapeHtml(ctx.taskId || "")}">
      ${contextHeaderHtml(ctx, { unread, agentLabel })}
      ${ctx.reports.map((r, i) => reportRowHtml(r, { unread: flags[i], fullTime })).join("")}
    </section>`;
}

// Live "N分経過" for running contexts; called from the HUD's 1s ticker.
export function tickContextElapsed() {
  document.querySelectorAll(".ctx-elapsed").forEach((el) => {
    el.textContent = fmtDuration(Date.now() - Date.parse(el.dataset.since));
  });
}
