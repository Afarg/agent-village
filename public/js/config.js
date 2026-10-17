// 「構成」画面（docs/design/10-config-overview.md）— 接続中のプロジェクトの
// Claude Code 設定を読み取り専用で一覧する。秘密情報はサーバー側（GET /api/config）
// で伏せ済みなので、ここでは受け取った文字列をエスケープして表示するだけ。

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const PERMISSION_OPEN_LIMIT = 10;
const MCP_STATUS = { enabled: ["有効", "ok"], disabled: ["無効", "off"], pending: ["未承認", "warn"] };
const SOURCE_STATUS = { ok: "読み込み済み", missing: "なし", error: "読めない" };

let loading = false;

const none = () => `<p class="cfg-none">設定なし</p>`;
const src = (s) => `<span class="cfg-src" title="出典">${escapeHtml(s.replace(".claude/", ""))}</span>`;
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
        <div class="cfg-item-head"><span class="cfg-name">${escapeHtml(it.name)}</span>${extra(it)}</div>
        ${it.description ? `<div class="cfg-desc">${escapeHtml(it.description)}</div>` : ""}
      </li>`
    )
    .join("")}</ul>`;
}

function agentsCard(c) {
  const body = namedList(c.agents, (a) => `${a.model ? `<span class="chip">${escapeHtml(a.model)}</span>` : ""}${a.tools ? `<span class="cfg-meta">ツール ${a.tools.length}</span>` : `<span class="cfg-meta">ツール すべて</span>`}`);
  return card("agents", "エージェント", c.agents.length, body, `${code(".claude/agents/")} の定義`);
}

function skillsCard(c) {
  const body = namedList(c.skills, (s) => `<span class="cfg-meta">ファイル ${s.fileCount}</span>`);
  return card("skills", "スキル", c.skills.length, body, `${code(".claude/skills/<名前>/SKILL.md")}`);
}

function commandsCard(c) {
  const body = namedList(c.commands, (m) => (m.argumentHint ? `<span class="cfg-meta">${escapeHtml(m.argumentHint)}</span>` : ""));
  return card("commands", "コマンド", c.commands.length, body, `${code(".claude/commands/")} のスラッシュコマンド`);
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
  return card("mcp", "MCP サーバー", c.mcpServers.length, body, `${code(".mcp.json")}。状態は settings の承認設定から判定（未承認は起動時に確認が出る）`);
}

function pluginsCard(c) {
  const rows = [
    ...c.plugins.map((p) => `<li class="cfg-row"><span class="cfg-name">${escapeHtml(p.id)}</span><span class="cfg-state ${p.enabled ? "ok" : "off"}">${p.enabled ? "有効" : "無効"}</span>${src(p.source)}</li>`),
    ...c.marketplaces.map((m) => `<li class="cfg-row"><span class="cfg-name">${escapeHtml(m.name)}</span><span class="chip">マーケットプレイス</span><span class="cfg-mono">${escapeHtml(m.detail)}</span>${src(m.source)}</li>`),
  ];
  return card("plugins", "プラグイン", c.plugins.length, rows.length ? `<ul class="cfg-rows">${rows.join("")}</ul>` : none(), `settings の ${code("enabledPlugins")}・${code("extraKnownMarketplaces")}`);
}

function hooksCard(c) {
  let body;
  if (!c.hooks.length) {
    body = `${none()}<div class="cfg-note warn">エージェントの作業中・権限待ちを表示するには、Agent Village のフック（agent-village-hook）の設定が必要です（${code("docs/setup.md")} §10）。</div>`;
  } else {
    const byEvent = new Map();
    for (const h of c.hooks) byEvent.set(h.event, [...(byEvent.get(h.event) || []), h]);
    body = [...byEvent]
      .map(
        ([event, list]) => `<div class="cfg-group"><div class="cfg-group-title">${escapeHtml(event)}</div><ul class="cfg-rows">${list
          .map(
            (h) => `<li class="cfg-row">${h.matcher ? `<span class="chip" title="マッチャー">${escapeHtml(h.matcher)}</span>` : ""}<span class="cfg-mono">${escapeHtml(h.command || `(${h.type})`)}</span>${h.agentVillage ? `<span class="cfg-state ok">Agent Village</span>` : ""}${h.timeout != null ? `<span class="cfg-meta">${escapeHtml(h.timeout)}秒</span>` : ""}${src(h.source)}</li>`
          )
          .join("")}</ul></div>`
      )
      .join("");
    if (!c.hooks.some((h) => h.agentVillage)) body += `<div class="cfg-note warn">Agent Village のフック（agent-village-hook）が見つかりません。作業状態は表示されません（${code("docs/setup.md")} §10）。</div>`;
  }
  return card("hooks", "フック", c.hooks.length, body, "settings の " + code("hooks"));
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
  const mode = p.defaultMode.length ? `<div class="cfg-kv"><span class="cfg-meta">既定のモード</span>${p.defaultMode.map((m) => `<span class="chip">${escapeHtml(m.value)}</span>${src(m.source)}`).join("")}</div>` : "";
  const dirs = p.additionalDirectories.length ? `<div class="cfg-kv"><span class="cfg-meta">追加の作業フォルダ</span>${p.additionalDirectories.map((d) => `<span class="cfg-mono">${escapeHtml(d.rule)}</span>`).join("")}</div>` : "";
  const body = `${mode}${dirs}<div class="cfg-perm-cols">${col("allow", "許可")}${col("ask", "確認")}${col("deny", "拒否")}</div>`;
  return card("permissions", "権限", total, body, "settings の " + code("permissions") + `（${PERMISSION_OPEN_LIMIT}件を超える欄は閉じた状態で表示）`);
}

