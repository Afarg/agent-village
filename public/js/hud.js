import { store } from "./store.js";
import { PARTS, builtinPartDataUrl } from "./decor/parts.js";
import { resolveDecor } from "./decor/themes.js";

const STATUS_LABEL = {
  idle: "待機中",
  assigned: "割当済み",
  working: "作業中",
  done: "完了",
  error: "エラー",
};

// img_to_pixcel_app/docs/design/06-multi-angle-input.md §2 の表記に合わせる。
const VIEW_LABEL = { front: "正面", diagonal_left: "斜め(左向き)", diagonal_right: "斜め(右向き)", side: "横向き", back: "後ろ向き" };

// UI-only, not persisted: which agents' permission-wait dropdown (§5.4 of
// docs/design/06-permission-wait-bubble.md) the user has expanded. renderAgentList()
// rebuilds the whole list on every store event, so this survives that rebuild
// the same way store.selectedAgentId does for the row-selection state.
const expandedPermissionRows = new Set();

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtKB(bytes) {
  return `${Math.floor(bytes / 1024)}KB`;
}

// ------------------------------------------------------------ requests ---
async function postFile(url, fieldName, file) {
  const fd = new FormData();
  fd.append(fieldName, file);
  const res = await fetch(url, { method: "POST", body: fd });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `アップロードに失敗しました（HTTP ${res.status}）`);
  return body;
}

// Animation bundle upload (docs/design/07-directional-animation-support.md §3.2):
// a whole folder's worth of files under one field name. `file.name` (not
// webkitRelativePath) is passed explicitly so the server sees plain
// basenames even though the input used webkitdirectory.
async function postFiles(url, fieldName, files) {
  const fd = new FormData();
  for (const file of files) fd.append(fieldName, file, file.name);
  const res = await fetch(url, { method: "POST", body: fd });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `アップロードに失敗しました（HTTP ${res.status}）`);
  return body;
}

async function deleteAsset(url) {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "リセットに失敗しました");
  }
  return res.json().catch(() => ({}));
}

async function patchJson(url, payload) {
  const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `更新に失敗しました（HTTP ${res.status}）`);
  return body;
}

async function postJson(url, payload) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `作成に失敗しました（HTTP ${res.status}）`);
  return body;
}

// -------------------------------------------------------- tab switch ---
function initTabs() {
  // Scoped to #tab-bar specifically: .tab-btn is also reused (for its CSS)
  // by the unrelated #view-switcher buttons added in docs/design/08-report-history.md,
  // and an unscoped ".tab-btn" query here would wire this handler onto those
  // too — a button with no data-tab attribute would then hide both sidebar
  // panels on every click (found via browser verification, not theoretical).
  const buttons = document.querySelectorAll("#tab-bar .tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.toggle("active", b === btn));
      document.getElementById("tab-agents").hidden = btn.dataset.tab !== "agents";
      document.getElementById("tab-rooms").hidden = btn.dataset.tab !== "rooms";
    });
  });
}

// ---------------------------------------------------- view switcher ---
// Same hidden-attribute toggle initTabs() uses for the two sidebar tabs,
// promoted to whole-page scope: "オフィス" (office map + sidebar) vs.
// "レポート" (docs/design/08-report-history.md, an independent full-width
// screen, not squeezed into the 360px sidebar).
function initViewSwitcher() {
  const buttons = document.querySelectorAll("#view-switcher .tab-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.toggle("active", b === btn));
      document.getElementById("hud-main").hidden = btn.dataset.view !== "office";
      document.getElementById("reports-view").hidden = btn.dataset.view !== "reports";
    });
  });
}

