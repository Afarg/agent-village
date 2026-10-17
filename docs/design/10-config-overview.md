# 10. 「構成」画面（プロジェクトの Claude Code 設定の一覧・読み取り専用）

- ステータス: **実装済み・検証済み（2026-10-17）**
- 位置づけ: フェーズ②の 2-5（`09-ai-office-redesign.md` §10）。
- 関連: `11-project-switcher.md`（接続先のプロジェクト。構成画面はいま接続しているプロジェクトを表示する）、`05-hooks-state-writer.md`（Agent Village のフック）

## 1. 目的

接続しているプロジェクトに、Claude Code の何が設定されているかを、1つの画面で見られるようにする。
これまでは `.claude` の中のファイルを1つずつ開かないと分からなかった。

- 対象: エージェント・スキル・コマンド・MCP サーバー・プラグイン・フック・権限・環境変数・CLAUDE.md
- **読み取り専用**から始める（2026-10-16 ユーザー決定）。編集は、必要になってから別の段階で考える。

## 2. 方針

| 論点 | 決定 | 理由 |
|---|---|---|
| 読むファイルの範囲 | **プロジェクトのフォルダの中だけ**（§3） | ユーザー全体の設定（`~/.claude.json`、`~/.claude/` など）には、認証情報が入っていることがある。ダッシュボードのサーバーにホームフォルダを読ませないほうが安全。ユーザー全体の設定の表示は §8 の未確定事項 |
| 秘密情報 | **値をサーバーの外に出さない**（§5） | MCP の `env`・`headers` や settings の `env` には、APIキーがそのまま書かれることが多い。伏せる処理はサーバー側で行い、ブラウザには伏せた後の文字列しか送らない |
| 読み込むタイミング | 画面を開いたとき・「再読み込み」ボタン・プロジェクト切り替え後 | 設定ファイルが変わることは少ない。ファイル監視を増やすほどの必要はない |
| 置き場所 | ヘッダーの表示切り替えに「構成」を足す（オフィス／レポート／構成） | レポート画面と同じく、サイドバーに押し込まず全幅で見せる |
| 読めないファイル | 画面の「読み込んだファイル」欄に理由つきで表示し、他の項目は表示を続ける | JSON の書き間違い1つで画面全体が出なくなるのを防ぐ |

## 3. 読むファイル

すべて接続先のプロジェクトのフォルダ（`TARGET_ROOT`）からの相対パス。

| 項目 | ファイル | 読む内容 |
|---|---|---|
| エージェント | `.claude/agents/*.md` | `name`・`description`・`tools`・`model`（既存の `agentDefs.js` を使う） |
| スキル | `.claude/skills/<名前>/SKILL.md` | 前付け（frontmatter）の `name`・`description`、フォルダ内のファイル数 |
| コマンド | `.claude/commands/**/*.md` | 前付けの `description`・`argument-hint`。サブフォルダは `/フォルダ:名前` の形で表示する |
| MCP サーバー | `.mcp.json` | `mcpServers` の各項目（種類・コマンドと引数・URL・`env` と `headers` のキー名） |
| フック・権限・プラグイン・環境変数 | `.claude/settings.json`、`.claude/settings.local.json` | `hooks`、`permissions`（`allow`・`ask`・`deny`・`defaultMode`・`additionalDirectories`）、`enabledPlugins`・`extraKnownMarketplaces`、`env`、`enableAllProjectMcpServers`・`enabledMcpjsonServers`・`disabledMcpjsonServers` |
| メモリ | `CLAUDE.md`、`.claude/CLAUDE.md`、`CLAUDE.local.md` | あるかどうかと行数だけ（中身は送らない） |

- 2つの settings ファイルの項目は、どちらのファイルに書かれていたかを付けて並べる（上書きの計算はしない）。Claude Code の実際の優先順位は「local が project より強い」。画面には出典を表示するだけにする。
- `.mcp.json` のサーバーには、settings の許可設定から「有効／無効／未承認」を付ける。
  - `disabledMcpjsonServers` にある → 無効
  - `enabledMcpjsonServers` にある、または `enableAllProjectMcpServers: true` → 有効
  - どれにもない → 未承認（Claude Code の起動時に確認が出る）
