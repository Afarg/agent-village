# 05. Hooksによる状態自動書き込み — Agent Village Dashboard

`agents/state/*.json` を実際の Claude Code 実行と連動して自動生成する仕組みの設計。`docs/design/03-tech-recommendation.md` §5・`docs/design/04-multi-project-integration.md` §8 で意図的にスコープ外としていた残課題への対応。

対象読者: `bin/agent-village-hook.js` の実装者。
関連ドキュメント: `02-agent-state-model.md`（書き込み先スキーマ）、`04-multi-project-integration.md`（配布・CLI化）。

**実装状況**: 実装済み・実機検証済み（本ドキュメント§2の実測データ、§5の検証結果を参照）。

---

## 1. 前提: Claude Code hooksの実際のペイロード（実測）

ドキュメント記載を鵜呑みにせず、`agents_app` 自身の `.claude/settings.local.json` に検証用フックを仕込み、実際に `Agent` ツールでサブエージェントを起動して実測した（実装前に契約を決め打ちしない、という自分たちの方針を貫いた）。

### 1.1 `SubagentStart`

```json
{
  "session_id": "91298ff9-...",
  "transcript_path": "C:\\Users\\...\\<session>.jsonl",
  "cwd": "D:\\app\\agents_app",
  "prompt_id": "c3a776ee-...",
  "agent_id": "a4502c07dfad60be4",
  "agent_type": "Explore",
  "hook_event_name": "SubagentStart"
}
```

- `agent_type` は `Agent` ツール呼び出し時の `subagent_type` そのもの。カスタムエージェント（`.claude/agents/<name>.md`）の場合は `name:` フロントマターの値と一致する（`agentDefs.js` の `slugify()` を通せば `agentId` と合う）。
- `agent_id` は呼び出し1回ごとに一意（同じ `agent_type` を並行実行しても区別できる、はず — §4参照）。
- **タスクの説明文・プロンプトはここに含まれない。**

### 1.2 `SubagentStop`

```json
{
  "session_id": "91298ff9-...",
  "cwd": "D:\\app\\agents_app",
  "agent_id": "a4502c07dfad60be4",
  "agent_type": "Explore",
  "hook_event_name": "SubagentStop",
  "stop_hook_active": false,
  "agent_transcript_path": "C:\\Users\\...\\subagents\\agent-a4502c07dfad60be4.jsonl",
  "last_assistant_message": "ok"
}
```

- `last_assistant_message`: サブエージェントの最終出力テキスト。「完了」の要約に使える。
- `agent_transcript_path`: サブエージェント自身のトランスクリプトへのパス。**Stop時にしか含まれない**（Start時には無い）ため、実行中のリアルタイム進捗取得には使えない。

### 1.3 `PreToolUse`（`Agent` ツール、参考。今回は使わない）

```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "Agent",
  "tool_input": { "description": "...", "prompt": "...", "subagent_type": "Explore", "run_in_background": false }
}
```

`tool_input.description` は短いタスク名（3〜5語)で、`task.title` に使えそうな情報源だが、**`SubagentStart`と紐付けるための共通IDが無い**（`agent_id` はまだ採番されていない段階）。同じ `agent_type` を1ターンで複数回並行起動した場合に取り違えるリスクがあるため、今回は採用しない（§3.2）。

---

## 2. `.claude/settings.json` への登録方法（実測で確認済み）

```jsonc
{
  "hooks": {
    "SubagentStart": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node \"<agents_app>/bin/agent-village-hook.js\"" }] }
    ],
    "SubagentStop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node \"<agents_app>/bin/agent-village-hook.js\"" }] }
    ]
  }
}
```