// ------------------------------------------------------- agent list ---
function renderAgentList() {
  const listEl = document.getElementById("agent-list");
  const agents = store.getAgents().sort((a, b) => a.roomLabel.localeCompare(b.roomLabel, "ja"));

  listEl.innerHTML = agents
    .map((a) => {
      const thumbStyle = a.spriteUrl
        ? `background-image:url('${a.spriteUrl}')`
        : `background-color:${a.paletteMain || "#94b0c2"}`;
      const pp = a.pendingPermission;
      const expanded = !!pp && expandedPermissionRows.has(a.agentId);
      return `
      <li class="list-item ${a.agentId === store.selectedAgentId ? "selected" : ""}" data-agent-id="${a.agentId}">
        <span class="thumb" style="${thumbStyle}"></span>
        <span>
          <div class="name">${escapeHtml(a.displayName)}${pp ? ` <span class="pp-dot" title="許可を待っています"></span>` : ""}</div>
          <div class="role">${escapeHtml(a.roomLabel)} ${"★".repeat(a.modelStars || 0)}</div>
        </span>
        <span class="status-label">
          <span class="status-dot status-${a.status}"></span> ${STATUS_LABEL[a.status] || a.status}
        </span>
        ${pp ? `<button class="pp-caret" type="button" aria-expanded="${expanded}" aria-label="権限待ちの詳細を開閉">${expanded ? "▾" : "▸"}</button>` : ""}
        ${
          pp
            ? `<div class="pp-dropdown" ${expanded ? "" : "hidden"}>🔒 <b>${escapeHtml(pp.tool)}</b> の実行許可を待っています ・ <span class="pp-elapsed" data-requested-at="${escapeHtml(pp.requestedAt)}">00:00</span>経過</div>`
            : ""
        }
      </li>`;
    })
    .join("");

  listEl.querySelectorAll(".list-item").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target.closest(".pp-caret")) return;
      store.select(el.dataset.agentId);
    });
  });

  listEl.querySelectorAll(".pp-caret").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const li = btn.closest(".list-item");
      const agentId = li.dataset.agentId;
      const dropdown = li.querySelector(".pp-dropdown");
      const willExpand = dropdown.hidden;
      dropdown.hidden = !willExpand;
      btn.setAttribute("aria-expanded", String(willExpand));
      btn.textContent = willExpand ? "▾" : "▸";
      if (willExpand) expandedPermissionRows.add(agentId);
      else expandedPermissionRows.delete(agentId);
    });
  });
}

function tickPermissionElapsed() {
  document.querySelectorAll(".pp-elapsed").forEach((span) => {
    const requestedAt = span.dataset.requestedAt;
    if (!requestedAt) return;
    const secs = Math.max(0, Math.floor((Date.now() - new Date(requestedAt).getTime()) / 1000));
    const mm = String(Math.floor(secs / 60)).padStart(2, "0");
    const ss = String(secs % 60).padStart(2, "0");
    span.textContent = `${mm}:${ss}`;
  });
}

function agentRenameHtml(agent) {
  return `
    <div class="row">
      <input type="text" id="agent-name-input" value="${escapeHtml(agent.displayName)}" />
      <button class="btn" id="agent-name-save-btn" type="button">変更</button>
    </div>
    <div class="appearance-notes">
      名前を変更するとエージェントのID（ファイル名）も変わります。他のエージェントの指示文やドキュメント内で
      この名前が直接参照されている場合、そちらは自動更新されません。必要に応じて手動で確認してください。
    </div>
    <div id="agent-name-msg"></div>
  `;
}

function attachAgentRenameHandlers(agentId) {
  const input = document.getElementById("agent-name-input");
  const btn = document.getElementById("agent-name-save-btn");
  const msg = document.getElementById("agent-name-msg");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const newName = input.value.trim();
    if (!newName) {
      msg.innerHTML = `<div class="appearance-error">名前を入力してください</div>`;
      return;
    }
    btn.disabled = true;
    msg.innerHTML = `<div class="appearance-notes">変更中…</div>`;
    try {
      const data = await patchJson(`/api/agents/${agentId}/name`, { name: newName });
      msg.innerHTML = `<div class="appearance-success">✓ 変更しました${data.warning ? `<br>${escapeHtml(data.warning)}` : ""}</div>`;
      if (data.agentId) store.select(data.agentId);
    } catch (err) {
      msg.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
}

function agentAppearanceEditorHtml(agent) {
  const c = store.rooms?.constraints?.characterSprite;
  const notes = c
    ? `PNG形式・正方形（縦横同じpx数）・${c.minSize}〜${c.maxSize}px・${fmtKB(c.maxBytes)}以下。ドット絵がにじまないよう 16px/32px/64px など2の累乗サイズを推奨します。`
    : "";

  const previewStyle = agent.spriteUrl
    ? `background-image:url('${agent.spriteUrl}')`
    : `background-color:${agent.paletteMain || "#94b0c2"}`;

  return `
    <div class="appearance-editor">
      <div class="appearance-preview" style="${previewStyle}"></div>
      <div class="row">
        <input type="file" id="agent-sprite-file" accept="image/png" />
        <button class="btn" id="agent-sprite-upload-btn" type="button">差し替える</button>
        ${agent.spriteUrl ? `<button class="btn btn-danger" id="agent-sprite-reset-btn" type="button">初期の見た目に戻す</button>` : ""}
      </div>
      <div class="appearance-notes">${notes}</div>
      <div id="agent-sprite-msg"></div>
    </div>
  `;
}

function attachAgentAppearanceHandlers(agentId) {
  const fileInput = document.getElementById("agent-sprite-file");
  const uploadBtn = document.getElementById("agent-sprite-upload-btn");
  const resetBtn = document.getElementById("agent-sprite-reset-btn");
  const msgEl = document.getElementById("agent-sprite-msg");
  if (!uploadBtn) return;

  uploadBtn.addEventListener("click", async () => {
    const file = fileInput.files[0];
    if (!file) {
      msgEl.innerHTML = `<div class="appearance-error">ファイルを選択してください</div>`;
      return;
    }
    uploadBtn.disabled = true;
    msgEl.innerHTML = `<div class="appearance-notes">アップロード中…</div>`;
    try {
      await postFile(`/api/agents/${agentId}/sprite`, "sprite", file);
      msgEl.innerHTML = `<div class="appearance-success">✓ 差し替えました</div>`;
    } catch (err) {
      msgEl.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
    } finally {
      uploadBtn.disabled = false;
    }
  });

  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      resetBtn.disabled = true;
      try {
        await deleteAsset(`/api/agents/${agentId}/sprite`);
        msgEl.innerHTML = `<div class="appearance-success">✓ 初期の見た目に戻しました</div>`;
      } catch (err) {
        msgEl.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
      } finally {
        resetBtn.disabled = false;
      }
    });
  }
}

