// 「構成」画面（docs/design/10-config-overview.md）— 接続中のプロジェクトの
// Claude Code 設定を読み取り専用で一覧する。秘密情報はサーバー側（GET /api/config）
// で伏せ済みなので、ここでは受け取った文字列をエスケープして表示するだけ。
// 項目はプロジェクト（.claude/）とユーザー全体（~/.claude/）の両方から来るので、
// scope で見分けて印を付け、ツールバーで絞り込めるようにする。
// 見出しや専門用語には「?」印を付け、意味を小窓で説明する（glossary.js、docs/design/15 §2）。

import { term } from "./glossary.js";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const PERMISSION_OPEN_LIMIT = 10;
const MCP_STATUS = { enabled: ["有効", "ok"], disabled: ["無効", "off"], pending: ["未承認", "warn"] };
const SOURCE_STATUS = { ok: "読み込み済み", missing: "なし", error: "読めない" };

const SCOPE_FILTERS = ["all", "project", "user"];
const HOOK_EVENT_TERMS = { SubagentStart: "subagentStart", SubagentStop: "subagentStop", PermissionRequest: "permissionRequest" };
const SCOPE_KEY = "agentVillage.configScope";

let loading = false;
let lastConfig = null;
let scopeFilter = "all";
try {
  const saved = localStorage.getItem(SCOPE_KEY);
  if (SCOPE_FILTERS.includes(saved)) scopeFilter = saved;
} catch {
  // storage unavailable — keep the default
}

const none = () => `<p class="cfg-none">設定なし</p>`;
const src = (s) =>
  s.startsWith("~/")
    ? `<span class="cfg-src user" data-term="scopeUser">ユーザー全体</span>`
    : `<span class="cfg-src" title="出典">${escapeHtml(s.replace(".claude/", ""))}</span>`;
const scopeChip = (it) =>
  it.scope === "user"
    ? `<span class="cfg-scope" data-term="scopeUser">ユーザー全体</span>${it.sameNameInProject ? `<span class="cfg-meta warn">同じ名前がプロジェクトにもあります</span>` : ""}`
    : "";
const code = (s) => `<code>${escapeHtml(s)}</code>`;

function card(id, title, count, body, note = "") {
  return `<section class="cfg-card" id="cfg-${id}">
    <h3>${title}<span class="cfg-count">${count}</span></h3>
    ${note ? `<div class="cfg-note">${note}</div>` : ""}
    ${body}
  </section>`;
}

// Name + description list for agents / skills / commands. Descriptions are
// clamped to 2 lines; clicking the row toggles the full text.
function namedList(items, extra) {
  if (!items.length) return none();
  return `<ul class="cfg-list">${items
    .map(
      (it) => `<li class="cfg-item" tabindex="0">
        <div class="cfg-item-head"><span class="cfg-name">${escapeHtml(it.name)}</span>${scopeChip(it)}${extra(it)}</div>
        ${it.description ? `<div class="cfg-desc">${escapeHtml(it.description)}</div>` : ""}
      </li>`
    )
    .join("")}</ul>`;
}

function agentsCard(c) {
  const body = namedList(c.agents, (a) => `${a.model ? `<span class="chip">${escapeHtml(a.model)}</span>` : ""}${a.tools ? `<span class="cfg-meta">ツール ${a.tools.length}</span>` : `<span class="cfg-meta">ツール すべて</span>`}`);
  return card("agents", term("agents", "エージェント"), c.agents.length, body, `${code(".claude/agents/")}・${code("~/.claude/agents/")} の定義`);
}

function skillsCard(c) {
  const body = namedList(c.skills, (s) => `<span class="cfg-meta">ファイル ${s.fileCount}</span>`);
  return card("skills", term("skills", "スキル"), c.skills.length, body, `${code(".claude/skills/<名前>/SKILL.md")}・${code("~/.claude/skills/")}`);
}

function commandsCard(c) {
  const body = namedList(c.commands, (m) => (m.argumentHint ? `<span class="cfg-meta">${escapeHtml(m.argumentHint)}</span>` : ""));
  return card("commands", term("commands", "コマンド"), c.commands.length, body, `${code(".claude/commands/")}・${code("~/.claude/commands/")} のスラッシュコマンド`);
}

const keyChips = (label, list) =>
  list.length ? `<div class="cfg-kv"><span class="cfg-meta">${label}</span>${list.map((e) => `<span class="chip" title="値">${escapeHtml(e.key)} = ${escapeHtml(e.value)}</span>`).join("")}</div>` : "";