- Agent Village 自身のフック（コマンドに `agent-village-hook` を含むもの）には印を付ける。

## 4. API

`GET /api/config` → 次の形の JSON を返す。リクエストのたびにファイルを読み直す。

```json
{
  "root": "D:\\app\\my_project",
  "generatedAt": "2026-10-17T...",
  "agents":   [{ "name", "file", "description", "tools", "model" }],
  "skills":   [{ "name", "dir", "description", "fileCount" }],
  "commands": [{ "name": "/ns:cmd", "file", "description", "argumentHint" }],
  "mcpServers": [{ "name", "type", "command", "args", "url", "envKeys", "headerKeys", "status" }],
  "plugins":  [{ "id", "enabled", "source" }],
  "marketplaces": [{ "name", "detail", "source" }],
  "hooks":    [{ "event", "matcher", "type", "command", "timeout", "source", "agentVillage" }],
  "permissions": { "allow": [{ "rule", "source" }], "ask": [...], "deny": [...], "defaultMode": [{ "value", "source" }], "additionalDirectories": [...] },
  "env":      [{ "key", "value", "source" }],
  "memory":   [{ "file", "lines" }],
  "sources":  [{ "file", "status": "ok|missing|error", "error" }]
}
```

- 説明文（`description`）は、エージェントの定義によくある `<example>` ブロックを除き、最大300文字に切る。
- 実装: `server/src/lib/configOverview.js`（新規）、`server/src/lib/secretMask.js`（新規）

## 5. 秘密情報の伏せ方（`secretMask.js`）

伏せた部分は `•••` に置き換える。

1. **値を一切送らないもの**: MCP の `env`・`headers` と settings の `env`。キー名と「設定あり」だけを返す。
   例外として、値が `${VAR}` の形（環境変数の参照）だけのときは、秘密ではないのでそのまま表示する。
2. **文字列の中の秘密らしい部分を伏せるもの**: MCP のコマンド・引数・URL、フックのコマンド、権限のルール、マーケットプレイスの取得元。
   - URL の `ユーザー:パスワード@`
   - URL のクエリのうち、名前に key / token / secret / password / auth / sig / credential を含むもの
   - `Bearer xxx`・`Basic xxx`
   - `--api-key=xxx`・`TOKEN=xxx`・`"password": "xxx"` のような「秘密らしい名前＋値」の組
   - 引数の配列で `--token` のような名前の次に来る値
   - よく知られた形のトークン（`sk-`、`sk-ant-`、`ghp_`・`github_pat_` など GitHub、`xox?-`（Slack）、`AKIA…`（AWS）、`AIza…`（Google）、`glpat-`（GitLab））
   - 英大文字・小文字・数字が混ざった32文字以上の連続（区切りのない長いランダム文字列）
3. 伏せ方は「秘密らしい形」を探す方式なので、**秘密に見えない普通の単語**（例: `mcp__abc123` のような名前の一部）までは伏せられない。値そのものを確実に隠したい場合は `env`・`headers` に書き、`${VAR}` で参照するのが安全（この画面では値を一切送らない）。
4. 伏せ漏れを防ぐため、**検証では既知の秘密の文字列を仕込んだ設定ファイルを読ませ、API の応答全体にその文字列が1つも含まれないこと**を確認する（§7）。

## 6. 画面

- ヘッダーの「構成」で開く。上部に、項目ごとの件数を並べた要約（エージェント 13・スキル 3 …）と「再読み込み」ボタン、接続先のパス。
- 要約の件数をクリックすると、その項目の欄まで移動する。
- 項目ごとにカード。
  - エージェント・スキル・コマンド: 名前と説明の一覧（説明は2行まで表示し、クリックで全文）
  - MCP: 名前・種類・状態（有効／無効／未承認）・コマンドまたは URL・env／headers のキー名
  - フック: イベントごとにまとめ、マッチャー・コマンド・出典。Agent Village のフックには印。1件もなければ「作業状態を表示するにはフックの設定が必要」と案内する
  - 権限: 許可／確認／拒否の3列。件数が多いので、それぞれ折りたたみ（10件を超えると最初は閉じる）
  - プラグイン・環境変数・メモリ: 簡単な一覧