function agentAnimationEditorHtml(agent) {
  const c = store.rooms?.constraints?.characterAnimation;
  const notes = c
    ? `ani_convert_app（PixelAnimator）が出力したフォルダ一式（anim-manifest.json を含む）をそのまま選択してください。フレームはPNG・正方形・${c.minSize}〜${c.maxSize}px、バンドル合計${fmtKB(c.maxTotalBytes)}以下。設定するとこちらが見た目より優先されます。`
    : "";

  const viewNames = agent.animation ? Object.keys(agent.animation.views) : [];
  const summary = viewNames.length
    ? `<div class="appearance-notes">現在のアングル: ${viewNames.map((v) => VIEW_LABEL[v] || v).join("・")}</div>`
    : `<div class="appearance-notes">未設定（静止画のみ）</div>`;

  return `
    <div class="appearance-editor">
      ${summary}
      <div class="row">
        <input type="file" id="agent-anim-files" webkitdirectory multiple />
        <button class="btn" id="agent-anim-upload-btn" type="button">アップロード</button>
        ${agent.animation ? `<button class="btn btn-danger" id="agent-anim-reset-btn" type="button">アニメーションを解除</button>` : ""}
      </div>
      <div class="appearance-notes">${notes}</div>
      <div id="agent-anim-msg"></div>
    </div>
  `;
}

function attachAgentAnimationHandlers(agentId) {
  const filesInput = document.getElementById("agent-anim-files");
  const uploadBtn = document.getElementById("agent-anim-upload-btn");
  const resetBtn = document.getElementById("agent-anim-reset-btn");
  const msgEl = document.getElementById("agent-anim-msg");
  if (!uploadBtn) return;

  uploadBtn.addEventListener("click", async () => {
    const files = Array.from(filesInput.files || []);
    if (!files.length) {
      msgEl.innerHTML = `<div class="appearance-error">フォルダを選択してください</div>`;
      return;
    }
    uploadBtn.disabled = true;
    msgEl.innerHTML = `<div class="appearance-notes">アップロード中…</div>`;
    try {
      await postFiles(`/api/agents/${agentId}/animation`, "files", files);
      msgEl.innerHTML = `<div class="appearance-success">✓ アニメーションを設定しました</div>`;
    } catch (err) {
      msgEl.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
    } finally {
      uploadBtn.disabled = false;
    }
  });

  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      resetBtn.disabled = true;
      try {
        await deleteAsset(`/api/agents/${agentId}/animation`);
        msgEl.innerHTML = `<div class="appearance-success">✓ アニメーションを解除しました</div>`;
      } catch (err) {
        msgEl.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
        resetBtn.disabled = false;
      }
    });
  }
}

