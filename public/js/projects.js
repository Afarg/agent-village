// Header project switcher (docs/design/11-project-switcher.md §6).
// Shows which folder the server is watching, and switches between registered
// ones. The switch itself happens on the server; every open tab then reloads
// on the project-changed SSE event (store.js), this one included.
import { store } from "./store.js";
import { setBaseTitle } from "./alerts.js";

const APP_TITLE = "Agent Village";

let state = { current: null, projects: [] };
let busy = false;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function samePath(a, b) {
  // The server already normalizes; Windows paths only differ by case here.
  return a && b && a.toLowerCase() === b.toLowerCase();
}

async function refresh() {
  try {
    const data = await api("GET", "/api/projects");
    state = { current: data.current, projects: data.projects };
  } catch {
    return; // offline — keep showing the last known project
  }
  renderButton();
  // Don't rebuild under the user's cursor (it would drop input focus).
  if (!menuEl().hidden && !menuEl().contains(document.activeElement)) renderMenu();
}

const menuEl = () => document.getElementById("project-menu");

function renderButton() {
  const cur = state.current;
  if (!cur) return;
  document.getElementById("project-name").textContent = cur.label;
  document.getElementById("project-path").textContent = cur.path;
  const btn = document.getElementById("project-current");
  btn.title = `接続中のプロジェクト: ${cur.path}\nクリックで切り替え`;
  btn.classList.toggle("warn", !cur.hookConfigured);
  setBaseTitle(`${cur.label} — ${APP_TITLE}`);
}

function badges(p, isCurrent) {
  const out = [];
  if (isCurrent) out.push(`<span class="pm-badge pm-badge-current">接続中</span>`);
  if (!p.exists) {
    out.push(`<span class="pm-badge pm-badge-warn">フォルダなし</span>`);
    return out.join("");
  }
  out.push(`<span class="pm-badge">エージェント ${p.agentCount}</span>`);
  if (!p.hookConfigured) {
    out.push(`<span class="pm-badge pm-badge-warn" title="このプロジェクトの .claude/settings に agent-village-hook が設定されていません。作業状態・権限待ちは表示されません。">フック未設定</span>`);
  }
  return out.join("");
}

const nothingRegistered = () => state.projects.length === 0;

function renderMenu() {
  const cur = state.current;
  // A background refresh can re-render while the user is typing a path.
  const typedPath = document.getElementById("pm-add-path")?.value || "";
  const typedLabel = document.getElementById("pm-add-label")?.value || "";
  // Help starts open while nothing is registered yet; after that it keeps
  // whatever the user last chose.
  const helpOpen = menuEl().querySelector(".pm-help")?.open ?? nothingRegistered();
  const items = state.projects.map((p) => {
    const isCurrent = cur && samePath(p.path, cur.path);
    return `<li class="pm-item${isCurrent ? " current" : ""}${p.exists ? "" : " missing"}">
      <button class="pm-switch" type="button" data-path="${escapeHtml(p.path)}" ${isCurrent || !p.exists ? "disabled" : ""}>
        <span class="pm-label">${escapeHtml(p.label)}</span>
        <span class="pm-path">${escapeHtml(p.path)}</span>
        <span class="pm-badges">${badges(p, isCurrent)}</span>
      </button>
      <button class="pm-remove" type="button" data-path="${escapeHtml(p.path)}" title="一覧から外す（フォルダは削除されません）">✕</button>
    </li>`;
  });

  const unregistered =
    cur && !cur.registered
      ? `<div class="pm-unregistered">
          <div><span class="pm-label">${escapeHtml(cur.label)}</span>（接続中・未登録）</div>
          <div class="pm-path">${escapeHtml(cur.path)}</div>
          <div class="pm-badges">${badges(cur, true)}</div>
          <button class="btn" type="button" id="pm-register-current">この接続先を登録する</button>
        </div>`
      : "";

  menuEl().innerHTML = `
    <div class="pm-title">プロジェクトを切り替え</div>
    ${unregistered}
    ${items.length ? `<ul class="pm-list">${items.join("")}</ul>` : `<p class="pm-empty">登録済みのプロジェクトはまだありません。</p>`}
    <div class="pm-add">
      <div class="pm-subtitle">プロジェクトを登録</div>
      <div class="pm-help-lead"><code>.claude</code> フォルダが入っているフォルダ（ふだん Claude Code を起動しているフォルダ）を登録します。</div>
      <details class="pm-help"${helpOpen ? " open" : ""}>
        <summary>どのフォルダを登録すればいい？</summary>
        <pre class="pm-tree">D:\\app\\my_project      <b>← ここを登録</b>
├─ .claude
│   ├─ agents         エージェントの定義（*.md）
│   └─ settings.json  フックの設定
└─ （ソースコードなど）</pre>
        <ul>
          <li><code>.claude</code> フォルダそのものや、<code>.claude\\agents</code> は登録しません。その<b>1つ上</b>のフォルダです。</li>
          <li><code>D:\\app</code> のように、プロジェクトをいくつも含む親フォルダも登録しません。</li>
          <li>パスは、エクスプローラーでフォルダを開き、上のアドレスバーをクリックするとコピーできます。</li>
          <li>切り替えると、そのフォルダに <code>agents\\</code>（状態・部屋の設定）と <code>assets\\custom\\</code>（差し替え画像）が作られます。</li>
          <li>作業中・権限待ちを表示するには、そのプロジェクトの <code>.claude\\settings.json</code> などにフック（agent-village-hook）の設定が必要です。設定方法は <code>docs/setup.md</code> §10 を参照してください。</li>
        </ul>
      </details>
      <input type="text" id="pm-add-path" placeholder="フォルダの絶対パス（例: D:\\app\\my_project）" spellcheck="false" />
      <div class="row">
        <input type="text" id="pm-add-label" placeholder="表示名（省略時はフォルダ名）" maxlength="40" />
        <button class="btn" type="button" id="pm-add-btn">登録</button>
      </div>
    </div>
    <div id="pm-msg"></div>
    <div class="appearance-notes">切り替えると、開いているすべてのタブが新しいプロジェクトの表示に再読み込みされます。</div>`;

  document.getElementById("pm-add-path").value = typedPath;
  document.getElementById("pm-add-label").value = typedLabel;

  for (const btn of menuEl().querySelectorAll(".pm-switch")) btn.addEventListener("click", () => switchTo(btn.dataset.path));
  for (const btn of menuEl().querySelectorAll(".pm-remove")) btn.addEventListener("click", () => removeProject(btn.dataset.path));
  document.getElementById("pm-register-current")?.addEventListener("click", () => addProject(cur.path, cur.label));
  document.getElementById("pm-add-btn").addEventListener("click", () =>
    addProject(document.getElementById("pm-add-path").value, document.getElementById("pm-add-label").value)
  );
  document.getElementById("pm-add-path").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") document.getElementById("pm-add-btn").click();
  });
}

