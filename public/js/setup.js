// 「導入のやり方」モーダル（docs/design/15-setup-guide-and-glossary.md §3）。
// ① フックの導入: 状態の表示と、ボタンでの自動設定・解除（GET/POST /api/setup/hooks）。
// ② エージェントキャラの導入: 見た目を作って差し替えるまでの手順の案内。
// フックの必須の合図がそろっていないプロジェクトを開いたときは、自動で開く。

import { store } from "./store.js";
import { term } from "./glossary.js";

const DISMISS_KEY = "agentVillage.setupDismissed"; // { [projectRoot]: true }

const EVENT_INFO = {
  SubagentStart: { term: "subagentStart", what: "キャラが机に移動し「作業中」になる" },
  SubagentStop: { term: "subagentStop", what: "完了の報告が出て、休憩所に戻る" },
  PermissionRequest: { term: "permissionRequest", what: "「許可を待っています」の吹き出しが出る" },
};

let status = null;
let target = "local";
let pending = null; // { action, target, preview }
let message = "";

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const code = (s) => `<code>${escapeHtml(s)}</code>`;

function readDismissed() {
  try {
    return JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function setDismissed(root, on) {
  const all = readDismissed();
  if (on) all[root] = true;
  else delete all[root];
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(all));
  } catch {
    // storage unavailable — it will just open again next time
  }
}