function renderAgentDetail() {
  const panel = document.getElementById("agent-detail-panel");
  const agent = store.selectedAgentId ? store.getAgent(store.selectedAgentId) : null;

  if (!agent) {
    panel.classList.add("empty");
    panel.innerHTML = `<p class="hint">キャラクター、または一覧の項目をクリックすると詳細が表示されます。</p>`;
    return;
  }

  panel.classList.remove("empty");

  const toolsHtml = (agent.tools || []).map((t) => `<span class="chip">${escapeHtml(t)}</span>`).join("");
  const logHtml = [...(agent.log || [])]
    .reverse()
    .map(
      (l) =>
        `<div class="log-entry level-${l.level}"><span class="ts">${new Date(l.ts).toLocaleTimeString("ja-JP")}</span>${escapeHtml(l.text)}</div>`
    )
    .join("");

  const scrollTop = panel.scrollTop;
  panel.innerHTML = `
    <h3>${escapeHtml(agent.displayName)}</h3>
    <div class="meta">
      ${escapeHtml(agent.roomLabel)} ・ ${STATUS_LABEL[agent.status] || agent.status}
      ${agent.model ? ` ・ ${escapeHtml(agent.model)} ${"★".repeat(agent.modelStars || 0)}` : ""}
    </div>
    <div class="description">${escapeHtml(agent.description || "(説明なし)")}</div>
    ${toolsHtml ? `<div class="tools">${toolsHtml}</div>` : ""}
    ${agent.task ? `<div class="meta">現在のタスク: ${escapeHtml(agent.task.title)}</div>` : ""}
    ${agent.pendingPermission ? `<div class="meta">🔒 権限待ち: ${escapeHtml(agent.pendingPermission.tool)}</div>` : ""}
    ${agent.result ? `<div class="meta">結果: ${escapeHtml(agent.result.summary || "")}</div>` : ""}

    <h4>名前</h4>
    ${agentRenameHtml(agent)}

    <h4>見た目</h4>
    ${agentAppearanceEditorHtml(agent)}

    <h4>アニメーション（まばたき・歩行）</h4>
    ${agentAnimationEditorHtml(agent)}

    <h4>進捗ログ</h4>
    ${logHtml || '<p class="hint">ログはまだありません</p>'}
  `;

  attachAgentRenameHandlers(agent.agentId);
  attachAgentAppearanceHandlers(agent.agentId);
  attachAgentAnimationHandlers(agent.agentId);
  panel.scrollTop = scrollTop;
}

// -------------------------------------------------------- room list ---
function allRooms() {
  if (!store.rooms) return [];
  return [
    { id: store.rooms.breakRoom.id, label: store.rooms.breakRoom.label, tileUrl: store.rooms.breakRoom.tileUrl, isBreak: true },
    ...store.rooms.rooms.map((r) => ({ id: r.id, label: r.label, tileUrl: r.tileUrl, keywords: r.keywords, isBreak: false })),
  ];
}

// List thumbnail: the legacy whole-room image if set, else the room's floor part.
function roomThumbUrl(room) {
  if (room.tileUrl) return room.tileUrl;
  const floor = resolveDecor(store.findRoom(room.id) || { id: room.id }).floor;
  if (floor && floor.startsWith("custom:")) return store.customParts("floor").find((p) => p.id === floor)?.url || null;
  return floor ? builtinPartDataUrl(floor) : null;
}

function renderRoomList() {
  const listEl = document.getElementById("room-list");
  const rooms = allRooms();

  listEl.innerHTML = rooms
    .map((r) => {
      const thumbUrl = roomThumbUrl(r);
      const thumbStyle = thumbUrl ? `background-image:url('${thumbUrl}');background-size:auto` : `background-color:var(--plaster)`;
      const occupants = store
        .getAgents()
        .filter((a) => (r.isBreak ? a.status === "idle" || a.status === "error" : a.roomId === r.id && a.status !== "idle"));
      return `
      <li class="list-item ${r.id === store.selectedRoomId ? "selected" : ""}" data-room-id="${r.id}">
        <span class="thumb" style="${thumbStyle}"></span>
        <span>
          <div class="name">${escapeHtml(r.label)}</div>
          <div class="role">${occupants.length}体在室</div>
        </span>
      </li>`;
    })
    .join("");

  listEl.querySelectorAll(".list-item").forEach((el) => {
    el.addEventListener("click", () => store.selectRoom(el.dataset.roomId));
  });
}

function roomRenameHtml(room) {
  return `
    <div class="row">
      <input type="text" id="room-name-input" value="${escapeHtml(room.label)}" />
      <button class="btn" id="room-name-save-btn" type="button">変更</button>
    </div>
    <div id="room-name-msg"></div>
  `;
}

