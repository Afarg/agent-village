# 04. 他プロジェクトへの導入設計 — Agent Village Dashboard

`agents_app` を「自分自身（このリポジトリ）専用のダッシュボード」から「任意の別プロジェクトの `.claude/agents` を監視できるツール」に変えるための設計。

**実装状況**: §1〜§7・§9（チェックリスト1〜6）は実装済み。§6.2（CLIパッケージ化）は `npm link` によるローカルなグローバルコマンド化まで実装済み（§10 追記）。§8「状態ファイルの自動書き込み」も `docs/design/05-hooks-state-writer.md` で解決済み。未実装として残っているのは npm レジストリへの公開（実際の `npx agent-village` を他人のマシンでも使えるようにする最後の一手）のみ。実装内容は `docs/setup.md` §4〜§6・§9〜§10 を参照。

対象読者: `server/` の実装者。
関連ドキュメント: `02-agent-state-model.md`（データ契約）、`03-tech-recommendation.md`（技術選定・§5「状態ファイルの書き込み主体は範囲外」の続き）。

---

## 1. 現状の問題（調査結果）

`server/src/index.js` は起動時に監視対象パスを次のように決定している。

```js
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const AGENTS_DEF_DIR = path.join(PROJECT_ROOT, ".claude", "agents");
const AGENTS_STATE_DIR = path.join(PROJECT_ROOT, "agents", "state");
const CHARACTER_ASSET_DIR = path.join(PROJECT_ROOT, "assets", "custom", "characters");
const ROOM_ASSET_DIR = path.join(PROJECT_ROOT, "assets", "custom", "rooms");
```

`PROJECT_ROOT` は **`__dirname`（`server/src/index.js` 自身の設置場所）からの相対解決**で、常に `agents_app` 自身のディレクトリに固定される。`process.cwd()` も環境変数も参照しないため、`agents_app` をどこから起動しても、また `server/scripts/demo-seed.js` をどう実行しても、**監視・書き込み対象は永遠に `agents_app` 自身**になる。他プロジェクトの `.claude/agents` を見せることは現状不可能。

追加で2つのハードコードがある（ボトルネックとして別枠で扱う必要がある）。

| ファイル | 内容 | 性質 |
|---|---|---|
| `server/src/lib/roomsStore.js:6` | `ROOMS_FILE = path.join(__dirname, "..", "config", "rooms.json")` | `lib/` 内部で `__dirname` ベースに再ハードコード（`index.js` の定数と二重定義） |
| `server/src/lib/normalize.js:1` | `require("../config/palette.json")` | 同上 |

また `.claude/agents/agent-creator.md` / `agent-dispatcher.md` は、システムプロンプト本文に `D:\app\agents_app` という絶対パスと、`server/src/config/rooms.json` というプロジェクトルート相対パスを直書きしている。これは「`agents_app` 自身を管理するための自己参照エージェント」なので他プロジェクトへコピーする対象ではないが、混同を避けるため §5 で扱いを明記する。

---

## 2. 用語整理: インストールルート / ターゲットルート

導入を設計するには、これまで暗黙に1つに束ねられていた2つの概念を分離する必要がある。

| 概念 | 指すもの | 現状の実体 | 導入後 |
|---|---|---|---|
| **インストールルート** | `agents_app` というツール自体の設置場所。サーバーコード・フロントエンド・依存パッケージ・パレット定義など「ツールの静的な中身」 | `PROJECT_ROOT`（`__dirname` 基準）と混同されている | `__dirname` 基準のまま固定（変更不要） |
| **ターゲットルート** | ダッシュボードが**可視化する対象**のプロジェクト。`.claude/agents/*.md`・`agents/state/*.json`・カスタム差し替え画像・部屋設定など「監視対象プロジェクトに属するデータ」 | インストールルートと同一視されている（バグの本体） | 起動時に指定可能な独立したパスにする |

自分自身（`agents_app`）を眺めるデモ用途は「ターゲットルート＝インストールルート」という特殊ケースとして両立させる（後方互換）。

---

## 3. ターゲットルート解決の設計

### 3.1 優先順位

```
1. CLI 引数 --target <path>       （最優先。明示指定）
2. 環境変数 TARGET_PROJECT_ROOT
3. デフォルト: path.resolve(__dirname, "..", "..")   （＝現状の挙動。後方互換）
```