async function fetchStatus() {
  const res = await fetch("/api/setup/hooks");
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

// ---------------------------------------------------------------- header ---
function renderDot() {
  const dot = document.getElementById("setup-dot");
  const btn = document.getElementById("setup-open-btn");
  if (!status) return;
  const level = !status.requiredOk ? "missing" : !status.allOk ? "partial" : "";
  dot.hidden = !level;
  dot.className = `setup-dot ${level}`;
  btn.title = !status.requiredOk
    ? "フックが未導入です。エージェントの動きは表示されません"
    : !status.allOk
      ? "フックの一部（許可待ちの合図）が未導入です"
      : "フックは導入済みです。キャラの見た目の作り方もここにあります";
}

// ------------------------------------------------------------ hooks tab ---
function eventState(e) {
  const working = e.installed.find((i) => i.scriptFound);
  if (working) return `<span class="cfg-state ok">導入済み</span><span class="cfg-meta">${escapeHtml(working.file)}</span>`;
  if (e.installed.length)
    return `<span class="cfg-state err">プログラムが見つかりません</span><span class="cfg-meta">${escapeHtml(e.installed[0].file)} に書かれた場所に Agent Village がありません（移動した？）。「導入する」で今の場所に直せます</span>`;
  return `<span class="cfg-state off">未導入</span>`;
}

function statusTable() {
  return `<table class="setup-table">
    <thead><tr><th>合図</th><th>分かること</th><th></th><th>状態</th></tr></thead>
    <tbody>${status.events
      .map((e) => {
        const info = EVENT_INFO[e.event] || { what: "" };
        return `<tr><td>${info.term ? term(info.term, e.event) : escapeHtml(e.event)}</td><td>${escapeHtml(info.what)}</td><td>${e.required ? `<span class="chip">必須</span>` : `<span class="chip">推奨</span>`}</td><td class="setup-state">${eventState(e)}</td></tr>`;
      })
      .join("")}</tbody>
  </table>`;
}

function targetPicker() {
  return status.targets
    .map(
      (t) => `<label class="setup-target${t.error ? " disabled" : ""}">
        <input type="radio" name="setup-target" value="${t.id}" ${t.id === target ? "checked" : ""} ${t.error ? "disabled" : ""} />
        <span><b>${t.id === "local" ? "自分の PC だけ（おすすめ）" : "チームで共有"}</b> ${code(t.label)}${t.exists ? "" : `<span class="cfg-meta">（まだないので新しく作ります）</span>`}
        <br /><span class="cfg-meta">${t.id === "local" ? "この PC の Claude Code だけに効きます。ほかの人には影響しません" : "git でプロジェクトを共有している人全員に効きます。全員の PC の同じ場所に Agent Village があるときだけ選んでください"}</span>
        ${t.error ? `<br /><span class="cfg-err">${escapeHtml(t.error)}。直してから、もう一度開いてください</span>` : ""}</span>
      </label>`
    )
    .join("");
}

function previewHtml() {
  const p = pending.preview;
  const what =
    pending.action === "install"
      ? [p.added.length ? `追加する合図: ${p.added.map(escapeHtml).join("・")}` : "", p.updated.length ? `場所を直す合図: ${p.updated.map(escapeHtml).join("・")}` : ""].filter(Boolean).join("<br />")
      : `取り除く合図: ${p.removed.map(escapeHtml).join("・")}`;
  return `<div class="setup-preview">
    <b>${pending.action === "install" ? "この内容で導入します" : "この内容で解除します"}</b>
    <p>${what}</p>
    <p class="cfg-meta">書き込み先: ${code(p.file)}${p.existed ? "。書き換える前のファイルは、同じフォルダに控え（.bak-日付）として残します" : "（新しく作ります）"}。ほかの設定はそのまま残します。</p>
    <details><summary>書き込んだあとのファイルの中身</summary><pre class="setup-code">${escapeHtml(p.after)}</pre></details>
    <div class="setup-actions">
      <button class="btn btn-primary" type="button" data-setup-do="confirm">${pending.action === "install" ? "導入する" : "解除する"}</button>
      <button class="btn" type="button" data-setup-do="cancel">やめる</button>
    </div>
  </div>`;
}

function manualJson() {
  const group = { matcher: "", hooks: [{ type: "command", command: status.command }] };
  return JSON.stringify({ hooks: { SubagentStart: [group], SubagentStop: [group], PermissionRequest: [group] } }, null, 2);
}

function hooksTabHtml() {
  if (!status) return `<p class="hint">読み込み中…</p>`;
  const installedFiles = [...new Set(status.events.flatMap((e) => e.installed.filter((i) => i.scope === "project").map((i) => i.file)))];
  const removable = status.targets.filter((t) => installedFiles.includes(t.label) && !t.error);
  const userOnly = status.events.some((e) => e.installed.some((i) => i.scope === "user"));
  const lead = status.requiredOk
    ? `<div class="setup-banner ok">✅ フックは導入済みです。Claude Code でエージェントが動くと、オフィスのキャラも動きます。</div>`
    : `<div class="setup-banner warn">このプロジェクトには、まだフックが入っていません。このままでは、エージェントが仕事をしてもキャラは動きません。</div>`;

  return `${lead}
    <section class="setup-sec">
      <h3>これは何をするもの？</h3>
      <p>Agent Village は、Claude Code が出す「合図」を受け取って、キャラを動かしています。合図を受け取るには、Claude Code の設定ファイルに${term("hooks", "フック")}を3つ登録します。下のボタンを押すと、アプリが登録します。</p>
    </section>
    <section class="setup-sec">
      <h3>今の状態</h3>
      ${statusTable()}
      ${userOnly ? `<p class="cfg-meta">ユーザー全体の設定（${code("~/.claude/settings.json")}）にあるフックも数えています。</p>` : ""}
    </section>
    <section class="setup-sec">
      <h3>${status.allOk ? "設定し直す" : "自動で導入する"}</h3>
      <p class="cfg-meta">書き込み先（${term("settingsFiles", "設定ファイル")}）を選んでください。足りない合図だけを書き足します。</p>
      <div class="setup-targets">${targetPicker()}</div>
      ${pending ? previewHtml() : `<div class="setup-actions"><button class="btn btn-primary" type="button" data-setup-do="preview-install" ${status.allOk && status.events.every((e) => e.installed.some((i) => i.current)) ? "disabled" : ""}>変更内容を確認する</button></div>`}
      <div id="setup-msg">${message}</div>
    </section>
    <section class="setup-sec">
      <h3>導入したあとにすること</h3>
      <ol>
        <li><b>Claude Code を起動し直します。</b>開いたままの Claude Code には、新しい設定が反映されないことがあります。</li>
        <li>Claude Code で、エージェントに仕事を頼みます（例: 「コードをレビューして」）。</li>
        <li>オフィスで、そのエージェントのキャラが自分の机に移動すれば成功です。終わると報告が出て、休憩所に戻ります。</li>
      </ol>
    </section>
    ${
      removable.length
        ? `<section class="setup-sec">
      <h3>解除する</h3>
      <p class="cfg-meta">Agent Village のフックだけを取り除きます。ほかのフックや設定は残します。</p>
      <div class="setup-actions">${removable.map((t) => `<button class="btn btn-danger" type="button" data-setup-do="preview-uninstall" data-target="${t.id}">${escapeHtml(t.label)} から外す</button>`).join("")}</div>
    </section>`
        : ""
    }
    <details class="setup-sec setup-manual">
      <summary>手で設定する場合</summary>
      <p>プロジェクトの ${code(".claude/settings.local.json")}（自分の PC だけ）か ${code(".claude/settings.json")}（チームで共有）に、次の内容を書き足します。すでに ${code('"hooks"')} があるときは、その中に3つの合図を足してください。</p>
      <pre class="setup-code" id="setup-manual-json">${escapeHtml(manualJson())}</pre>
      <button class="btn" type="button" data-setup-do="copy">コピー</button><span id="setup-copy-msg" class="cfg-meta"></span>
    </details>`;
}

// ------------------------------------------------------------ chars tab ---
function charsTabHtml() {
  const agents = store.getAgents();
  const withArt = agents.filter((a) => a.spriteUrl || a.animation).length;
  return `<section class="setup-sec">
      <p>キャラの見た目は、このリポジトリにある2つのアプリで作ります。見た目を作らなくても、エージェントは色付きの仮の人形で表示されます。</p>
      <p class="cfg-meta">このプロジェクトのエージェント: ${agents.length}人（うち見た目を設定済み: ${withArt}人）</p>
    </section>
    <ol class="setup-steps">
      <li>
        <h3>エージェントを用意する</h3>
        <p>プロジェクトの ${code(".claude/agents/<名前>.md")} が、そのままキャラになります（1ファイル = 1人）。Claude Code で ${code("/agents")} と打つと作れます。増やすと、オフィスに自動で現れます。</p>
      </li>
      <li>
        <h3>元の絵を用意する</h3>
        <p>画像生成 AI などで、キャラの絵を作ります。うまく変換するための条件:</p>
        <ul>
          <li>腕を下ろした<b>正面立ち</b>・<b>1人だけ</b>・<b>無地の背景</b></li>
          <li>髪と瞳の色をはっきり変える（近い色だと、まばたきが失敗しやすい）</li>
          <li>斜め・横・後ろ向きの絵もあると、歩くときの向きが増えます（なくても大丈夫）</li>
        </ul>
        <p class="cfg-meta">作り方の例: ${code("docs/prompt/business-characters-generation-prompts.md")}</p>
      </li>
      <li>
        <h3>ドット絵にする（PixelForge）</h3>
        <p>${code("img_to_pixcel_app")} を起動し、${code("http://127.0.0.1:8000/")} で絵を読み込んで変換します。グリッドは 32 以上（64 がおすすめ）、出力の大きさは 128px までにして、<b>フォルダごと書き出します</b>。</p>
        <pre class="setup-code">cd img_to_pixcel_app
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn app.main:app --reload</pre>
      </li>
      <li>
        <h3>ダッシュボードに入れる</h3>
        <p>右の一覧でエージェントを選び、詳細の「名前・見た目・アニメーションを変更する」を開きます。</p>
        <p><b>静止画だけ使う</b>:「見た目」で PNG（正方形・16〜128px・300KB 以下）を選び、「差し替える」。</p>
        <p><b>まばたき・歩く動きも付ける</b>: ${code("ani_convert_app")}（PixelAnimator）を起動し、3 で書き出したフォルダを読み込ませて、出力をフォルダごと保存 →「アニメーション（まばたき・歩行）」でそのフォルダを選び、「アップロード」。動きがあるときは、静止画より優先されます。</p>
        <p class="cfg-meta">2つのアプリは、どちらも 8000 番で起動します。同時に使うときは、片方を ${code("uvicorn app.main:app --reload --port 8001")} で起動してください。</p>
      </li>
    </ol>
    <div class="setup-actions"><button class="btn btn-primary" type="button" data-setup-do="open-agents">エージェント一覧を開く</button></div>`;
}

// ---------------------------------------------------------------- dialog ---
let activeTab = "hooks";

function render() {
  const dialog = document.getElementById("setup-dialog");
  dialog.querySelectorAll("[data-setup-tab]").forEach((b) => {
    const on = b.dataset.setupTab === activeTab;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.getElementById("setup-panel").innerHTML = activeTab === "hooks" ? hooksTabHtml() : charsTabHtml();
  const dismiss = document.getElementById("setup-dismiss");
  dismiss.checked = !!(status && readDismissed()[status.root]);
  document.getElementById("setup-dismiss-row").hidden = !status || status.requiredOk;
}

export function openSetup(tab) {
  activeTab = tab || (status && status.requiredOk ? "chars" : "hooks");
  pending = null;
  message = "";
  const dialog = document.getElementById("setup-dialog");
  render();
  if (!dialog.open) dialog.showModal();
  refresh();
}

async function refresh() {
  try {
    status = await fetchStatus();
  } catch (err) {
    message = `<div class="appearance-error">フックの状態を読めませんでした: ${escapeHtml(err.message)}</div>`;
  }
  renderDot();
  if (document.getElementById("setup-dialog").open) render();
}

async function post(body) {
  const res = await fetch("/api/setup/hooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function onAction(btn) {
  const what = btn.dataset.setupDo;
  if (what === "preview-install" || what === "preview-uninstall") {
    const action = what === "preview-install" ? "install" : "uninstall";
    const t = btn.dataset.target || target;
    message = "";
    try {
      const preview = await post({ action, target: t, dryRun: true });
      if (!preview.changed) {
        message = `<div class="appearance-success">${action === "install" ? "すでに導入済みです。変更はありません" : "取り除くフックはありません"}</div>`;
        pending = null;
      } else pending = { action, target: t, preview };
    } catch (err) {
      message = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
    }
    render();
  } else if (what === "confirm" && pending) {
    btn.disabled = true;
    try {
      const done = await post({ action: pending.action, target: pending.target, dryRun: false });
      status = done.status;
      message = `<div class="appearance-success">✓ ${pending.action === "install" ? "導入しました。下の「導入したあとにすること」に進んでください" : "解除しました"}${done.backup ? `<br />元のファイルの控え: ${code(done.backup)}` : ""}</div>`;
      document.dispatchEvent(new CustomEvent("village:hooks-changed"));
    } catch (err) {
      message = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
    }
    pending = null;
    renderDot();
    render();
  } else if (what === "cancel") {
    pending = null;
    render();
  } else if (what === "copy") {
    const out = document.getElementById("setup-copy-msg");
    try {
      await navigator.clipboard.writeText(manualJson());
      out.textContent = " ✓ コピーしました";
    } catch {
      out.textContent = " コピーできませんでした。上の文章を選んでコピーしてください";
    }
  } else if (what === "open-agents") {
    document.getElementById("setup-dialog").close();
    document.querySelector('#view-switcher .tab-btn[data-view="office"]')?.click();
    document.querySelector('#tab-bar .tab-btn[data-tab="agents"]')?.click();
  }
}

export async function initSetup() {
  const dialog = document.getElementById("setup-dialog");
  document.getElementById("setup-open-btn").addEventListener("click", () => openSetup());
  // "導入のやり方" links elsewhere (e.g. the 構成 hooks card)
  document.addEventListener("click", (e) => {
    const link = e.target instanceof Element ? e.target.closest("[data-open-setup]") : null;
    if (link) openSetup(link.dataset.openSetup);
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) return dialog.close(); // the backdrop
    const tab = e.target.closest("[data-setup-tab]");
    if (tab) {
      activeTab = tab.dataset.setupTab;
      render();
      return;
    }
    if (e.target.closest(".setup-close")) return dialog.close();
    const btn = e.target.closest("[data-setup-do]");
    if (btn && !btn.disabled) onAction(btn);
  });
  dialog.addEventListener("change", (e) => {
    if (e.target.name === "setup-target") {
      target = e.target.value;
      pending = null;
      render();
    }
    if (e.target.id === "setup-dismiss" && status) setDismissed(status.root, e.target.checked);
  });

  try {
    status = await fetchStatus();
  } catch {
    return; // the button still opens it and shows the error then
  }
  renderDot();
  if (!status.requiredOk && status.autoOpen && !readDismissed()[status.root]) openSetup("hooks");
}