function showMessage(text, isError) {
  const el = document.getElementById("pm-msg");
  if (el) el.innerHTML = text ? `<div class="${isError ? "appearance-error" : "pm-info"}">${escapeHtml(text)}</div>` : "";
}

async function addProject(path, label) {
  if (busy) return;
  busy = true;
  try {
    const data = await api("POST", "/api/projects", { path, label });
    state = { current: data.current, projects: data.projects };
    document.getElementById("pm-add-path").value = "";
    document.getElementById("pm-add-label").value = "";
    renderButton();
    renderMenu();
  } catch (err) {
    showMessage(err.message, true);
  } finally {
    busy = false;
  }
}

async function removeProject(path) {
  if (busy) return;
  busy = true;
  try {
    const data = await api("DELETE", "/api/projects", { path });
    state = { current: data.current, projects: data.projects };
    renderMenu();
  } catch (err) {
    showMessage(err.message, true);
  } finally {
    busy = false;
  }
}

async function switchTo(path) {
  if (busy) return;
  busy = true;
  for (const btn of menuEl().querySelectorAll("button")) btn.disabled = true;
  showMessage("切り替えています…", false);
  try {
    await api("POST", "/api/projects/switch", { path });
    // The project-changed SSE event reloads every tab; this is only the
    // fallback for a tab whose event stream happens to be reconnecting.
    setTimeout(() => window.location.reload(), 1500);
  } catch (err) {
    busy = false;
    renderMenu();
    showMessage(err.message, true);
  }
}

function setOpen(open) {
  menuEl().hidden = !open;
  document.getElementById("project-current").setAttribute("aria-expanded", String(open));
  if (open) {
    renderMenu();
    refresh(); // agent counts / hook status may have changed since load
  }
}

export function initProjects() {
  document.getElementById("project-current").addEventListener("click", () => setOpen(menuEl().hidden));
  document.addEventListener("mousedown", (ev) => {
    if (!menuEl().hidden && !document.getElementById("project-switcher").contains(ev.target)) setOpen(false);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !menuEl().hidden) setOpen(false);
  });
  // A server restart may have come back pointed at a different folder.
  store.subscribe((type) => {
    if (type === "connection" && store.connected) refresh();
  });
  refresh();
}
