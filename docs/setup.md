# Agent Village 導入手順書

Claude Code のサブエージェント群を、ピクセルアート風の「村」でキャラクターとして可視化するローカルダッシュボードのセットアップ手順。設計の背景は `docs/design/` 配下を参照。

> 「今すぐ何をすればいいか」だけを知りたい場合は、要点を絞った `docs/manual-install-guide.md` を参照。本書はオプション・トラブルシューティング・設計背景まで含む詳細版。

---

## 1. これは何か

- `.claude/agents/*.md`（Claude Code のサブエージェント定義）と `agents/state/*.json`（実行時の状態）を読み取り、各エージェントを1体のドット絵キャラクターとしてブラウザ上に表示するツール。
- 待機中は休憩所、作業中は役職に応じた部屋にいて、進捗ログをチャット吹き出しで表示する。
- Node.js のローカルサーバー（`server/`）がファイルを監視し、ブラウザ（`public/`）へ SSE でリアルタイム配信する構成。
- **`agent-village` という1個のCLIコマンドとして配布できる**（`npm link`/`npm install -g`/将来の `npx agent-village`）。**どのプロジェクトのディレクトリで実行しても、そのプロジェクトを自動的に監視対象にする**（§4・`docs/design/04-multi-project-integration.md` §6.2）。

---

## 2. 前提条件

| 項目 | 要件 |
|---|---|
| Node.js | 18 以上を推奨（開発・動作確認は v26.5.0） |
| npm | Node.js に同梱のもので可 |
| ブラウザ | Chrome / Edge など、EventSource・Fetch API・ES Modules に対応したモダンブラウザ |
| OS | Windows / macOS / Linux（ファイル監視は chokidar が差異を吸収） |
| ネットワーク | フロントエンドは Phaser 3 を CDN（jsdelivr）から読み込むため、初回表示時にインターネット接続が必要 |

---

## 3. ディレクトリ構成

`agents_app`（このツール自体、= インストールルート）と、監視対象プロジェクト（= ターゲットルート）は別概念（`docs/design/04-multi-project-integration.md` §2）。`agent-village` コマンドは、実行時のカレントディレクトリを自動的にターゲットルートとして扱う。

```
<ターゲットルート>/            # 例: agent-village を実行したプロジェクトのルート
├─ .claude/
│   └─ agents/                # Claude Code サブエージェント定義（*.md）。ここにあるものがキャラクターになる
├─ agents/
│   ├─ state/                 # 実行時状態（*.json）。無ければ idle 扱い
│   └─ config/rooms.json      # 部屋の定義（可変・ダッシュボードから編集可）。初回起動時に自動生成される
└─ assets/
    └─ custom/
        ├─ characters/        # ダッシュボードからアップロードしたキャラクター差し替え画像
        └─ rooms/             # 同、部屋の背景差し替え画像

agents_app/                    # インストールルート（ツール自体。__dirname 基準で固定）
├─ package.json                # ツールのパッケージ定義（"bin": agent-village）
├─ bin/
│   └─ agent-village.js        # CLIエントリーポイント。ターゲット省略時は process.cwd() を採用
├─ server/
│   ├─ src/
│   │   ├─ index.js            # 実処理の本体。ターゲットルート解決もここ（--target / TARGET_PROJECT_ROOT）
│   │   ├─ config/
│   │   │   ├─ rooms.default.json  # rooms.json の初期テンプレート（ターゲット側に無ければコピーされる）
│   │   │   └─ palette.json         # color→配色の対応表（プロジェクト非依存、常にツール側）
│   │   └─ lib/                 # frontmatter パーサ、状態正規化、レイアウト計算など
│   └─ scripts/demo-seed.js     # 動作確認用の状態シミュレーター（ターゲット指定可）
├─ public/                     # フロントエンド（ビルド不要の素の HTML/CSS/JS）
│   ├─ index.html
│   ├─ style.css
│   └─ js/                     # store.js（状態管理）/ game.js（Phaser描画）/ hud.js（サイドバーUI）
└─ docs/
    ├─ setup.md                 # この文書
    └─ design/                  # ビジュアル・データモデル・技術選定の設計ドキュメント
```

