# Agent Village 手動導入ガイド

npm レジストリへの一般公開は現状行わない前提で、手元のマシン上で他プロジェクトに手動導入するための手順をまとめたもの。詳細な設計背景は `docs/setup.md` と `docs/design/` 配下を参照。本書は「今すぐ何をすればいいか」だけに絞った版。

---

## 1. これは何か

Claude Code のサブエージェント（`.claude/agents/*.md`）を、ブラウザ上でドット絵キャラクターとして可視化するローカルダッシュボード。`agent-village` という1個のコマンドとして、**どのプロジェクトのフォルダでも実行でき、実行したフォルダを自動的に監視対象にする。** Claude Code の hooks 機能と連携させれば、実際にサブエージェントが動く/終わるタイミングでキャラクターも自動的に動く。

ツール本体（このリポジトリ、`agents_app`）はマシンに1つだけ置いておけばよい。導入先のプロジェクト側には何もコピーしない。

---

## 2. 前提条件

| 項目 | 要件 |
|---|---|
| Node.js | 18以上（動作確認は v26.5.0） |
| npm | Node.js に同梱のもので可 |
| ブラウザ | Chrome / Edge 等（初回表示のみインターネット接続が必要） |
| OS | Windows / macOS / Linux |

---

## 3. 初回セットアップ（このマシンで1回だけ）

```powershell
# agents_app の場所に移動する（既にクローン・配置済みの前提）
cd D:\app\agents_app

# 依存パッケージをインストール
npm install

# このマシン全体で `agent-village` コマンドを使えるようにする
npm link
```

確認方法:

```powershell
agent-village --help  # のようなエラーにならず、コマンドとして認識されればOK
```

不要になったら `npm unlink -g agent-village` で解除できる。`agents_app` 自体を編集すれば `agent-village` コマンドの動作もそのまま追従する（`npm link` は実体へのシンボリックリンクのため）。

---

## 4. プロジェクトへの導入手順（プロジェクトごとに行うこと）

### 4.1 ダッシュボードを起動する

**「プロジェクトのルートフォルダ」とは、`.claude` フォルダを直接の子に持つ場所のこと。** `.claude` フォルダの中や、後述の `agents` フォルダ（自動生成物）の中ではない。

```
D:\path\to\target-project\   ← ここで `agent-village` を実行する（○）
├─ .claude\
│   └─ agents\                ← ここではない（✕）
├─ agents\                     ← ここでもない（✕。初回起動前は存在しない自動生成フォルダ）
└─ （プロジェクト本体のコード）
```

```powershell
# 導入したいプロジェクトのルートフォルダに移動する（.claude フォルダがある場所）
cd D:\path\to\target-project

# 起動（実行したフォルダを自動的に監視対象にする）
agent-village
```

自動的にブラウザが開く。ターミナルのログで `target project:` が意図したプロジェクトになっているか必ず確認する。

```
Agent Village server listening on http://localhost:4173
  target project:      D:\path\to\target-project
  watching definitions: D:\path\to\target-project\.claude\agents
  watching state:       D:\path\to\target-project\agents\state
  watching assets:      D:\path\to\target-project\assets\custom\characters, ...\assets\custom\rooms
  rooms config:         D:\path\to\target-project\agents\config\rooms.json (created from template)
  agents loaded:        N (...)
```

止めるときはターミナルで `Ctrl+C`。

初回起動時、対象プロジェクト側に以下が自動生成される（既存のコードには影響しない）。

| 生成物 | 内容 |
|---|---|
| `agents/state/` | 実行時状態の置き場（最初は空） |
| `agents/config/rooms.json` | 部屋設定（テンプレートから自動コピー） |
| `assets/custom/characters/`, `assets/custom/rooms/` | 差し替え画像の置き場（最初は空） |

### 4.2 よく使うオプション

```powershell
# ポートを変える（他アプリと衝突する場合）
$env:PORT=5000; agent-village

# ブラウザを自動で開かせない
$env:AGENT_VILLAGE_AUTO_OPEN="0"; agent-village

# カレントディレクトリではなく別のパスを明示的に指定する
agent-village --target "D:\other\project"
```

---

## 5. Claude Code実行と自動連動させる（hooks。推奨）

これを設定しないと、ダッシュボードは「誰がいるか」の一覧表示にしかならず、実際にエージェントが動いてもキャラクターは動かない。設定すると、実際のサブエージェント実行に連動してキャラクターが自動で動く。

対象プロジェクトの `.claude/settings.local.json`（自分のマシンだけでよい場合）、または `.claude/settings.json`（チームで共有したい場合）に以下を追記する。

```jsonc
{
  "hooks": {
    "SubagentStart": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node \"D:/app/agents_app/bin/agent-village-hook.js\"" }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node \"D:/app/agents_app/bin/agent-village-hook.js\"" }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "",
        "hooks": [
          { "type": "command", "command": "node \"D:/app/agents_app/bin/agent-village-hook.js\"" }
        ]
      }
    ]
  }
}
```

