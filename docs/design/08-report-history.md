# 08. 永続レポート履歴 — Agent Village Dashboard

全エージェントの「報告」（開始・完了・権限待ち）を横断的に一覧できる専用画面（「レポートモニター」）のための、データモデル・API・フロントエンドの設計。

対象読者: `bin/agent-village-hook.js` / `server/src/lib/reportLog.js` / `server/src/index.js` / `public/js/reports.js` の実装者。
関連: `02-agent-state-model.md`（`agents/state/*.json`の既存スキーマ、本ドキュメントが分離する`log`の全量履歴を§4.2で「v2」として既に予告していた）、`05-hooks-state-writer.md`（フックが開始・終了の両端しか捕捉できないという既存の制約）。

**実装状況**: 実装済み・実機検証済み（2026-09-14）。§9の検証をすべて実施し、実装中に見つけたバグ1件（`initTabs()`のセレクタが`#view-switcher`のボタンにも意図せず反応していた）も同日中に修正・再検証済み。

---

## 1. 背景・目的

Agent Villageを「オシャレで使いやすいAIオフィス」へ発展させる大きな方針のうち、最優先で着手した機能。ユーザーは以下を要望した:

- 全エージェント分の報告を横断的に一覧できる**専用のログ画面**（既存のオフィス画面とは独立した画面/タブ）。
- 履歴は**永続保存**（直近だけのローリングウィンドウではなく、ずっと残す）。

なお、これは4施策あるうちの1番目で、他の3施策（UI/UX刷新・20体のキャラクターアバタープール化・座り動作の追加）は今回のスコープ外。

## 2. 既存の課題

`docs/design/02-agent-state-model.md` §4.2は`agents/state/<agentId>.json`内の`log`配列を「直近N件のみ保持（推奨50件、**appendのみ**）」と明記していたが、実装（`bin/agent-village-hook.js`の`handleSubagentStart`/`handleSubagentStop`）は毎回`log`を1件配列で**上書き**しており、ドキュメントの意図と食い違っていた（バグ）。

この上書きにより、`public/js/game.js`の吹き出し表示トリガー（`nextLogLen > prevLogLen`）が常に`1 > 1`=falseとなり、**タスク完了時の報告吹き出しが表示されない**という実害があった（今回のバグ修正の副次効果として解消、§9で確認）。

同じ§4.2の決定事項表には「全量ログは将来 `agents/logs/<agentId>.ndjson` に分離（v2）」という記述が既にあり、今回の永続履歴機能はこの「v2」を実現するもの。

## 3. データモデル

2層構成にする:

| ファイル | 役割 | 保持件数 |
|---|---|---|
| `agents/state/<agentId>.json`の`log` | サイドバー・吹き出し用の「直近キャッシュ」 | 直近50件（`slice(-50)`、既存どおり） |
| `agents/logs/<agentId>.ndjson`（新規） | 永続履歴（レポートモニターのデータソース） | 無制限（削除・ローテーション無し） |

`agents/logs/<agentId>.ndjson`は1行1レポートのNDJSON形式:

```json
{"ts":"2026-07-11T04:23:11.500Z","level":"info","text":"開始しました","agentId":"code-reviewer","taskId":"a4502c07dfad60be4"}
```

- `level`は既存の`log`エントリと同じ語彙（`info`/`warn`/`error`/`result`）。フロントの`.level-*` CSSをそのまま流用する。
- `taskId`は`state.json`の`task.taskId`ではなく**`payload.agent_id`を直接使う**（Start/Stop双方のペイロードに存在し、`state.json`の読み取り失敗の影響を受けないため）。
- 行ごとの`schemaVersion`は持たない。NDJSONは「未知フィールドは無視」で前方互換とする。

## 4. フック側の変更（`bin/agent-village-hook.js`）

- `readExistingState(file)` / `appendedLog(existing, entry)` / `logFilePath(projectRoot, agentId)` / `appendNdjsonLine(file, obj)` を追加。
- `handleSubagentStart`・`handleSubagentStop`: `state.json`の`log`上書きバグを修正（既存内容を読み→追記→`slice(-50)`）。あわせて`agents/logs/<agentId>.ndjson`に1行追記。
- `handleDelayedIdle`: `log: []`のidleリセットは**現状維持**（§4.3のidleサンプルと一致する意図的な挙動。永続履歴は別ファイルにあるため矛盾しない）。
- `handlePermissionRequest`: `state.json`は現状どおり変更なし（`pendingPermission`のみ）だが、**NDJSONには`level:"warn"`で1行追記する**。フックが開始・終了の両端しか捕捉できない制約（§5-hooks-state-writer.md §4）の中で、権限待ちは唯一追加で拾える意味のあるイベントであり、コストもほぼゼロ。ノイズになる場合はフロント側のレベルフィルタで除外できる。