- 何もない項目は「設定なし」と表示する（欄自体は消さない。何が無いかも情報になるため）。
- 最下部に「読み込んだファイル」（ある／ない／読めない＋理由）と、「秘密情報は伏せて表示しています」の注記。
- 実装: `public/js/config.js`（新規）、`index.html`、`hud.js`（表示切り替えを3つに一般化）、`style.css`

## 7. 検証（2026-10-17）

`docs/context_logs/2026-10-16_tests/test_config.js`。隔離したサーバー（ポート4178）と、スクラッチに作った設定入りのプロジェクトで確認する。実運用中の 4173番には触れない。結果は §7.1 に記録する。

- API: 各項目の件数と内容、出典、MCP の状態3種、コマンドの名前空間、`<example>` の除去
- 伏せ方: 仕込んだ秘密（20種以上）が応答全体に1つも出ないこと。伏せてはいけないもの（普通のパス・ツール名・`${VAR}`）がそのまま出ること
- 壊れたファイル: settings.json が不正な JSON → その旨を表示し、他の項目は出る
- 設定のないプロジェクト: すべて「設定なし」で、エラーにならない
- 画面: 3つの表示の切り替え、件数クリックでの移動、折りたたみ、1024 / 1280 / 1600 幅ではみ出さないこと、JSエラーなし
- 切り替え: プロジェクトを切り替えると、その構成が表示される
- 数回続けて実行して、毎回合格すること

### 7.1 結果

ポート4178の隔離サーバーで `test_config.js` を**3回続けて実行し、毎回54項目すべて合格**した。

| 観点 | 結果 |
|---|---|
| API の内容 | エージェント（`<example>` の除去・300文字で切る・ツール未指定は「すべて」）、スキル（`SKILL.md` のないフォルダは除外、`>` の複数行の説明）、コマンド（`/deploy`・`/git:push`・前付けなし）、MCP 4種（stdio / http / sse、状態は有効・無効・未承認）、フック3件（Agent Village の印、マッチャー、タイムアウト）、権限（2ファイルの合計で許可17件、出典つき）、プラグイン・マーケットプレイス・環境変数・CLAUDE.md の行数 |
| 伏せ方 | 仕込んだ秘密22種が、API の応答にも画面の HTML にも1つも出ない。`npm test`・`gh auth login`・`${GITHUB_TOKEN}`・普通のパス・ホスト名はそのまま |
| 壊れたファイル | 不正な JSON の settings.json と、配列の .mcp.json を「読めない」＋理由で表示。エージェントは表示され、500 にはならない |
| 設定のないプロジェクト | すべての欄が「設定なし」。フックの欄に設定の案内 |
| 画面 | 3つの表示の切り替え、件数クリックでのスクロール、説明の2行表示とクリックでの全文表示、10件を超える権限の欄は閉じる、表示し直したときと「再読み込み」でファイルを読み直す、1024 / 1280 / 1600 幅ではみ出さない、JS エラーなし |
| 切り替え | 別のプロジェクトに切り替えると、そのプロジェクトの構成が表示される |

表示切り替えを3つに一般化したため（`hud.js`）、`test_24.js`（4回）と `test_projects.js`（2回）も続けて実行し、すべて合格した。

**テスト側で直したもの**（製品の不具合ではない）:
- フックの件数の期待値の誤り（仕込んだのは3件）。
- 一番下の行のカードへの移動は、それ以上スクロールできないため、「末尾まで移動して、カードが画面内に見えている」ことを合格の条件にした。
- 秘密に見えない普通の単語をマッチャーに仕込んでいた。伏せ方の仕様の範囲外なので外し、§5 の3に限界として明記した。

## 8. 未確定事項

- ユーザー全体の設定（`~/.claude/settings.json`、`~/.claude.json` の MCP、`~/.claude/agents` など）も表示するか。表示する場合は、同じ伏せ方を通したうえで、ユーザーの了承を得てから読む。
- 編集機能（権限の追加・削除など）を付けるか。
- 「Claude Code が実際に使う最終的な設定」（ユーザー・プロジェクト・ローカルの重ね合わせ）を計算して見せるか。