function envCard(c) {
  const body = c.env.length ? `<ul class="cfg-rows">${c.env.map((e) => `<li class="cfg-row"><span class="cfg-name">${escapeHtml(e.key)}</span><span class="cfg-mono">${escapeHtml(e.value)}</span>${src(e.source)}</li>`).join("")}</ul>` : none();
  return card("env", "環境変数", c.env.length, body, "settings の " + code("env") + "。値は表示しません");
}

function memoryCard(c) {
  const body = c.memory.length ? `<ul class="cfg-rows">${c.memory.map((m) => `<li class="cfg-row"><span class="cfg-mono">${escapeHtml(m.file)}</span><span class="cfg-meta">${m.lines}行</span></li>`).join("")}</ul>` : none();
  return card("memory", "メモリ（CLAUDE.md）", c.memory.length, body, "ファイルの有無と行数のみ");
}

function sourcesHtml(c) {
  return `<section class="cfg-card cfg-sources" id="cfg-sources">
    <h3>読み込んだファイル</h3>
    <ul class="cfg-rows">${c.sources
      .map((s) => `<li class="cfg-row"><span class="cfg-mono">${escapeHtml(s.file)}</span><span class="cfg-state ${s.status === "ok" ? "ok" : s.status === "error" ? "err" : "off"}">${SOURCE_STATUS[s.status]}</span>${s.error ? `<span class="cfg-err">${escapeHtml(s.error)}</span>` : ""}</li>`)
      .join("")}</ul>
    <div class="cfg-note">APIキーなどの秘密情報は、サーバー側で伏せてから表示しています（${code("•••")}）。プロジェクトのフォルダの外（ユーザー全体の設定）は読んでいません。</div>
  </section>`;
}

function render(c) {
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
    sections.map(([id, label, n]) => `<button type="button" class="cfg-jump${n ? "" : " zero"}" data-target="cfg-${id}">${label}<b>${n}</b></button>`).join("") +
    (errors ? `<button type="button" class="cfg-jump err" data-target="cfg-sources">読めないファイル<b>${errors}</b></button>` : "");
  document.getElementById("config-root").textContent = c.root;
  document.getElementById("config-root").title = c.root;
  document.getElementById("config-body").innerHTML = `<div class="cfg-grid">
    ${agentsCard(c)}${skillsCard(c)}${commandsCard(c)}${mcpCard(c)}${hooksCard(c)}${permissionsCard(c)}${pluginsCard(c)}${envCard(c)}${memoryCard(c)}
  </div>${sourcesHtml(c)}`;
}

async function load() {
  if (loading) return;
  loading = true;
  const btn = document.getElementById("config-reload-btn");
  btn.disabled = true;
  try {
    const res = await fetch("/api/config");
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || "取得に失敗しました");
    render(body);
  } catch (err) {
    document.getElementById("config-body").innerHTML = `<p class="hint">読み込みに失敗しました: ${escapeHtml(err.message)}</p>`;
  } finally {
    loading = false;
    btn.disabled = false;
  }
}

export function initConfig() {
  document.getElementById("config-reload-btn").addEventListener("click", load);
  // Lazy: nothing is read until the view is first opened; reopening re-reads so
  // edits made in the meantime show up.
  document.addEventListener("village:view", (e) => {
    if (e.detail.view === "config") load();
  });
  document.getElementById("config-summary").addEventListener("click", (e) => {
    const b = e.target.closest(".cfg-jump");
    if (b) document.getElementById(b.dataset.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
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
