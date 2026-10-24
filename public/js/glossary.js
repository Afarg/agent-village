// 用語説明の小窓（docs/design/15-setup-guide-and-glossary.md §2）。
// Claude Code の設定用語を、エンジニアでない人向けに一言で説明する。
// 用語は `term()` で「?」印付きにして出し、マウスを乗せる・キーボードで選ぶ・
// 「?」を押す（タッチ）と、1つだけの小窓（#term-pop）に説明を出す。
// 画面のどこからでも data-term を付けた要素に効く（構成画面・導入のモーダル）。

export const GLOSSARY = {
  agents: {
    title: "エージェント（サブエージェント）",
    body: "仕事ごとの「専門の担当者」の設定です。名前・役割・使ってよい道具を書いたファイルで、Claude が必要に応じて仕事を任せます。",
    example: "このオフィスのキャラ1人が、エージェント1つに対応します。",
  },
  skills: {
    title: "スキル",
    body: "特定の作業の「手順書」です。Claude が必要なときに読み込み、そのとおりに作業します。",
    example: "例: 「PDF を作る手順」「バグを直して確かめる手順」",
  },
  commands: {
    title: "コマンド（スラッシュコマンド）",
    body: "「/名前」と打つだけで決まった指示を Claude に渡せる、定型文のショートカットです。",
    example: "例: /review と打つと、決まった観点でのレビューを頼める",
  },
  mcp: {
    title: "MCP サーバー",
    body: "Claude が外部のサービスや道具を使えるようにする「接続口」です。MCP（Model Context Protocol）は、そのつなぎ方の共通ルールの名前です。",
    example: "例: Google ドライブを読む、ブラウザを操作する",
  },
  plugins: {
    title: "プラグイン",
    body: "エージェント・スキル・コマンド・フックなどを1つにまとめた「追加パック」です。入れると中身をまとめて使えます。",
  },
  marketplace: {
    title: "マーケットプレイス",
    body: "プラグインを探して入れるための、配布元のカタログです。",
  },
  hooks: {
    title: "フック",
    body: "「〜したときに、自動でこれを実行する」という決まりです。Claude Code が合図を出すたびに、登録したプログラムが動きます。",
    example: "Agent Village は「エージェントが仕事を始めた／終えた」の合図で、キャラを動かしています。",
  },
  matcher: {
    title: "マッチャー",
    body: "フックを動かす対象の絞り込み条件です。空欄なら、すべてが対象になります。",
  },
  permissions: {
    title: "権限",
    body: "Claude が使ってよい操作のルールです。「許可」はいつでも使ってよい、「確認」は毎回あなたに聞く、「拒否」は使わせない、の3種類です。",
    example: "例: ファイルの削除は「確認」にしておく",
  },
  defaultMode: {
    title: "既定のモード",
    body: "確認の出し方の初期設定です。毎回聞くか、ファイルの編集などは聞かずに進めるか、などを決めます。",
  },
  additionalDirectories: {
    title: "追加の作業フォルダ",
    body: "プロジェクトのフォルダの外で、Claude が読み書きしてよいフォルダです。",
  },
  env: {
    title: "環境変数",
    body: "Claude Code が動くときに渡される設定値です。接続先や動きの切り替えなどに使います。値には秘密の情報が入ることがあるので、この画面では表示しません。",
  },
  memory: {
    title: "メモリ（CLAUDE.md）",
    body: "Claude が作業のたびに最初に読む「申し送りメモ」です。プロジェクトのルールや注意点を書いておきます。",
  },
  scopeUser: {
    title: "ユーザー全体",
    body: "この PC のあなたの設定（~/.claude/）です。すべてのプロジェクトに効きます。",
  },
  scopeProject: {
    title: "プロジェクト",
    body: "このプロジェクトのフォルダの中の設定（.claude/）です。このプロジェクトだけに効きます。",
  },
  settingsFiles: {
    title: "settings.json と settings.local.json",
    body: "どちらも Claude Code の設定ファイルです。settings.json はチームで共有する設定、settings.local.json は自分の PC だけの設定です。",
  },
  sources: {
    title: "読み込んだファイル",
    body: "この画面を作るために読んだ設定ファイルと、読めたかどうかです。",
  },
  subagentStart: {
    title: "SubagentStart（仕事を始めた）",
    body: "エージェントが仕事を始めたときの合図です。これでキャラが自分の机に移動し「作業中」になります。",
  },
  subagentStop: {
    title: "SubagentStop（仕事を終えた）",
    body: "エージェントが仕事を終えたときの合図です。これで完了の報告が出て、キャラが休憩所に戻ります。",
  },
  permissionRequest: {
    title: "PermissionRequest（許可を待っている）",
    body: "エージェントが操作の許可を待って止まったときの合図です。これでキャラの頭上に「許可を待っています」が出ます。",
  },
};

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Label with a "?" mark that opens its explanation. `label` is plain text.
export function term(key, label) {
  if (!GLOSSARY[key]) return escapeHtml(label);
  return `<span class="term" data-term="${key}">${escapeHtml(label)}<button type="button" class="term-q" data-term="${key}" aria-label="「${escapeHtml(GLOSSARY[key].title)}」とは">?</button></span>`;
}