- `matcher: ""` で全サブエージェント種別にマッチする（特定のエージェント名を列挙する必要はない。「どのプロジェクトでも、新しいエージェントを追加してもそのまま拾える」という導入方針(`04-multi-project-integration.md`)に合わせた）。
- 設定変更は **セッション再起動なしで即座に反映された**（同一セッション内で `settings.local.json` を書き換えた直後に `Agent` ツールを呼んだだけでフックが発火した）。ただしこれは今回検証した環境での実測結果であり、全環境で保証された挙動として文書化されているわけではない点に注意。
- コマンドは `agent-village` パッケージの絶対パスで `node "<path>/bin/agent-village-hook.js"` を直接指定する方式にした（`npm link` 済みの `agent-village-hook` というグローバルコマンド名も用意してあるが、hookの実行環境のPATHに依存させたくないため、設定ファイルには絶対パスを書く）。

---

## 3. 書き込みロジックの設計判断

### 3.1 対象ファイル

`<projectRoot>/agents/state/<slugify(agent_type)>.json`。`projectRoot` は環境変数 `CLAUDE_PROJECT_DIR`（Claude Code保証の変数）を優先し、無ければペイロードの `cwd` を使う。

### 3.2 タスクの説明文は持たせない（意図的な単純化）

§1.3の通り、`PreToolUse(Agent)` の `tool_input.description` と `SubagentStart` を紐付ける確実な手段が無い。無理に「直前の `PreToolUse` をキューに積んで `SubagentStart` でポップする」ような相関ロジックを組むと、並行実行時に別タスクの説明文を取り違える恐れがある。**「情報が少なくても常に正しい」を「情報は豊富だが時々間違う」より優先し**、`task.title` は `"<agent_type> を実行中"` という機械的な文字列に固定した。

将来、`agent_id` を `PreToolUse` 側にも含めるような仕様変更があれば、相関ロジックを追加して具体的なタスク名を出せるようにする(v2)。

### 3.3 状態遷移とファイル内容

| イベント | 書き込む内容 |
|---|---|
| `SubagentStart` | `status: "working"`, `task`（`taskId=agent_id`, `title` は§3.2の固定文言, `assignedAt`/`startedAt` は現在時刻, `progress: null`）, `log` に開始1行, `result: null` |
| `SubagentStop` | `status: "done"`, `task` はStart時のものを保持（`agents/state/<id>.json` を読み直して引き継ぐ。読めなければ `null`）, `log` に `last_assistant_message`（300文字まで切り詰め）を1行, `result: { ok: true, summary, finishedAt }` |
| Stopの5秒後 | `status: "idle"`, `task: null`, `log: []`, `result: null`（`02-agent-state-model.md` §4.2「doneの寿命」への対応） |

`result.ok` は常に `true` にしている。Stop時のペイロードに成功/失敗を示すフィールドが見当たらなかったため（`PostToolUse(Agent)` の `tool_response.status` は "completed" 固定で、ツール呼び出し自体の成否であってサブエージェントの作業結果の成否ではない）。将来、失敗を判定できるフィールドが見つかれば見直す。

### 3.4 「doneの5秒後にidleへ戻す」の実装方法

hookスクリプトのプロセス自体が5秒 `sleep` してから終了すると、その間 **Claude Code本体のターン進行がブロックされる**（hookは同期的に呼び出し元を待たせる)。これを避けるため、`SubagentStop` の処理の最後に **detachした子プロセス**（`spawn(..., { detached: true, stdio: "ignore" }); child.unref()`）を起動し、そちらで5秒待ってから idle 書き込みを行い、親（hook本体）は即座に終了する。実測で hook自体の所要時間は0.3秒程度（§5）。

### 3.5 アトミック書き込み・失敗時の扱い

`agents/state/<id>.json` は一時ファイル（`<file>.<pid>.tmp`）に書いてからリネームする（`02-agent-state-model.md` §4.1）。JSON解析失敗・書き込み失敗はすべて握りつぶして `stderr` に出すのみ（`process.exit` で異常終了させない）。可視化はあくまで補助機能であり、hookの失敗が本来のClaude Codeセッション進行を止めたり、エラーを表示させたりしてはならない。

---

## 4. 既知の限界（決め打ちしなかった/できなかった点）