---

## 4. インストール手順

### 4.1 このマシンで `agent-village` コマンドを使えるようにする（推奨）

```bash
cd agents_app
npm install
npm link
```

`npm link` はこの `agents_app` チェックアウトを、マシン全体から呼べる `agent-village` コマンドとして登録する（グローバルインストールの代わりの開発向け手段。実体は `agents_app` を指すシンボリックリンクなので、`agents_app` 側を編集すれば `agent-village` コマンドの動作も追従する）。将来 npm レジストリに公開すれば `npm install -g agent-village` や `npx agent-village` でも同じコマンドが使えるようになる（`docs/design/04-multi-project-integration.md` §6.2、公開自体は未実施）。

不要になったら `npm unlink -g agent-village`（または `npm rm -g agent-village`）で解除できる。

### 4.2 このチェックアウトだけで動かす（軽量・linkしたくない場合）

`npm link` をせず、`node` でパスを直接指定して起動することもできる（§5.3）。依存パッケージのインストールだけは必要。

```bash
cd agents_app
npm install
```

インストールされる主な依存関係:

| パッケージ | 用途 |
|---|---|
| express | HTTP サーバー・静的配信・API |
| chokidar | `.claude/agents`・`agents/state`・`assets/custom` の変更監視 |
| multer | 画像アップロード（差し替え機能）の受信 |

---

## 5. 起動方法

### 5.1 見たいプロジェクトで `agent-village` を実行する（推奨・§4.1のリンク後）

```bash
cd D:\work\other-project
agent-village
```

カレントディレクトリ（ここでは `D:\work\other-project`）を自動的にターゲットルートとして監視し、サーバー起動後にブラウザを自動的に開く。起動ログの `target project:` 行で、実際に監視されているパスを必ず確認すること。

```
Agent Village server listening on http://localhost:4173
  target project:      D:\work\other-project
  watching definitions: D:\work\other-project\.claude\agents
  watching state:       D:\work\other-project\agents\state
  watching assets:      D:\work\other-project\assets\custom\characters, ...\assets\custom\rooms
  rooms config:         D:\work\other-project\agents\config\rooms.json (created from template)
  agents loaded:        1 (pdf-extractor)
```

- ポートを変えたい場合は環境変数 `PORT` を指定する（例: `PORT=5000 agent-village`）。
- ブラウザの自動起動が不要な場合は `AGENT_VILLAGE_AUTO_OPEN=0 agent-village`。
- カレントディレクトリではなく明示的に別のパスを見せたい場合は `agent-village --target "D:\other\project"`。
- `agents/config/rooms.json` がターゲット側にまだ無ければ、`server/src/config/rooms.default.json` から自動的にコピーされる（`(created from template)` と表示される）。以後はターゲットプロジェクト側のファイルが正であり、ダッシュボードの「部屋」タブからの編集もそちらに書き込まれる。プロジェクトごとに部屋構成を独立させたい場合の設計は `docs/design/04-multi-project-integration.md` §4 を参照。
- `assets/custom/*`（差し替え画像）・`agents/state/*.json` もすべてターゲットプロジェクト側に作成される。`agents_app` 自身は汚さない。
- 複数プロジェクトを同時に見たい場合は、`PORT` を変えてプロセスを複数起動する（1プロセス＝1ターゲットプロジェクト）。
- サーバーは `.claude/agents/*.md` と `agents/state/*.json` を起動時に全走査し、以降はファイル監視で差分を反映する。起動中に `.claude/agents/` へエージェント定義を追加・編集・削除すれば、ページを再読み込みしなくても画面に反映される。
- `agents/state/*`（実行時データ）はターゲットプロジェクトの `.gitignore` に追加することを推奨。`agents/config/rooms.json`（部屋構成）はチームで共有したい設定であればコミット推奨。

### 5.2 `agent-village` をコピーしないこと

`.claude/agents/agent-creator.md` / `agent-dispatcher.md` は `agents_app` 自身を管理するための自己参照的なエージェントで、本文中に絶対パスを直書きしている。ターゲットプロジェクト側にコピーする必要はない（§7参照）。ターゲットプロジェクト側で用意するのは通常の `.claude/agents/*.md` だけでよい。