- 相対パスが渡された場合は `process.cwd()` からではなく、**それを指定した時点の作業ディレクトリ**を基準に `path.resolve` する（PowerShell/bash どちらから起動しても直感的に一致させるため）。
- 起動ログに解決結果を必ず1行明示する（§6 参照）。誤ったプロジェクトを監視していることに気づけないのが最悪の失敗モードなので、ここは省略しない。

### 3.2 ターゲットルート配下に属するパス（変更対象）

```js
const AGENTS_DEF_DIR       = path.join(TARGET_ROOT, ".claude", "agents");
const AGENTS_STATE_DIR     = path.join(TARGET_ROOT, "agents", "state");
const CHARACTER_ASSET_DIR  = path.join(TARGET_ROOT, "assets", "custom", "characters");
const ROOM_ASSET_DIR       = path.join(TARGET_ROOT, "assets", "custom", "rooms");
const ROOMS_FILE           = path.join(TARGET_ROOT, "agents", "config", "rooms.json");   // §4 参照
```

`agentDefs.js` / `agentState.js` / `customAssets.js` / `renameAgent.js` はすでに「パスを引数で受け取る」設計になっているため、呼び出し元（`index.js`）を書き換えるだけで対応できる（調査済み・変更不要）。

### 3.3 インストールルートに残すパス（変更不要）

```js
const PUBLIC_DIR   = path.join(__dirname, "..", "..", "public");        // フロント資産
const PALETTE_FILE = path.join(__dirname, "config", "palette.json");    // 色定数（後述）
```

`node_modules`・`public/`・`palette.json` はツール自体の静的な中身であり、ターゲットプロジェクトごとに変わらないため、`__dirname` 基準のままで問題ない。

---

## 4. `rooms.json` の置き場所の決定

**論点**: 部屋定義（部屋名・判定キーワード・レイアウト）は「ツール自体の設定」なのか「ターゲットプロジェクトごとの設定」なのか。

- 現状はサーバーパッケージ内（`server/src/config/rooms.json`）に単一固定。複数のターゲットプロジェクトを切り替えて使うと、Aプロジェクト用に調整した部屋・キーワードがBプロジェクトにもそのまま影響してしまう。
- プロジェクトごとにエージェントの役割分布（コーダー中心/レビュー中心 等）は異なるはずなので、**部屋定義はターゲットプロジェクト側に属するべき**と判断する。`assets/custom/*`（差し替え画像）はすでに `PROJECT_ROOT` 基準でターゲット側に属しており、部屋定義だけ例外的にツール側に残っているのは設計上の矛盾。

**決定**: `rooms.json` を `agents/state/` と同じ階層の `<ターゲットルート>/agents/config/rooms.json` に置く。

- 初回起動時、そのファイルが存在しなければ `server/src/config/rooms.default.json`（同梱テンプレート、現行の `rooms.json` の内容をリネームしたもの）から**非破壊的にコピー**して生成する。以降はターゲットプロジェクト側のファイルが正となり、ダッシュボードUIからの編集もそちらに書き込む。
- `palette.json`（色名→16進色の対応表）は視覚定数であり役割分布に依存しないため、§3.3 の通りインストールルート側に残す（プロジェクトごとに変える理由がない）。
- `roomsStore.js` は `ROOMS_FILE` の `__dirname` ベース内部ハードコードをやめ、`index.js` から解決済みパスを引数で受け取る形にする（`agentDefs.js` 等と同じパターンに揃える）。

---

## 5. `.claude/agents/agent-creator.md` / `agent-dispatcher.md` の扱い

この2エージェントは「`agents_app` というダッシュボードプロジェクト自身に新しいサブエージェントを追加していく」ための自己参照的な管理エージェントであり、**他プロジェクトにコピーして使うことを想定した汎用テンプレートではない**。したがって今回の導入設計のスコープには含めない。

- そのままターゲットプロジェクトにコピーすると、本文中の絶対パス（`D:\app\agents_app`）とプロジェクトルート相対パス（`server/src/config/rooms.json`）がどちらも誤りになるため、コピー厳禁である旨を `setup.md` に明記する（§7 の変更点）。
- 「ターゲットプロジェクト側でエージェントを新規作成・振り分けする」ための汎用版が将来欲しくなった場合は、本文中のパス参照をすべて相対パス化し、`{{TARGET_ROOT}}` のようなプレースホルダに置き換えた別テンプレートとして再設計する（本ドキュメントでは扱わない、将来の別課題）。

---

## 6. 起動方法・配布モデル

### 6.1 モードA: 既存チェックアウトを再利用（実装コスト最小・最初に対応する）