- `command` 内のパスは `agents_app` を実際に置いた場所の絶対パスに置き換える。
- `matcher: ""` はすべてのサブエージェント種別にマッチする設定。対象プロジェクトに新しいエージェントを追加しても、設定を変えずにそのまま拾われる。
- ファイルに既に `hooks` キーが存在する場合は、`SubagentStart`/`SubagentStop`/`PermissionRequest` の配列に追記する（既存の他のフックを上書きしないよう注意）。既に `permissions` 等の他のキーがある場合は、そのオブジェクトの兄弟キーとして `"hooks": { ... }` を追加すればよい。
- `PermissionRequest` はサブエージェントがツールの実行許可待ちで止まっている間、キャラクターの頭上に「許可を待っています」の吹き出しを出す機能（`docs/design/06-permission-wait-bubble.md`）に使う。`SubagentStart`/`SubagentStop` だけ設定して `PermissionRequest` を省略しても他の機能に影響はない（吹き出しが出ないだけ）。

設定後、Claude Code のセッションでサブエージェントを実行すると、開始時に「作業中」、終了時に完了演出→5秒後に自動的に「休憩所」へ戻る。**`order_app` で実際に `code-reviewer` を呼び出し、この一連の流れが本番同様に動くことを実機確認済み（2026-07-14）。**

### できること / できないこと

| 項目 | 内容 |
|---|---|
| いつ動いたか | ✅ 正確に反映される |
| 完了時の要約 | ✅ サブエージェントの最終出力がそのまま表示される |
| 権限待ちの通知 | ✅ サブエージェントのツール実行が許可待ちになると、キャラ頭上の吹き出しと一覧の点滅ドット/ドロップダウンで分かる（`PermissionRequest` 未設定時は非対応） |
| 何をしていたか（具体的なタスク内容） | ❌ 取れない。画面上は `"<エージェント名> を実行中"` の固定表示（並行実行時の取り違えを避けるための意図的な単純化） |
| 途中経過（作業中にログが複数行増えていく演出） | ❌ 取れない。開始と終了の2点のみ |
| 成功/失敗の判定 | ❌ 取れない。常に成功として扱われる |

---

## 6. 画面の見方・カスタマイズ

- 待機中のエージェントは中央の「休憩所」。実行中は役割に応じた部屋に移動し「作業中」と表示される。
- 右サイドバーの「エージェント」タブ・「部屋」タブから、サーバー再起動不要で名前変更・見た目の差し替え（PNG画像）・部屋の追加/削除ができる。
- `.claude/agents/*.md` に `room:` フィールドを追加すると、部屋の自動判定（`name`/`description` のキーワード一致）を上書きして明示的に部屋を固定できる。

---

## 7. 既知の注意点

| 注意点 | 内容 |
|---|---|
| 部屋の自動判定はキーワードの**部分一致** | 例: エージェント名 `quick-task` は文字列に `ui` を含むため「デザイン部屋」のキーワード `ui` に誤って一致することがある。動作に支障はないが、気になる場合は `room:` フィールドで明示指定する |
| 同じエージェントを並行実行すると片方の表示で上書きされる | ダッシュボードは「1定義=1キャラクター」の設計のため、同一エージェントの複数同時実行は区別して描き分けられない |
| タスクの具体的な内容・途中経過・成否判定は表示されない | §5参照。hooksの通知だけでは取得できない情報のため |
| 権限待ちの通知が手動拒否後も残ることがある | ユーザーがターミナルで手動拒否した場合、そのサブエージェントが次のツール呼び出しや終了に至るまで「許可を待っています」表示が残ることがある（`docs/design/06-permission-wait-bubble.md` §7・§11） |

---

## 8. トラブルシューティング

| 症状 | 確認事項 |
|---|---|
| `agent-village` コマンドが見つからない | `npm link`（§3）を実行したか確認。ターミナルを開き直すと直ることもある |
| `EADDRINUSE` で起動しない | 既に別プロセスがポート4173を使用している。`$env:PORT=5000; agent-village` で回避するか既存プロセスを終了する |
| `target project:` が意図したプロジェクトになっていない | `cd` してから `agent-village` を実行しているか確認。明示指定したい場合は `--target` を使う |
| エージェントが画面に出ない | `.claude/agents/*.md` の frontmatter に `name:` があるか確認。ターミナルに `[agentDefs] failed to parse ...` が出ていないか確認 |
| hooksを設定してもキャラクターが動かない | `.claude/settings.local.json`/`settings.json` の `command` に書いたパスが実在するか確認。JSONとして壊れていないか（`node -e "JSON.parse(require('fs').readFileSync('.claude/settings.local.json','utf8'))"` で検証可能） |
| 画像アップロードが失敗する | PNG形式か、サイズ制限（キャラ: 正方形16〜128px・300KB以下、部屋: 16〜1024px・800KB以下）を超えていないか確認 |
| ブラウザが真っ白 | インターネット接続を確認（Phaser 3 を CDN から読み込むため） |

---

## 9. 詳細・設計背景（もっと詳しく知りたい場合）

| ドキュメント | 内容 |
|---|---|
| `docs/setup.md` | 全オプション・全セクションを含む詳細版セットアップ手順 |
| `docs/operations-guide.md` | 起動中インスタンスの確認・複数プロジェクトの切り替え・安全な停止、hooks設定の変更/解除の手順 |
| `docs/design/02-agent-state-model.md` | `agents/state/*.json` のスキーマ詳細 |
| `docs/design/04-multi-project-integration.md` | 他プロジェクト対応・CLIパッケージ化の設計 |
| `docs/design/05-hooks-state-writer.md` | hooks連携の設計・実測データ・既知の限界の詳細 |