### 5.3 `agents_app` 自身の開発・デモ用（`npm link` していない場合）

`agents_app` 自体の見た目やロジックを検証したいとき用。`npm start` はターゲット省略時に `agents_app` 自身を監視する（`agent-village` コマンドの cwd 自動検出とは挙動が異なる点に注意）。

```bash
cd agents_app
npm start
# 別プロジェクトを見たい場合:
npm start -- --target "D:\work\other-project"
# または
TARGET_PROJECT_ROOT="D:\work\other-project" PORT=4173 npm start
```

ブラウザで **http://localhost:4173** を開く（自動起動しない）。

---

## 6. 動作確認（デモ）

実際の Claude Code フックから `agents/state/*.json` を書き込む仕組みはまだ無い（§10 参照）。見た目を確認したいだけなら、付属のシミュレーターで動作を再現できる。

```bash
cd agents_app
npm run demo
# 別プロジェクトへ書き込みたい場合:
TARGET_PROJECT_ROOT="D:\work\other-project" npm run demo
```

既存のエージェントの状態ファイルを数秒おきに idle → assigned → working → done → idle と巡回させ、休憩所↔部屋の移動・チャット吹き出し・完了演出をブラウザ上で確認できる。**実データではなく検証用のダミー動作なので、確認が終わったら `Ctrl+C` で停止すること。**

---

## 7. 新しいエージェントを追加する

### 方法A: 手動で `.claude/agents/*.md` を作成する

Claude Code の通常のサブエージェント定義と同じ形式。

```markdown
---
name: pdf-data-extractor
description: Use this agent when the user needs to extract structured data from PDF invoices...
model: sonnet
color: cyan
room: coder
tools: ["Read", "Write", "Bash"]
---

あなたはPDFから構造化データを抽出する専門エージェントです。
...
```

- `room:` は任意フィールド。省略すると `name`/`description` 中のキーワードからターゲットプロジェクトの `agents/config/rooms.json` の各部屋の `keywords` と照合し、自動的に部屋が決まる（最初に一致した部屋。どれにも一致しなければ「フリーデスク」）。
- 保存すると数百ミリ秒以内にダッシュボードへ自動反映される。

### 方法B: `agent-creator` / `agent-dispatcher` を使う（`agents_app` 自身専用）

`agents_app` リポジトリには2つの管理用サブエージェントが同梱されている。これは **`agents_app` 自身の開発（§5.3のセルフデモ）でのみ使うものであり、ターゲットプロジェクト側にコピーして使うものではない**（`docs/design/04-multi-project-integration.md` §5）。

- **`agent-dispatcher`**: 依頼内容を見て、既存エージェントの中から適任を選んで委任する。適任がいなければ `agent-creator` に新規作成を依頼する。
- **`agent-creator`**: 新しいサブエージェント定義（`.claude/agents/*.md`）を作成する。部屋の自動判定が効くよう、キーワードや `room:` フィールドを適切に設定する。

---

## 8. エージェント・部屋の管理(ダッシュボードUI)

ブラウザ右側のサイドバーから、サーバーを再起動せずに以下を操作できる。

| 操作 | 手順 |
|---|---|
| エージェントの名前変更 | 「エージェント」タブ→対象を選択→「名前」欄で変更。`.claude/agents/*.md` のファイル名・`name:`、対応する状態ファイル・差し替え画像も自動的にリネームされる |
| キャラクターの見た目差し替え | 同→「見た目」欄からPNGをアップロード。**PNG・正方形・16〜128px・300KB以下**（ダッシュボード上にも注意書き表示） |
| 部屋の名前変更 | 「部屋」タブ→対象を選択→「名前」欄で変更 |
| 部屋の背景差し替え | 同→「見た目」欄からPNGをアップロード。**PNG・16〜1024px・800KB以下**、推奨サイズ140×120px（比率が違うと引き伸ばされる） |
| 部屋の追加 | 「部屋」タブ→「＋部屋を追加」→部屋名と判定キーワード（任意、カンマ区切り）を入力 |
| 部屋の削除 | 部屋詳細パネル→「この部屋を削除」（2回押しで確定）。休憩所は削除不可。削除された部屋にいたエージェントは、次に条件に合う部屋かフリーデスクへ自動的に移動する |