| 項目 | 内容 |
|---|---|
| 実行中の進捗（ログ行）が取れない | `SubagentStart`/`SubagentStop` はライフサイクルの両端しか捕捉できない。実行中の細かい進捗（`agents/state` の `log` を複数行育てていく体験）は今回のhook方式では実現できない。サブエージェント自身が自分の作業中に進捗ファイルを書く（スキル/システムプロンプトで指示する）方式でなければ実現できない — 今回は範囲外 |
| `agent_id` の並行実行時の一意性 | ドキュメント上は「呼び出しごとに一意」とされているが、同一 `agent_type` を1ターンで複数並行起動した場合の挙動は本ドキュメントでは未検証。仮に衝突しても、状態ファイルは `agentId`（＝`agent_type` 由来）単位の1ファイルなので、**同じ種類のエージェントが同時に2つ動くと片方の状態で上書きされる**（Agent Villageの「1定義=1キャラクター」という設計上そもそも複数インスタンスを描き分けられないため、実用上大きな問題にはならない想定） |
| タスクの具体的な説明文 | §3.2の通り意図的に持たせていない。表示される `task.title` は `"<agent_type> を実行中"` の固定文言 |
| 失敗（error）状態の検出 | Stopペイロードから成否を読み取れないため、`status: "error"` に遷移させる経路は今回実装していない（常に `done` として扱う） |

---

## 5. 検証結果

| 検証内容 | 方法 | 結果 |
|---|---|---|
| 実際のClaude Code hookが本当に発火し、想定通りのフィールドを持つか | `agents_app` の `.claude/settings.local.json` に生ログ出力hookを仕込み、`Agent` ツールで実サブエージェントを起動 | ✅ §1の実測データを取得 |
| `bin/agent-village-hook.js` が正しい状態ファイルを書けるか（`SubagentStart`） | 合成JSONペイロードを標準入力から投入 | ✅ `status: working` で正しく書き込み |
| 同上（`SubagentStop`） | 合成JSONペイロードを投入 | ✅ `status: done`、`result.summary` に投入した `last_assistant_message` が反映 |
| 5秒後にidleへ自動復帰するか | `SubagentStop` 投入後、6秒待って再確認 | ✅ `status: idle` に復帰。hook自体は0.3秒程度で終了しClaude Codeのターンをブロックしない |
| 実際のhook経由（合成ペイロードでなく本物のディスパッチ）で動くか | `agents_app` 自身に実装済みのhook設定で `Explore` サブエージェントを2回実際に起動 | ✅ 実際の `last_assistant_message`（"second verification pass"）が状態ファイルに反映されるのを確認 |
| ダッシュボード（ブラウザ）までパイプラインが繋がるか | `order_app` を対象に `agent-village` を起動し、`code-reviewer` 宛の合成 `SubagentStart`/`SubagentStop` を投入しながらブラウザをスクリーンショット | ✅ キャラクターがコードレビュー部屋へ移動→「作業中」表示→完了後に休憩所へ帰還、を画面上で確認 |
| `order_app` の本物のカスタムエージェントでの実機確認 | ユーザーが `order_app` の実際のClaude Codeセッションから `code-reviewer` を呼び出し、`agent-village` の画面を並行して確認 | ✅ **2026-07-14 実機確認済み**。`agents/state/code-reviewer.json` の `taskId` が実際のClaude Code発行のもの（本検証セッションが用意した合成データではない）であることを確認した上で、画面上もコードレビュー部屋へ移動→「作業中」表示を確認 |

**注記（解消済み）**: 当初、本検証セッション自身からは `order_app` の実際のカスタムエージェント（`code-reviewer` 等）を呼び出せない制約があったため、`agent_type: "code-reviewer"` の合成ペイロードで代替検証していた。上表の通り、その後ユーザー自身が `order_app` の実セッションから `code-reviewer` を呼び出したことで、本物のディスパッチでも問題なく動作することを確認済み。