追記は`atomicWrite`（tmp書き込み→rename、全体置き換え専用）ではなく`fs.appendFileSync`を使う。単一ローカルマシン・低頻度書き込みの前提のためロック機構は不要と判断した。

## 5. サーバー側の変更

新規`server/src/lib/reportLog.js`（`agentState.js`と並ぶlibモジュール）:

- `loadAll(logsDir)`: 起動時に`agents/logs/*.ndjson`を全読みし、時系列順に`seq`（プロセス内限定の単調増加ID）を割り当てながらインメモリ配列`reportIndex`を構築する。
- `ingestFile(file)`: chokidarの`add`/`change`イベントから呼ばれる。ファイルごとのバイトオフセットを記憶し、**新規追記分だけ**をtail読みしてパース→`reportIndex`にpush→新規エントリ配列を返す。
- `query({agentId, levels, q, since, until, cursor, limit})`: `reportIndex`を`seq`降順（新しい順）でフィルタ・ページングする。

インメモリindexを採用したのは、SSE配信のために「新規追記分だけのtail読み」がどのみち必要になるため（その結果を保持しておけば`GET /api/reports`が再パース不要の高速フィルタになる）。この用途の想定規模（個人・中小企業向けの単一ローカルツール、数ヶ月で数千件程度）ではメモリコストも無視できる。

`server/src/index.js`側:

- `AGENTS_LOGS_DIR`を追加、起動時`mkdirSync`+`reportLog.loadAll()`。
- `agents/logs/`用の新規chokidarウォッチャー（`kind: "report-log"`、既存の`"state"`とは別 — `reloadOne`の`"state"`分岐は1ファイル=1エージェントの全体オブジェクトという前提のため、NDJSON追記ファイルには使えない）。
- `reloadOne`に`report-log`分岐を追加し、新規エントリごとに`sendEvent("report-added", { agentId, entry })`。
- 新規`GET /api/reports`: クエリ`agentId`/`level`（カンマ区切り）/`q`/`since`/`until`/`cursor`/`limit`（既定50・上限200）。レスポンス`{ reports, nextCursor, total }`。エラーは既存の慣習どおり`res.status(400).json({ error: "..." })`。

## 6. フロントエンド側の変更

- `public/index.html`: `#hud-header`内に「オフィス」「レポート」を切り替える`#view-switcher`（既存の`.tab-btn`流用）を追加。`#hud-main`の兄弟要素として新規`<section id="reports-view" hidden>`（フィルタバー・一覧・もっと読み込むボタン）を追加。サイドバー内ではなく`#hud-main`と同列に置くことで、選択時に画面全体を占有できる。
- `public/js/hud.js`: 既存`initTabs()`と同じ`hidden`属性トグルを、ページ全体スコープに拡張した`initViewSwitcher()`として新設（`#hud-main`⇔`#reports-view`）。
- `public/js/store.js`: `connectSSE()`に`report-added`リスナーを追加し中継するだけ（storeは一覧を保持しない）。
- `public/js/reports.js`（新規、`initReports()`）: フィルタ（エージェント・レベル・検索語）→`GET /api/reports`取得→一覧描画。ライブ更新は`store`の`report-added`イベントを購読し、現在のフィルタに合致すれば先頭に追加。SSE再接続時は`connection`イベントを見て自動的に再取得する（`store.init()`の再同期と同じ考え方）。行の見た目は`hud.js`の既存ログ描画（`.log-entry.level-*` + `.chip`）をそのまま流用。
- `public/js/main.js`: `store.init()`完了後・`initGame()`前に`initReports()`を呼ぶ。