部屋の追加・削除・改名は他の閲覧者の画面にも即座に反映されるよう、全クライアントを自動リロードする仕様（キャラクター名の変更のみリロードなしで反映）。

---

## 9. 配布について（現状の到達点と残り）

`docs/design/04-multi-project-integration.md` §6.2 で構想していた「単一コマンドでの配布」は、`npm link` によるローカルなグローバルコマンド化まで実装済み。以下は現状整理。

| 到達点 | 状態 |
|---|---|
| 任意プロジェクトを `--target`/環境変数で指定できる | 実装済み（§5.3） |
| `agent-village` という1コマンドで起動でき、cwdを自動でターゲットにする | 実装済み（§5.1） |
| `npm link` でこのマシンにコマンドとして登録 | 実装済み（§4.1） |
| npm レジストリへの公開（`npx agent-village` を他人のマシンでも） | **未実施**。`package.json` は現在 `"private": true`（誤公開防止）。公開する場合は名前衝突確認・`private` 解除・`npm publish` の実行が必要（実行には別途明示的な指示が要る） |
| スタンドアロン実行ファイル化・GUIアプリ化 | 未着手（今回は npm CLI の方向を選択したため対象外） |

---

## 10. 実運用への組み込み（hooks連携。実装済み）

`agents/state/*.json` を実際の Claude Code の実行と連動して自動的に書き込む仕組みを実装した(`docs/design/05-hooks-state-writer.md`)。これにより、hooksを設定したプロジェクトでは実際にサブエージェントが動く/終わるタイミングでダッシュボードのキャラクターが自動的に動く。

### 導入手順

対象プロジェクトの `.claude/settings.json`（チームで共有する場合）または `.claude/settings.local.json`（自分のマシンだけの場合）に以下を追記する。

```jsonc
{
  "hooks": {
    "SubagentStart": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node \"<agents_appの絶対パス>/bin/agent-village-hook.js\"" }] }
    ],
    "SubagentStop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node \"<agents_appの絶対パス>/bin/agent-village-hook.js\"" }] }
    ]
  }
}
```

`<agents_appの絶対パス>` は `agent-village` ツール本体（このリポジトリ）の設置場所（例: `D:/app/agents_app`）。`matcher: ""` で、そのプロジェクトの `.claude/agents/*.md` に何が増えても自動的に拾う。

設定後、Claude Code のセッションでサブエージェント（`Agent`/`Task` ツール経由）を実行すると、実行中は「作業中」、終了すると「完了」演出→5秒後に「休憩所」へ自動的に戻る（`docs/design/02-agent-state-model.md` §4.2 の状態遷移をhook側で実装）。

### 何が分かって、何が分からないか

| 項目 | 内容 |
|---|---|
| いつ動いたか | ✅ 正確（`SubagentStart`/`SubagentStop` はライフサイクルの両端を確実に捕捉） |
| 何をしていたか（タスクの具体的な内容） | ❌ 取れない。表示は `"<エージェント名> を実行中"` という機械的な文言に固定（`docs/design/05-hooks-state-writer.md` §3.2、理由も記載） |
| 実行中の途中経過（ログが複数行増えていく演出） | ❌ 取れない。開始と終了の2点のみ |
| 完了時の要約 | ✅ 取れる（サブエージェントの最終出力をそのまま表示） |
| 成功/失敗の判定 | ❌ 取れない。常に成功（`result.ok: true`）として扱う |

書き込み先スキーマの詳細は `docs/design/02-agent-state-model.md` §4、hook自体の実装判断・実測データは `docs/design/05-hooks-state-writer.md` を参照。

---

## 11. トラブルシューティング