function mcpCard(c) {
  const body = c.mcpServers.length
    ? `<ul class="cfg-list">${c.mcpServers
        .map((s) => {
          const [label, cls] = MCP_STATUS[s.status] || [s.status, ""];
          const target = s.url || [s.command, ...s.args].filter(Boolean).join(" ");
          return `<li class="cfg-item cfg-static">
            <div class="cfg-item-head"><span class="cfg-name">${escapeHtml(s.name)}</span><span class="chip">${escapeHtml(s.type)}</span><span class="cfg-state ${cls}">${label}</span></div>
            <div class="cfg-mono">${escapeHtml(target)}</div>
            ${keyChips("env", s.envKeys)}${keyChips("headers", s.headerKeys)}
          </li>`;
        })
        .join("")}</ul>`
    : none();
  return card("mcp", term("mcp", "MCP サーバー"), c.mcpServers.length, body, `${code(".mcp.json")}。状態は settings の承認設定から判定（未承認は起動時に確認が出る）。local・user 範囲で登録した MCP（${code("~/.claude.json")}）は表示しません`);
}

function pluginsCard(c) {
  const rows = [
    ...c.plugins.map((p) => `<li class="cfg-row"><span class="cfg-name">${escapeHtml(p.id)}</span><span class="cfg-state ${p.enabled ? "ok" : "off"}">${p.enabled ? "有効" : "無効"}</span>${src(p.source)}</li>`),
    ...c.marketplaces.map((m) => `<li class="cfg-row"><span class="cfg-name">${escapeHtml(m.name)}</span><span class="chip" data-term="marketplace">マーケットプレイス</span><span class="cfg-mono">${escapeHtml(m.detail)}</span>${src(m.source)}</li>`),
  ];
  return card("plugins", term("plugins", "プラグイン"), c.plugins.length, rows.length ? `<ul class="cfg-rows">${rows.join("")}</ul>` : none(), `settings の ${code("enabledPlugins")}・${code("extraKnownMarketplaces")}`);
}

function hooksCard(c, allHooks) {
  let body;
  if (!c.hooks.length && !allHooks.some((h) => h.agentVillage)) {
    body = `${none()}<div class="cfg-note warn">エージェントの作業中・権限待ちを表示するには、Agent Village のフック（agent-village-hook）の設定が必要です。ヘッダーの<button type="button" class="link-btn" data-open-setup="hooks">🧭 導入のやり方</button>から設定できます。</div>`;
  } else if (!c.hooks.length) {
    body = none();
  } else {
    const byEvent = new Map();
    for (const h of c.hooks) byEvent.set(h.event, [...(byEvent.get(h.event) || []), h]);
    body = [...byEvent]
      .map(
        ([event, list]) => `<div class="cfg-group"><div class="cfg-group-title">${HOOK_EVENT_TERMS[event] ? term(HOOK_EVENT_TERMS[event], event) : escapeHtml(event)}</div><ul class="cfg-rows">${list
          .map(
            (h) => `<li class="cfg-row">${h.matcher ? `<span class="chip" data-term="matcher">${escapeHtml(h.matcher)}</span>` : ""}<span class="cfg-mono">${escapeHtml(h.command || `(${h.type})`)}</span>${h.agentVillage ? `<span class="cfg-state ok">Agent Village</span>` : ""}${h.timeout != null ? `<span class="cfg-meta">${escapeHtml(h.timeout)}秒</span>` : ""}${src(h.source)}</li>`
          )
          .join("")}</ul></div>`
      )
      .join("");
    if (!allHooks.some((h) => h.agentVillage)) body += `<div class="cfg-note warn">Agent Village のフック（agent-village-hook）が見つかりません。作業状態は表示されません。<button type="button" class="link-btn" data-open-setup="hooks">🧭 導入のやり方</button>から設定できます。</div>`;
  }
  const userOnly = !c.hooks.some((h) => h.agentVillage) && allHooks.some((h) => h.agentVillage && h.scope === "user");
  if (userOnly && scopeFilter === "project") body += `<div class="cfg-note">Agent Village のフックはユーザー全体の設定（${code("~/.claude/settings.json")}）にあります。</div>`;
  return card("hooks", term("hooks", "フック"), c.hooks.length, body, "settings の " + code("hooks"));
}

