// Office layout choice and full screen (docs/design/14-desktop-layout.md §6).
// "wide" is the 16:9 desktop office (1236x696), "square" the original
// mobile one (744x696). The choice is made once per page load — switching
// reloads, since the Phaser map is built for one geometry.

const LAYOUT_KEY = "agentVillage.layout";
const PREFS = ["auto", "wide", "square"];
const AUTO_WIDE_MIN_WIDTH = 1200;

export function layoutPref() {
  try {
    const v = localStorage.getItem(LAYOUT_KEY);
    return PREFS.includes(v) ? v : "auto";
  } catch {
    return "auto";
  }
}

function resolveLayout(pref) {
  if (pref === "wide" || pref === "square") return pref;
  return window.innerWidth >= AUTO_WIDE_MIN_WIDTH && window.innerWidth > window.innerHeight ? "wide" : "square";
}

// Fixed for the page's lifetime.
export const currentLayout = resolveLayout(layoutPref());

export function roomsUrl() {
  return `/api/rooms?layout=${currentLayout}`;
}

export function isFullscreen() {
  return !!document.fullscreenElement;
}

function renderControls() {
  const select = document.getElementById("layout-select");
  const pref = layoutPref();
  select.value = pref;
  select.title = `オフィスの配置（いまは${currentLayout === "wide" ? "デスクトップ用・横長" : "モバイル用・正方形"}）`;
  const fs = document.getElementById("fullscreen-btn");
  fs.textContent = isFullscreen() ? "⛶ 戻す" : "⛶ 全画面";
  fs.title = isFullscreen() ? "全画面をやめる（Esc でも戻れます）" : "オフィスを画面いっぱいに表示する";
}

export function initLayoutControls() {
  const select = document.getElementById("layout-select");
  select.addEventListener("change", () => {
    try {
      localStorage.setItem(LAYOUT_KEY, select.value);
    } catch {
      // storage unavailable: the choice can't persist, so don't reload into the old one
      return;
    }
    if (resolveLayout(select.value) !== currentLayout) window.location.reload();
    else renderControls();
  });

  const fsBtn = document.getElementById("fullscreen-btn");
  if (!document.fullscreenEnabled) {
    fsBtn.disabled = true;
    fsBtn.title = "このブラウザでは全画面表示が使えません";
  }
  fsBtn.addEventListener("click", async () => {
    try {
      if (isFullscreen()) await document.exitFullscreen();
      else await document.getElementById("game-container").requestFullscreen();
    } catch (err) {
      console.warn("[layout] fullscreen failed", err);
    }
  });
  document.addEventListener("fullscreenchange", renderControls);
  document.body.dataset.layout = currentLayout;
  renderControls();
}