function attachRoomRenameHandlers(roomId) {
  const input = document.getElementById("room-name-input");
  const btn = document.getElementById("room-name-save-btn");
  const msg = document.getElementById("room-name-msg");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const newLabel = input.value.trim();
    if (!newLabel) {
      msg.innerHTML = `<div class="appearance-error">名前を入力してください</div>`;
      return;
    }
    btn.disabled = true;
    msg.innerHTML = `<div class="appearance-notes">変更中…（保存すると画面が再読み込みされます）</div>`;
    try {
      await patchJson(`/api/rooms/${roomId}`, { label: newLabel });
      // Reload is triggered globally by the server's rooms-changed SSE event.
    } catch (err) {
      msg.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
      btn.disabled = false;
    }
  });
}

function roomDeleteHtml(room) {
  if (room.isBreak) {
    return `<div class="appearance-notes">休憩所は削除できません。</div>`;
  }
  return `
    <div class="row">
      <button class="btn btn-danger" id="room-delete-btn" type="button">この部屋を削除</button>
    </div>
    <div id="room-delete-msg"></div>
  `;
}

function attachRoomDeleteHandlers(roomId) {
  const btn = document.getElementById("room-delete-btn");
  const msg = document.getElementById("room-delete-msg");
  if (!btn) return;

  let confirming = false;
  btn.addEventListener("click", async () => {
    if (!confirming) {
      confirming = true;
      btn.textContent = "本当に削除しますか？（もう一度押すと削除）";
      msg.innerHTML = `<div class="appearance-error">この部屋にいるエージェントは、次に条件に合う部屋かフリーデスクへ自動的に移動します。</div>`;
      return;
    }
    btn.disabled = true;
    try {
      await fetch(`/api/rooms/${roomId}`, { method: "DELETE" }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "削除に失敗しました");
      });
      // Reload is triggered globally by the server's rooms-changed SSE event.
    } catch (err) {
      msg.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
      btn.disabled = false;
      confirming = false;
      btn.textContent = "この部屋を削除";
    }
  });
}

function roomAppearanceEditorHtml(room) {
  const c = store.rooms?.constraints?.roomTile;
  const notes = c
    ? `PNG形式・${c.minSize}〜${c.maxSize}px・${fmtKB(c.maxBytes)}以下。部屋のマス目と同じ比率（推奨 ${c.recommended.w}×${c.recommended.h}px）でないと引き伸ばされて表示されます。`
    : "";

  const previewStyle = room.tileUrl ? `background-image:url('${room.tileUrl}')` : `background-color:var(--plaster)`;

  return `
    <div class="appearance-editor">
      <div class="appearance-preview" style="${previewStyle}"></div>
      <div class="row">
        <input type="file" id="room-tile-file" accept="image/png" />
        <button class="btn" id="room-tile-upload-btn" type="button">差し替える</button>
        ${room.tileUrl ? `<button class="btn btn-danger" id="room-tile-reset-btn" type="button">初期の見た目に戻す</button>` : ""}
      </div>
      <div class="appearance-notes">${notes}</div>
      <div id="room-tile-msg"></div>
    </div>
  `;
}

function attachRoomAppearanceHandlers(roomId) {
  const fileInput = document.getElementById("room-tile-file");
  const uploadBtn = document.getElementById("room-tile-upload-btn");
  const resetBtn = document.getElementById("room-tile-reset-btn");
  const msgEl = document.getElementById("room-tile-msg");
  if (!uploadBtn) return;

  uploadBtn.addEventListener("click", async () => {
    const file = fileInput.files[0];
    if (!file) {
      msgEl.innerHTML = `<div class="appearance-error">ファイルを選択してください</div>`;
      return;
    }
    uploadBtn.disabled = true;
    msgEl.innerHTML = `<div class="appearance-notes">アップロード中…</div>`;
    try {
      await postFile(`/api/rooms/${roomId}/tile`, "tile", file);
      msgEl.innerHTML = `<div class="appearance-success">✓ 差し替えました</div>`;
    } catch (err) {
      msgEl.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
    } finally {
      uploadBtn.disabled = false;
    }
  });

  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      resetBtn.disabled = true;
      try {
        await deleteAsset(`/api/rooms/${roomId}/tile`);
        msgEl.innerHTML = `<div class="appearance-success">✓ 初期の見た目に戻しました</div>`;
      } catch (err) {
        msgEl.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
      } finally {
        resetBtn.disabled = false;
      }
    });
  }
}