function permissionsCard(c) {
  const p = c.permissions;
  const col = (kind, title) => {
    const list = p[kind];
    const items = list.map((r) => `<li class="cfg-row"><span class="cfg-mono">${escapeHtml(r.rule)}</span>${src(r.source)}</li>`).join("");
    return `<details class="cfg-perm"${list.length && list.length <= PERMISSION_OPEN_LIMIT ? " open" : ""}>
      <summary>${title}<span class="cfg-count">${list.length}</span></summary>
      ${list.length ? `<ul class="cfg-rows">${items}</ul>` : none()}
    </details>`;
  };
  const total = p.allow.length + p.ask.length + p.deny.length;
  const mode = p.defaultMode.length ? `<div class="cfg-kv"><span class="cfg-meta">${term("defaultMode", "既定のモード")}</span>${p.defaultMode.map((m) => `<span class="chip">${escapeHtml(m.value)}</span>${src(m.source)}`).join("")}</div>` : "";
  const dirs = p.additionalDirectories.length ? `<div class="cfg-kv"><span class="cfg-meta">${term("additionalDirectories", "追加の作業フォルダ")}</span>${p.additionalDirectories.map((d) => `<span class="cfg-mono">${escapeHtml(d.rule)}</span>`).join("")}</div>` : "";
  const body = `${mode}${dirs}<div class="cfg-perm-cols">${col("allow", "許可")}${col("ask", "確認")}${col("deny", "拒否")}</div>`;
  return card("permissions", term("permissions", "権限"), total, body, "settings の " + code("permissions") + `（${PERMISSION_OPEN_LIMIT}件を超える欄は閉じた状態で表示）`);
}

function envCard(c) {
  const body = c.env.length ? `<ul class="cfg-rows">${c.env.map((e) => `<li class="cfg-row"><span class="cfg-name">${escapeHtml(e.key)}</span><span class="cfg-mono">${escapeHtml(e.value)}</span>${src(e.source)}</li>`).join("")}</ul>` : none();
  return card("env", term("env", "環境変数"), c.env.length, body, "settings の " + code("env") + "。値は表示しません");
}

function memoryCard(c) {
  const body = c.memory.length ? `<ul class="cfg-rows">${c.memory.map((m) => `<li class="cfg-row"><span class="cfg-mono">${escapeHtml(m.file)}</span><span class="cfg-meta">${m.lines}行</span></li>`).join("")}</ul>` : none();
  return card("memory", term("memory", "メモリ（CLAUDE.md）"), c.memory.length, body, "ファイルの有無と行数のみ");
}

function sourcesHtml(c) {
  return `<section class="cfg-card cfg-sources" id="cfg-sources">
    <h3>${term("sources", "読み込んだファイル")}</h3>
    <ul class="cfg-rows">${c.sources
      .map((s) => `<li class="cfg-row"><span class="cfg-mono">${escapeHtml(s.file)}</span><span class="cfg-state ${s.status === "ok" ? "ok" : s.status === "error" ? "err" : "off"}">${SOURCE_STATUS[s.status]}</span>${s.error ? `<span class="cfg-err">${escapeHtml(s.error)}</span>` : ""}</li>`)
      .join("")}</ul>
    <div class="cfg-note">APIキーなどの秘密情報は、サーバー側で伏せてから表示しています（${code("•••")}）。ユーザー全体の設定は ${code("~/.claude/")} の中だけを読みます。ログイン情報も入っている ${code("~/.claude.json")} は読みません。</div>
  </section>`;
}

// Items carry scope "project" | "user"; sources are filtered by their path label.
function filtered(c) {
  if (scopeFilter === "all") return c;
  const keep = (list) => list.filter((i) => (i.scope || "project") === scopeFilter);
  return {
    ...c,
    agents: keep(c.agents),
    skills: keep(c.skills),
    commands: keep(c.commands),
    mcpServers: scopeFilter === "project" ? c.mcpServers : [],
    plugins: keep(c.plugins),
    marketplaces: keep(c.marketplaces),
    hooks: keep(c.hooks),
    env: keep(c.env),
    memory: keep(c.memory),
    permissions: Object.fromEntries(Object.entries(c.permissions).map(([k, v]) => [k, keep(v)])),
    sources: keep(c.sources),
  };
}

function renderScopeFilter() {
  document.querySelectorAll("#config-scope button").forEach((b) => b.classList.toggle("active", b.dataset.scope === scopeFilter));
}