`agents_app` はマシン上に1つだけチェックアウトしておき、見たいプロジェクトを都度指定する。

```bash
cd D:\app\agents_app\server
npm install                                     # 初回のみ
TARGET_PROJECT_ROOT="D:\work\other-project" PORT=4173 npm start
```

または CLI 引数版:

```bash
npm start -- --target "D:\work\other-project"
```

起動ログに解決結果を明示する（誤検知防止が最優先）:

```
Agent Village server listening on http://localhost:4173
  target project:      D:\work\other-project
  watching definitions: D:\work\other-project\.claude\agents
  watching state:       D:\work\other-project\agents\state
  watching assets:      D:\work\other-project\assets\custom\characters, ...\rooms
  rooms config:         D:\work\other-project\agents\config\rooms.json (created from template)
  agents loaded:        3 (coder, reviewer, planner)
```

別プロジェクトを同時に見たい場合は、`PORT` を変えて複数プロセスを並行起動する（1プロセス＝1ターゲットプロジェクトの単純な設計を維持し、複数ターゲット同時監視は範囲外とする）。

### 6.2 モードB: パッケージ化された CLI（実装済み。npmレジストリ公開のみ未着手）

`agents_app` 直下に `bin` エントリ付きの root `package.json` を追加し（`server/package.json` は廃止・統合）、ターゲットプロジェクト側から

```bash
agent-village
```

を実行するだけで、デフォルトのターゲットルートを `process.cwd()`（＝コマンドを叩いたプロジェクト自身）にする設計を実装した。§3.1 の `--target`/`TARGET_PROJECT_ROOT` による明示指定は `bin/agent-village.js` 経由でも変わらず優先される。詳細な実装内容は §10 を参照。

現状は `npm link` によりこのマシン上でグローバルコマンド化する形までを実装済み。npm レジストリへ公開すれば `npx agent-village`（初回インストール不要の一発起動）や、他人のマシンでの `npm install -g agent-village` も同様に動く設計になっているが、**実際の公開（`npm publish`）は行っていない**（パッケージ名の衝突確認・公開ポリシーの検討が必要なため。`package.json` は誤公開防止のため `"private": true` にしてある）。

---

## 7. `docs/setup.md` への反映点（本ドキュメント確定後に適用）

- §2 前提条件: 「監視対象は `agents_app` 自身固定」という記述を削除し、ターゲットルート概念を追加。
- §4/§5: `TARGET_PROJECT_ROOT` / `--target` の指定方法と、起動ログでの確認手順を追記。
- §7「新しいエージェントを追加する」: 方法Bの `agent-creator`/`agent-dispatcher` は **`agents_app` 自身に対してのみ有効**（§5参照）であり、ターゲットプロジェクト側にはコピーしないよう明記。
- §9「実運用への組み込み」: 本ドキュメントで解決したのは「監視対象を切り替えられること」のみであり、**ターゲットプロジェクト側で `agents/state/*.json` を実際に書き込む仕組み（hooks 連携）は依然として未解決**であることを明示する（§8参照）。

---

## 8. 残課題（本ドキュメントでは解決しない）

| 課題 | 内容 | 扱い |
|---|---|---|
| 状態ファイルの自動書き込み | ターゲットルートを切り替えられても、実際の Claude Code 実行から `agents/state/<agentId>.json` を書くものが無ければ、導入した瞬間は全キャラが idle のまま動かない | ✅ **解決済み**。`docs/design/05-hooks-state-writer.md` でhooksのペイロードを実機検証した上で設計・実装した（`bin/agent-village-hook.js`）。既知の限界（タスク詳細・途中経過・成否判定が取れない等）は同ドキュメント§4参照 |
| 複数ターゲット同時監視 | 1プロセスにつき1ターゲットルートに限定（§6.1） | 需要が出た時点で `/api/*` にターゲット識別子を持たせる設計を再検討 |
| `agent-creator`/`agent-dispatcher` の汎用テンプレート化 | ターゲットプロジェクト側でエージェントを作成・振り分けたい場合の専用版 | §5 で範囲外と明記。将来の別課題 |
| ターゲット側の `.gitignore` 指針 | `agents/state/*`（頻繁に書き換わる実行時データ）と `agents/config/rooms.json`（チームで共有したい設定）とで扱いが違う | `setup.md` 反映時に「state は無視推奨・rooms.json はコミット推奨」の指針を追記する |

---

## 9. 実装時のチェックリスト（このドキュメント確定後の着手用）