// ------------------------------------------------------- room decor ---
// docs/design/09-ai-office-redesign.md §7: one row per slot, each with a
// dropdown (built-in + uploaded parts) and a drop target for a new PNG.
const DECOR_ROW_LABEL = {
  floor: "床",
  wall: "壁",
  rug: "敷物",
  wall1: "壁飾り（左）",
  wall2: "壁飾り（中央）",
  wall3: "壁飾り（右）",
  desk: "机（4台共通）",
  chair: "椅子（4台共通）",
  side1: "脇置き（左）",
  side2: "脇置き（右）",
};
const TOP_LEVEL_DECOR = new Set(["floor", "wall", "rug"]);

// Survives the panel rebuild that the resulting room-decor SSE event triggers.
let decorFlash = null; // { roomId, html }

function setDecorFlash(roomId, html) {
  decorFlash = { roomId, html };
  const el = document.getElementById("decor-msg");
  if (el) el.innerHTML = html;
}

function decorValue(decor, slotId) {
  return TOP_LEVEL_DECOR.has(slotId) ? decor[slotId] : decor.slots[slotId];
}

function decorSpecNote(spec) {
  const size = spec.exact ? `${spec.w}×${spec.h}px` : `最大${spec.w}×${spec.h}px`;
  return spec.opaque ? `${size}・透過不可` : size;
}

function partOptions(category) {
  const builtin = PARTS.filter((p) => p.category === category).map((p) => ({ id: p.id, label: p.label, thumb: builtinPartDataUrl(p.id) }));
  const custom = store.customParts(category).map((p) => ({ id: p.id, label: `アップロード: ${p.name}`, thumb: p.url }));
  return { builtin, custom };
}

function roomDecorEditorHtml(room) {
  const lib = store.decor;
  if (!lib) return `<p class="hint">部品ライブラリを読み込み中…</p>`;
  const raw = store.findRoom(room.id);
  const current = resolveDecor(raw);
  const defaults = resolveDecor({ id: room.id });

  const rows = lib.slots
    .filter((slot) => !(room.isBreak && slot.id === "chair")) // the break room's table has no chairs
    .map((slot) => {
      const spec = lib.spec[slot.category];
      const value = decorValue(current, slot.id);
      const def = decorValue(defaults, slot.id);
      const { builtin, custom } = partOptions(slot.category);
      const selected = [...builtin, ...custom].find((o) => o.id === value);
      const opt = (o) =>
        `<option value="${escapeHtml(o.id)}" ${o.id === value ? "selected" : ""}>${escapeHtml(o.label)}${o.id === def ? "（既定）" : ""}</option>`;
      const label = room.isBreak && slot.id === "desk" ? "テーブル" : DECOR_ROW_LABEL[slot.id];
      return `
        <div class="decor-row" data-slot="${slot.id}" data-category="${slot.category}">
          <div class="decor-thumb">${selected ? `<img src="${escapeHtml(selected.thumb)}" alt="" />` : `<span>なし</span>`}</div>
          <div class="decor-main">
            <div class="decor-head">
              <span class="decor-label">${label}</span>
              <span class="decor-spec">${decorSpecNote(spec)}</span>
              <button class="btn decor-upload-btn" type="button" title="PNGをこの行にドラッグ＆ドロップしても登録できます">画像…</button>
            </div>
            <select class="decor-select" data-slot="${slot.id}" title="${escapeHtml(selected ? selected.label : "なし")}">
              ${slot.nullable ? `<option value="" ${value ? "" : "selected"}>なし${def ? "" : "（既定）"}</option>` : ""}
              <optgroup label="標準の部品">${builtin.map(opt).join("")}</optgroup>
              ${custom.length ? `<optgroup label="アップロードした部品">${custom.map(opt).join("")}</optgroup>` : ""}
            </select>
          </div>
        </div>
      `;
    })
    .join("");

  const customAll = Object.entries(lib.custom).flatMap(([category, parts]) => parts.map((p) => ({ ...p, category })));
  const libraryHtml = customAll.length
    ? `<details class="decor-library">
        <summary>アップロードした部品（${customAll.length}）</summary>
        <ul>
          ${customAll
            .map(
              (p) => `<li><img src="${escapeHtml(p.url)}" alt="" /><span>${escapeHtml(lib.spec[p.category].label)}: ${escapeHtml(p.name)}</span>
                <button class="btn btn-danger decor-delete-btn" data-category="${p.category}" data-name="${escapeHtml(p.name)}" type="button">削除</button></li>`
            )
            .join("")}
        </ul>
        <div class="appearance-notes">削除すると、その部品を使っている部屋は既定の部品に戻ります。</div>
      </details>`
    : "";

  const flash = decorFlash && decorFlash.roomId === room.id ? decorFlash.html : "";
  return `
    <div class="decor-editor">
      ${rows}
      <input type="file" id="decor-file" accept="image/png" hidden />
      <div class="appearance-notes">PNG形式・${fmtKB(lib.maxBytes)}以下。行に画像をドラッグ＆ドロップするか「画像…」で選ぶと、規格を確認してから登録し、その場所に置きます。</div>
      <div id="decor-msg">${flash}</div>
      <div class="row">
        <button class="btn" id="decor-reset-btn" type="button" ${raw && raw.decor ? "" : "disabled"}>この部屋を初期状態に戻す</button>
      </div>
      ${libraryHtml}
    </div>
  `;
}