function render(full) {
  lastConfig = full;
  renderScopeFilter();
  const c = filtered(full);
  const sections = [
    ["agents", "エージェント", c.agents.length],
    ["skills", "スキル", c.skills.length],
    ["commands", "コマンド", c.commands.length],
    ["mcp", "MCP", c.mcpServers.length],
    ["plugins", "プラグイン", c.plugins.length],
    ["hooks", "フック", c.hooks.length],
    ["permissions", "権限", c.permissions.allow.length + c.permissions.ask.length + c.permissions.deny.length],
    ["env", "環境変数", c.env.length],
  ];
  const errors = c.sources.filter((s) => s.status === "error").length;
  document.getElementById("config-summary").innerHTML =
    sections.map(([id, label, n]) => `<button type="button" class="cfg-jump${n ? "" : " zero"}" data-target="cfg-${id}" data-term="${id}">${label}<b>${n}</b></button>`).join("") +
    (errors ? `<button type="button" class="cfg-jump err" data-target="cfg-sources">読めないファイル<b>${errors}</b></button>` : "");
  document.getElementById("config-root").textContent = c.root;
  document.getElementById("config-root").title = c.root;
  document.getElementById("config-cards").innerHTML = `<div class="cfg-grid">
    ${agentsCard(c)}${skillsCard(c)}${commandsCard(c)}${mcpCard(c)}${hooksCard(c, full.hooks)}${permissionsCard(c)}${pluginsCard(c)}${envCard(c)}${memoryCard(c)}
  </div>${sourcesHtml(c)}`;
}

// ---- Agent Village's own settings (docs/design/12-unread-reports-and-machine-log.md §5.2) ----
// Unlike everything below it, this card edits: it writes agents/config/village.json,
// which only Agent Village (the hook) reads — never Claude Code's settings.
async function loadVillageSettings() {
  const slot = document.getElementById("village-settings");
  try {
    const res = await fetch("/api/village-settings");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "取得に失敗しました");
    renderVillageSettings(body);
  } catch (err) {
    slot.innerHTML = `<section class="cfg-card av-settings"><h3>Agent Village の設定</h3><p class="hint">読み込みに失敗しました: ${escapeHtml(err.message)}</p></section>`;
  }
}

let villageDefaultDir = "agents/machine-logs";
let villageDefaultStale = 60;

function renderVillageSettings(body, msg = "", staleMsg = "") {
  villageDefaultDir = body.defaultMachineLogDir;
  villageDefaultStale = body.defaultStaleAfterMinutes;
  const ml = body.settings.machineLog;
  document.getElementById("village-settings").innerHTML = `<section class="cfg-card av-settings" id="cfg-village">
    <h3>Agent Village の設定<span class="cfg-scope">このダッシュボード用</span></h3>
    <div class="cfg-note">Claude Code の設定ではありません。保存先: ${code(body.file)}</div>
    <div class="av-row">
      <b>機械用ログ</b><span class="cfg-note">PC で調べるための記録（各エージェント・1日1ファイル・1行1件の JSON）</span>
    </div>
    <div class="av-row">
      <label><input type="checkbox" id="ml-enabled" ${ml.enabled ? "checked" : ""} /> 記録する</label>
      <input type="text" id="ml-dir" value="${escapeHtml(ml.dir)}" spellcheck="false" aria-label="機械用ログの保存場所" />
      <button class="btn" id="ml-save" type="button">保存</button>
      <button class="btn" id="ml-default" type="button" ${ml.dir === body.defaultMachineLogDir ? "disabled" : ""}>既定に戻す</button>
    </div>
    <div class="cfg-note">書き込み先: ${code(body.resolvedMachineLogDir)} ／ ${code("<エージェント>/<年-月-日>.ndjson")}。相対パスはプロジェクトのフォルダから数えます。場所を変えても、それまでのログは移動しません。</div>
    <div id="ml-msg">${msg}</div>
    <div class="av-row av-sep">
      <b>応答なし？の表示</b><span class="cfg-note">作業中のまま長く更新がないエージェントを「応答なし？」と表示します（表示だけで、状態は変えません）</span>
    </div>
    <div class="av-row">
      <label for="stale-min">最終更新から</label>
      <input type="number" id="stale-min" min="1" max="1440" step="1" value="${body.settings.display.staleAfterMinutes}" />
      <span>分たったら</span>
      <button class="btn" id="stale-save" type="button">保存</button>
      <button class="btn" id="stale-default" type="button" ${body.settings.display.staleAfterMinutes === body.defaultStaleAfterMinutes ? "disabled" : ""}>既定（${body.defaultStaleAfterMinutes}分）に戻す</button>
    </div>
    <div class="cfg-note">フックが状態を書くのは、作業の開始・終了・許可待ちのときだけです。長い作業はずっと更新がないので、短くしすぎると動いている作業まで「応答なし？」になります。</div>
    <details class="av-help">
      <summary>どう決めればいい？ 出たときはどうする？</summary>
      <ul>
        <li><b>決め方</b>: 普段の作業がかかる時間より<b>少し長め</b>にします（例: 30分ほどの作業が多いなら 60分）。</li>
        <li><b>出たとき</b>: そのエージェントの詳細パネルに「対応のしかた」が出ます。
          <ol>
            <li>Claude Code の画面を見る。まだ動いていれば「まだ作業中」で表示を止める。入力待ち・エラーなら Claude Code 側で対応する。</li>
            <li>作業が終わっている・中断した（Esc・/clear・ターミナルを閉じた など）なら「待機中に戻す」。</li>
            <li>長い作業でよく出るなら、ここの分数を長くする。</li>
          </ol>
        </li>
        <li><b>調べたいとき</b>: 同じ欄の「調べるための情報」に、状態ファイル・履歴・機械用ログ・会話記録の場所が出ます。</li>
      </ul>
    </details>
    <div id="stale-msg">${staleMsg}</div>
  </section>`;
}