| 症状 | 確認事項 |
|---|---|
| `EADDRINUSE` で起動しない | 既に別プロセスがポート4173を使用している。`PORT=別番号 agent-village` で回避するか、既存プロセスを終了する |
| hooksを設定したのにキャラクターが動かない | `.claude/settings.json`/`settings.local.json` の `hooks.SubagentStart`/`SubagentStop` の `command` パスが正しいか確認。`node "<path>/bin/agent-village-hook.js"` の `<path>` が実在するか確認 |
| `agent-village: command not found` | `npm link`（§4.1）を実行したか確認。`npm bin -g` の出力先がPATHに通っているかも確認 |
| 別プロジェクトを指定したのに `agents_app` 自身が表示される | 起動ログの `target project:` 行を確認する。`npm start`（§5.3）はcwd自動検出をしない点に注意（`agent-village` コマンド、または `--target`/`TARGET_PROJECT_ROOT` の指定漏れ・パス誤りが多い原因） |
| エージェントが画面に出ない | `.claude/agents/*.md` の frontmatter に `name:` があるか確認（`name` が無いファイルは無視される）。サーバーの起動ログに `[agentDefs] failed to parse ...` が出ていないか確認 |
| キャラクターが休憩所から動かない | 対応する `agents/state/<agentId>.json` が存在し、`status` が `idle` 以外になっているか確認。ファイルが存在しない場合は常に idle 扱い |
| 部屋が想定と違う | `room:` フィールドを明示していないか、ターゲットプロジェクトの `agents/config/rooms.json` の各部屋の `keywords` と `name`/`description` の一致を確認。優先順位は `rooms.json` の配列順 |
| 画像アップロードが失敗する | PNG形式か、サイズ制限（§8参照）を超えていないかを確認。エラーメッセージに具体的な制約値が表示される |
| ブラウザが真っ白 / キャラクターが出ない | インターネット接続を確認（Phaser 3 を CDN から読み込むため）。ブラウザの開発者ツールでコンソールエラーを確認 |
| 接続バッジが「切断」のまま | サーバープロセスが起動しているか確認。SSE は自動再接続するため、サーバー復旧後に自動的に「接続中」へ戻る |

---

## 12. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| `docs/manual-install-guide.md` | **他プロジェクトへの手動導入だけに絞った簡潔ガイド**（npm公開なし前提）。初めて導入する場合はまずこちら |
| `docs/operations-guide.md` | 起動中インスタンスの確認・複数プロジェクトの切り替え・安全な停止、hooks設定の変更/解除の手順 |
| `docs/design/01-visual-concept.md` | ビジュアルコンセプト（アートスタイル・部屋レイアウト・アニメーション） |
| `docs/design/02-agent-state-model.md` | データ/状態モデル、部屋の判定ルール、状態遷移 |
| `docs/design/03-tech-recommendation.md` | 技術選定の背景（Phaser 3 + chokidar + SSE 構成の理由） |
| `docs/design/04-multi-project-integration.md` | 他プロジェクトへの導入設計・CLIパッケージ化（ターゲットプロジェクト指定・`rooms.json` の置き場所・配布方法）。§1〜§7・§6.2のCLI化までは実装済み。npmレジストリへの公開のみ未着手 |
| `docs/design/05-hooks-state-writer.md` | hooksによる状態自動書き込みの設計・実測データ・既知の限界。実装済み |
| `img_to_pixcel_app/` | 別ツール「PixelForge」（仮称）。画像からピクセルキャラクターを自動生成し、Agent Villageのキャラクター画像として取り込める汎用ソフト。**実装済み・実機検証済み**（`cd img_to_pixcel_app && .venv/Scripts/python.exe -m uvicorn app.main:app --port 4273`） |
| `ani_convert_app/` | 別ツール「PixelAnimator」（仮称）。PixelForgeが生成したピクセルキャラクターから、まばたき・歩行の差分フレームを自動生成する汎用ソフト。**実装済み・実機検証済み**（`cd ani_convert_app && .venv/Scripts/python.exe -m uvicorn app.main:app --port 4373`） |
| `docs/design/07-directional-animation-support.md` | Agent Village本体側に必要な、複数フレーム・複数方向スプライートの再生対応の設計 |
| `.claude/agents/agent-creator.md` | エージェント作成担当サブエージェントの定義（`agents_app` 自身専用。他プロジェクトへのコピー非推奨） |
| `.claude/agents/agent-dispatcher.md` | タスク振り分け担当サブエージェントの定義（同上） |