## 7. 設計上の決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| `log`上書きバグの修正範囲 | `handleSubagentStart`/`handleSubagentStop`のみ修正。`handleDelayedIdle`は現状維持 | バグ報告の対象範囲どおり。idleリセットは意図的な仕様 |
| NDJSONの`taskId`の出所 | `payload.agent_id`を直接使用 | Start/Stop双方に存在し、`state.json`読み取り失敗の影響を受けない |
| `PermissionRequest`をNDJSONに書くか | 書く（`level: "warn"`、1行） | フックが両端しか捕捉できない制約の中で唯一追加で拾える意味のあるイベント、低コスト |
| NDJSON追記のI/O方式 | `fs.appendFileSync`（ロックなし） | 単一ローカルマシン・低頻度書き込み前提 |
| 履歴の保持方針 | 永続保存（ローテーション・自動削除なし） | ユーザー要望どおり |
| 一覧画面の配置 | `#hud-main`と同列の独立セクション（サイドバー内ではない） | ユーザーが「独立したページ/タブ」を希望 |
| ページング方式 | `seq`（サーバー起動時に採番する単調増加ID）によるカーソル | 同一ミリ秒の`ts`が複数件あり得るため、`ts`単独カーソルは境界で欠落/重複しうる |

## 8. 既知の限界

| 項目 | 内容 |
|---|---|
| 報告の粒度 | フックは開始・終了の両端しか捕捉できない（`05-hooks-state-writer.md` §4）。1タスクにつき基本2行（開始+完了サマリー、権限待ちがあれば+1行）のみで、作業中の逐次進捗は表示されない |
| `agentId`衝突 | 同一`agent_type`を同時に複数起動すると同じファイルに履歴が混在する（既存の「1定義=1キャラクター」設計を継承） |
| NDJSONの無制限成長 | ローテーション・自動削除は未実装。将来肥大化した場合は`agents/logs/<id>.ndjson`を手動で`.2026.ndjson`のような名前に退避すればよい（`loadAll()`はディレクトリ内の`*.ndjson`を全読みする設計のため、コード変更なしで対応可能） |
| `total`件数の計算コスト | `GET /api/reports`の`total`は毎回インメモリindexをフィルタして数える（O(件数)）。この規模では無視できるが、将来大幅に増えた場合は最初に落とす候補 |

## 9. 検証結果

| 検証内容 | 方法 | 結果 |
|---|---|---|
| ログ追記バグの修正確認 | 合成`SubagentStart`→`SubagentStop`→`SubagentStart`を`bin/agent-village-hook.js`へ標準入力投入し`log.length`の推移を確認 | ✅ 1→2→3と推移（修正前は常に1で固定）することを確認 |
| `.slice(-50)`の上限確認 | 55回連続で`SubagentStart`を投入 | ✅ `state.json`側`log.length`は50で頭打ち、`agents/logs/*.ndjson`側は55行全件残存（無制限であることを確認） |
| 永続履歴の確認（サーバー再起動含む） | 合成データ投入→サーバー停止・再起動→`GET /api/reports`で全件残存確認 | ✅ 再起動後も`total`が投入件数と一致（`loadAll()`の起動時全読み込みが正しく動作） |
| `GET /api/reports`のフィルタ・ページング | Node `fetch`で`agentId`/`level`/`q`/`cursor`/不正な`level`（400）を確認 | ✅ 全て期待通り。`cursor`によるページングは前後ページでseqの重複・欠落なしを確認 |
| `PermissionRequest`のNDJSON追記 | 合成`PermissionRequest`投入 | ✅ `level:"warn"`で1行追記されることを確認。`state.json`側は`pendingPermission`のみ更新され`log`は変化しないことも確認 |
| SSEライブ更新・画面切り替え（claude-in-chrome実機確認） | ダッシュボードで「レポート」表示中に実エージェント（`agent-creator`）へ合成Start/Stopを投入 | ✅ リロード無しで一覧先頭に2行が正しい順序・正しい表示名で追加された。「オフィス」への復帰、地図・キャラクター表示も問題なし |
| キーワード検索フィルタ | 「作成」で検索 | ✅ 完了サマリー行のみに絞り込まれることを確認 |
| 既存機能への回帰確認 | サイドバーのエージェント一覧・詳細パネル・地図表示を確認 | ⚠️ **バグを1件発見・修正**: `hud.js`の`initTabs()`が`document.querySelectorAll(".tab-btn")`と無指定だったため、新設した`#view-switcher`内の同名クラスのボタンにも反応し、「オフィス」「レポート」切り替え時にサイドバーの両タブが意図せず非表示になっていた。`#tab-bar .tab-btn`にスコープを絞って修正し、再検証で解消を確認済み |
| 完了吹き出しが出るようになる副次効果 | ブラウザで`agent-creator`のステータス遷移を目視 | ✅ 修正後、開始・完了とも吹き出し相当のログ増分が発生することを確認（§2で想定した副次効果） |

検証に使用した合成データ（`verify-test-agent`/`verify-cap-agent`/`agent-creator`宛の一時データ）はすべて削除済み。