// 1〜1440 の整数だけを送る（サーバーでも同じ検証をする）。
async function saveStaleMinutes(raw) {
  const msgEl = document.getElementById("stale-msg");
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1440) {
    msgEl.innerHTML = `<div class="appearance-error">1〜1440 の整数で入力してください</div>`;
    return;
  }
  msgEl.innerHTML = `<div class="cfg-note">保存中…</div>`;
  try {
    const res = await fetch("/api/village-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ display: { staleAfterMinutes: n } }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    renderVillageSettings(body, "", `<div class="appearance-success">✓ 保存しました</div>`);
  } catch (err) {
    msgEl.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
  }
}

async function saveVillageSettings(patch) {
  const msgEl = document.getElementById("ml-msg");
  msgEl.innerHTML = `<div class="cfg-note">保存中…</div>`;
  try {
    const res = await fetch("/api/village-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ machineLog: patch }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    renderVillageSettings(body, `<div class="appearance-success">✓ 保存しました</div>`);
  } catch (err) {
    msgEl.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
  }
}

async function load() {
  if (loading) return;
  loadVillageSettings();
  loading = true;
  const btn = document.getElementById("config-reload-btn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/config");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "取得に失敗しました");
    render(body);
  } catch (err) {
    document.getElementById("config-cards").innerHTML = `<p class="hint">読み込みに失敗しました: ${escapeHtml(err.message)}</p>`;
  } finally {
    loading = false;
    btn.disabled = false;
  }
}

export function initConfig() {
  document.getElementById("config-reload-btn").addEventListener("click", load);
  document.getElementById("config-scope").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-scope]");
    if (!b || b.dataset.scope === scopeFilter) return;
    scopeFilter = b.dataset.scope;
    try {
      localStorage.setItem(SCOPE_KEY, scopeFilter);
    } catch {
      // storage unavailable — the choice just isn't remembered
    }
    if (lastConfig) render(lastConfig);
  });
  renderScopeFilter();
  // Lazy: nothing is read until the view is first opened; reopening re-reads so
  // edits made in the meantime show up.
  document.addEventListener("village:view", (e) => {
    if (e.detail.view === "config") load();
  });
  // hooks added/removed from the 導入のやり方 dialog: refresh the hooks card
  document.addEventListener("village:hooks-changed", () => {
    if (lastConfig) load();
  });
  document.getElementById("config-summary").addEventListener("click", (e) => {
    const b = e.target.closest(".cfg-jump");
    if (b) document.getElementById(b.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.getElementById("village-settings").addEventListener("click", (e) => {
    if (e.target.id === "ml-save") saveVillageSettings({ enabled: document.getElementById("ml-enabled").checked, dir: document.getElementById("ml-dir").value });
    if (e.target.id === "ml-default") saveVillageSettings({ dir: villageDefaultDir });
    if (e.target.id === "stale-save") saveStaleMinutes(document.getElementById("stale-min").value);
    if (e.target.id === "stale-default") saveStaleMinutes(villageDefaultStale);
  });
  document.getElementById("village-settings").addEventListener("keydown", (e) => {
    if (e.target.id === "ml-dir" && e.key === "Enter") document.getElementById("ml-save").click();
    if (e.target.id === "stale-min" && e.key === "Enter") document.getElementById("stale-save").click();
  });
  document.getElementById("config-body").addEventListener("click", (e) => {
    const item = e.target.closest(".cfg-item:not(.cfg-static)");
    if (item) item.classList.toggle("expanded");
  });
  document.getElementById("config-body").addEventListener("keydown", (e) => {
    const item = e.target.closest(".cfg-item:not(.cfg-static)");
    if (item && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      item.classList.toggle("expanded");
    }
  });
}