1. ✅ `server/src/index.js`: `PROJECT_ROOT` 決定ロジックを §3.1 の優先順位（`--target` > `TARGET_PROJECT_ROOT` > 既定値）に置き換え、起動ログに `target project:` 行を追加。動作確認済み（自プロジェクト固定・別ディレクトリ指定の双方で snapshot/rooms API を確認）。
2. ✅ `server/src/config/rooms.json` → `server/src/config/rooms.default.json` にリネームし、初回起動時にターゲットルートへコピーするブートストラップ処理を追加（`ROOMS_FILE` が無い場合のみコピー、既存ファイルは上書きしない）。
3. ✅ `server/src/lib/roomsStore.js`: `ROOMS_FILE` の内部ハードコードを撤去し、`init(roomsFilePath)` で外部から受け取る形に変更。
4. `server/src/lib/normalize.js`: `palette.json` の require パスはインストールルート基準のまま変更不要（§3.3 の決定通り、変更していない）。
5. ✅ `server/scripts/demo-seed.js`: `TARGET_PROJECT_ROOT`/`--target` を同様に解釈するよう変更（自分自身への書き込みをデフォルトとして後方互換維持）。
6. ✅ `docs/setup.md` を §7 の反映点に沿って更新（§5.2 に導入手順、§9 にコピー非推奨の注意、§12 に実装状況を追記）。

---

## 10. CLIパッケージ化の実装内容（§6.2の実装記録）

「どのプロジェクト下でも簡単に可視化できる」ことを優先し、npm CLIパッケージとして配布する方向（3案中、スタンドアロン実行ファイル・Electronデスクトップアプリは不採用）で実装した。

### 10.1 パッケージ構造の変更

- `server/package.json` を廃止し、`agents_app/package.json`（ルート）に統合。依存関係（express/chokidar/multer）・`node_modules` もルートへ移動。`server/src/index.js` からの `require("express")` 等は Node のモジュール解決が親ディレクトリを辿るため無変更で解決できる。
- ルート `package.json` に `"bin": { "agent-village": "./bin/agent-village.js" }` を追加。
- `"private": true` を設定（誤って `npm publish` してしまう事故を防止。実際に公開する場合は明示的に解除する）。
- `"files"` フィールドで公開対象を `bin/`, `server/src/`, `public/`, `docs/setup.md` に限定（`.claude/agents/agent-creator.md` 等の自己参照エージェントや `docs/design/` は配布物に含めない）。

### 10.2 `bin/agent-village.js`（CLIエントリーポイント）

`server/src/index.js` を直接 `require` する薄いラッパー。唯一の役割は、**`--target`/`TARGET_PROJECT_ROOT` が未指定のときのデフォルトターゲットを `process.cwd()` にすること**（`server/src/index.js` 自身のデフォルトは agents_app 自身のままで変更していない — これは `npm start` によるセルフデモ用の後方互換を壊さないための意図的な使い分け）。

```js
if (!process.env.TARGET_PROJECT_ROOT && process.argv.indexOf("--target") === -1) {
  process.env.TARGET_PROJECT_ROOT = process.cwd();
}
```

### 10.3 起動後のブラウザ自動起動

`agent-village` コマンド経由の起動では `AGENT_VILLAGE_AUTO_OPEN=1` が既定でセットされ、`server/src/index.js` の `app.listen` 成功時に OS 標準コマンド（`start`/`open`/`xdg-open`）でブラウザを自動的に開く。`npm start`（開発・セルフデモ用の生エントリーポイント）ではこの環境変数をセットしないため自動起動されない — 開発中に `npm start` を繰り返してもタブが増殖しない設計。

### 10.4 動作確認

一時的な別ディレクトリ2つを用意し、それぞれで `node bin/agent-village.js`（直接パス指定）と、`npm link` 後の `agent-village`（グローバルコマンド）の両方から起動して、`target project:` ログと `/api/snapshot` が実行ディレクトリを正しく指すことを確認した（検証用ディレクトリは削除済み）。`npm start`（ルート）でのセルフデモ後方互換も再確認済み。

### 10.5 未着手

- npm レジストリへの実際の公開（`npm publish`）。公開するとインターネット上の誰でも `npx agent-village`/`npm install -g agent-village` で取得できるようになる、後戻りしにくい対外的な行為なので、実行する場合はパッケージ名の最終確認を含め別途明示的な判断を要する。
- スタンドアロン実行ファイル化・Electronデスクトップアプリ化（今回のヒアリングで不採用と判断、§6.2直前の検討経緯を参照）。