async function putRoomDecor(roomId, changes) {
  const res = await fetch(`/api/rooms/${roomId}/decor`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `保存に失敗しました（HTTP ${res.status}）`);
  return body;
}

async function uploadDecorToSlot(roomId, slotId, category, file) {
  if (!file) return;
  setDecorFlash(roomId, `<div class="appearance-notes">「${escapeHtml(file.name)}」を確認しています…</div>`);
  try {
    const { part } = await postFile(`/api/decor/${category}`, "image", file);
    await store.refreshDecor(); // so the new part is in the dropdown before the room points at it
    await putRoomDecor(roomId, { [slotId]: part.id });
    setDecorFlash(roomId, `<div class="appearance-success">✓ 登録して「${escapeHtml(DECOR_ROW_LABEL[slotId])}」に置きました</div>`);
  } catch (err) {
    setDecorFlash(roomId, `<div class="appearance-error">${escapeHtml(err.message)}</div>`);
  }
}

function attachRoomDecorHandlers(roomId) {
  const fileInput = document.getElementById("decor-file");
  if (!fileInput) return;
  let pendingRow = null;

  for (const select of document.querySelectorAll("#room-detail-panel .decor-select")) {
    select.addEventListener("change", async () => {
      select.disabled = true;
      try {
        await putRoomDecor(roomId, { [select.dataset.slot]: select.value || null });
        setDecorFlash(roomId, "");
      } catch (err) {
        setDecorFlash(roomId, `<div class="appearance-error">${escapeHtml(err.message)}</div>`);
        select.disabled = false;
      }
    });
  }

  for (const row of document.querySelectorAll("#room-detail-panel .decor-row")) {
    const { slot, category } = row.dataset;
    row.querySelector(".decor-upload-btn").addEventListener("click", () => {
      pendingRow = { slot, category };
      fileInput.value = "";
      fileInput.click();
    });
    row.addEventListener("dragover", (ev) => {
      if (!ev.dataTransfer || !Array.from(ev.dataTransfer.types).includes("Files")) return;
      ev.preventDefault();
      row.classList.add("drag-over");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
    row.addEventListener("drop", (ev) => {
      ev.preventDefault();
      row.classList.remove("drag-over");
      uploadDecorToSlot(roomId, slot, category, ev.dataTransfer.files[0]);
    });
  }

  fileInput.addEventListener("change", () => {
    if (pendingRow) uploadDecorToSlot(roomId, pendingRow.slot, pendingRow.category, fileInput.files[0]);
  });

  const resetBtn = document.getElementById("decor-reset-btn");
  resetBtn.addEventListener("click", async () => {
    resetBtn.disabled = true;
    try {
      await deleteAsset(`/api/rooms/${roomId}/decor`);
      setDecorFlash(roomId, `<div class="appearance-success">✓ 初期状態に戻しました</div>`);
    } catch (err) {
      setDecorFlash(roomId, `<div class="appearance-error">${escapeHtml(err.message)}</div>`);
      resetBtn.disabled = false;
    }
  });

  for (const btn of document.querySelectorAll("#room-detail-panel .decor-delete-btn")) {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        await deleteAsset(`/api/decor/${btn.dataset.category}/${btn.dataset.name}`);
        setDecorFlash(roomId, `<div class="appearance-success">✓ 部品「${escapeHtml(btn.dataset.name)}」を削除しました</div>`);
      } catch (err) {
        setDecorFlash(roomId, `<div class="appearance-error">${escapeHtml(err.message)}</div>`);
        btn.disabled = false;
      }
    });
  }
}