const SHOW_DELAY_MS = 150;
let pop = null;
let anchor = null;
let showTimer = null;

function place(el) {
  const r = el.getBoundingClientRect();
  const pad = 8;
  pop.style.left = "0px";
  pop.style.top = "0px";
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  let left = Math.min(Math.max(pad, r.left + r.width / 2 - w / 2), window.innerWidth - w - pad);
  let top = r.bottom + 6;
  if (top + h > window.innerHeight - pad) top = Math.max(pad, r.top - h - 6);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function show(el) {
  const g = GLOSSARY[el.dataset.term];
  if (!g) return;
  anchor = el;
  pop.innerHTML = `<b>${escapeHtml(g.title)}</b><p>${escapeHtml(g.body)}</p>${g.example ? `<p class="term-ex">${escapeHtml(g.example)}</p>` : ""}`;
  pop.hidden = false;
  place(el);
}

function hide() {
  clearTimeout(showTimer);
  anchor = null;
  if (pop) pop.hidden = true;
}

// The element a pointer/focus event is about: the "?" button, or the term /
// [data-term] element around it.
const termEl = (target) => (target instanceof Element ? target.closest("[data-term]:not(.term-q)") || target.closest(".term-q") : null);

export function initGlossary() {
  pop = document.getElementById("term-pop");
  // Inside an open <dialog> (top layer) the page-level popup would be hidden
  // behind it, so it moves into the dialog while one is open.
  const host = () => document.querySelector("dialog[open]") || document.body;
  const ensureHost = () => {
    const h = host();
    if (pop.parentElement !== h) h.appendChild(pop);
  };

  document.addEventListener("mouseover", (e) => {
    const el = termEl(e.target);
    if (!el || el === anchor) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      ensureHost();
      show(el);
    }, SHOW_DELAY_MS);
  });
  document.addEventListener("mouseout", (e) => {
    const el = termEl(e.target);
    if (!el) return;
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return;
    hide();
  });
  document.addEventListener("focusin", (e) => {
    const el = termEl(e.target);
    if (el) {
      ensureHost();
      show(el);
    }
  });
  document.addEventListener("focusout", (e) => {
    if (termEl(e.target)) hide();
  });
  // touch: pressing the "?" shows it (there is no hover); pressing anywhere
  // else hides it. The press never reaches what the term sits in (e.g. a row
  // that expands on click).
  document.addEventListener("click", (e) => {
    const q = e.target instanceof Element ? e.target.closest(".term-q") : null;
    if (!q) {
      if (anchor && !(e.target instanceof Node && pop.contains(e.target))) hide();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    ensureHost();
    show(q.closest(".term") || q);
  }, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && anchor) {
      // close only the popup, not a dialog it sits in
      e.stopPropagation();
      e.preventDefault();
      hide();
    }
  }, true);
  window.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
}