function renderRoomDetail() {
  const panel = document.getElementById("room-detail-panel");
  const room = store.selectedRoomId ? allRooms().find((r) => r.id === store.selectedRoomId) : null;

  if (!room) {
    panel.classList.add("empty");
    panel.innerHTML = `<p class="hint">部屋をクリックすると名前や見た目を編集できます。</p>`;
    return;
  }

  panel.classList.remove("empty");
  const keywordsHtml = room.keywords?.length
    ? `<div class="meta">判定キーワード: ${room.keywords.map((k) => escapeHtml(k)).join(", ")}</div>`
    : "";

  const scrollTop = panel.scrollTop;
  panel.innerHTML = `
    <h3>${escapeHtml(room.label)}</h3>
    ${keywordsHtml}

    <h4>名前</h4>
    ${roomRenameHtml(room)}

    <h4>内装</h4>
    ${roomDecorEditorHtml(room)}

    <h4>背景画像（全面・旧方式）</h4>
    ${roomAppearanceEditorHtml(room)}

    <h4>削除</h4>
    ${roomDeleteHtml(room)}
  `;

  attachRoomRenameHandlers(room.id);
  attachRoomDecorHandlers(room.id);
  attachRoomAppearanceHandlers(room.id);
  attachRoomDeleteHandlers(room.id);
  panel.scrollTop = scrollTop;
}

// -------------------------------------------------------- room add ---
function initRoomAddForm() {
  const toggleBtn = document.getElementById("room-add-toggle-btn");
  const form = document.getElementById("room-add-form");
  const labelInput = document.getElementById("room-add-label");
  const keywordsInput = document.getElementById("room-add-keywords");
  const submitBtn = document.getElementById("room-add-submit-btn");
  const cancelBtn = document.getElementById("room-add-cancel-btn");
  const msg = document.getElementById("room-add-msg");

  toggleBtn.addEventListener("click", () => {
    form.hidden = !form.hidden;
    if (!form.hidden) labelInput.focus();
  });

  cancelBtn.addEventListener("click", () => {
    form.hidden = true;
    labelInput.value = "";
    keywordsInput.value = "";
    msg.innerHTML = "";
  });

  submitBtn.addEventListener("click", async () => {
    const label = labelInput.value.trim();
    if (!label) {
      msg.innerHTML = `<div class="appearance-error">部屋名を入力してください</div>`;
      return;
    }
    const keywords = keywordsInput.value
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);

    submitBtn.disabled = true;
    msg.innerHTML = `<div class="appearance-notes">作成中…</div>`;
    try {
      await postJson("/api/rooms", { label, keywords });
      // Reload is triggered globally by the server's rooms-changed SSE event.
    } catch (err) {
      msg.innerHTML = `<div class="appearance-error">${escapeHtml(err.message)}</div>`;
      submitBtn.disabled = false;
    }
  });
}

// -------------------------------------------------------- connection ---
function renderConnection(connected) {
  const badge = document.getElementById("conn-status");
  badge.textContent = connected ? "接続中" : "切断";
  badge.className = `badge ${connected ? "badge-online" : "badge-offline"}`;
}

export function initHud() {
  initTabs();
  initViewSwitcher();
  initRoomAddForm();

  store.subscribe((type, data) => {
    if (["snapshot", "agent-change", "agent-removed", "select", "asset-change"].includes(type)) {
      renderAgentList();
      renderAgentDetail();
    }
    if (["rooms", "select-room", "asset-change", "snapshot", "agent-change", "agent-removed", "room-decor", "decor-library"].includes(type)) {
      renderRoomList();
    }
    // The room panel holds dropdowns and file pickers, so it's only rebuilt
    // when something it shows changed — not on every agent status update,
    // which would close an open dropdown mid-selection.
    const roomDetailChanged =
      ["rooms", "select-room", "snapshot", "decor-library"].includes(type) ||
      (type === "asset-change" && data.assetKind === "room") ||
      (type === "room-decor" && data.roomIds.includes(store.selectedRoomId));
    if (roomDetailChanged) {
      if (type === "select-room") decorFlash = null;
      renderRoomDetail();
    }
    if (type === "connection") {
      renderConnection(store.connected);
    }
  });

  setInterval(() => {
    const el = document.getElementById("server-time");
    el.textContent = store.serverTime ? `最終更新: ${new Date(store.serverTime).toLocaleTimeString("ja-JP")}` : "";
    tickPermissionElapsed();
  }, 1000);

  renderConnection(false);
}
