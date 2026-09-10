# Agent Village 運用ガイド：起動中インスタンスの確認・切り替え・停止／hooksの変更・解除

複数のプロジェクトで `agent-village` や hooks 連携を使っていると、「今動いているのはどのプロジェクト向けか」「安全に止めたり設定を変えたりするにはどうすればいいか」が分かりにくくなる。本書はその手順だけに絞ってまとめたもの。導入自体の手順は `docs/manual-install-guide.md`、詳細版は `docs/setup.md` を参照。

---

## 1. 大前提: ダッシュボード（サーバー）と実際の作業は別物

`agent-village` サーバー（ブラウザで見ている画面）を止めても、**Claude Code の実際のセッションや作業には一切影響しない**。

理由（`docs/design/05-hooks-state-writer.md`、`server/src/index.js` で確認済み）:

- 状態の書き込み（`bin/agent-village-hook.js`）は、Claude Code の hooks から都度起動される**独立した1回きりのプロセス**で、`agents/state/*.json` に直接ファイルを書く。ダッシュボードのサーバーが起動しているかどうかとは無関係に動く。
- ダッシュボードのサーバーは、その `agents/state/*.json` を**読んで表示するだけ**の存在。止めても書き込み自体は止まらない。
- サーバーを再起動すると、起動時に `agents/state/*.json` を**その時点の内容で全件読み直す**（`server/src/index.js` の `readAllStates`）。停止していた間の変化も、再起動すれば正しく反映される。取りこぼしはない。

→ **「動いているか分からないから怖くて触れない」と思う必要はない。** 遠慮なく確認・停止・再起動してよい。

---

## 2. 今どんな `agent-village` が動いているか確認する

### 2.1 どのポートが使われているか

```powershell
netstat -ano | findstr LISTENING | findstr "4173 4174 4175 4176"
# ポートを絞らず全部見る場合
netstat -ano | findstr "agent-village"   # ヒットしないことが多いので下記のPID照合が確実
```

`LISTENING` の行の右端がPID。`agent-village` は既定でポート**4173**を使う（`PORT` 環境変数で変更可能、`docs/setup.md` §5.1）。

### 2.2 そのPIDが本当に `agent-village` か確認する

```powershell
powershell -Command "Get-CimInstance Win32_Process -Filter \"ProcessId=<PID>\" | Select-Object ProcessId,CommandLine | Format-List"
```

`CommandLine` に `agent-village.js`（または `server/src/index.js`）が含まれていれば該当プロセス。

### 2.3 どのプロジェクトを監視しているか確認する（要注意・限界あり）

**もっとも確実なのは、そのプロセスを起動したターミナルのログを見ること。** 起動直後に以下が出力されている:

```
Agent Village server listening on http://localhost:4173
  target project:      D:\work\other-project
  ...
```

ターミナルが残っていない/見えない場合、Windowsの標準コマンドだけでは他プロセスの作業ディレクトリを直接取得できない（`Win32_Process` に作業ディレクトリの項目はない）。その場合の代替手段:

- ブラウザでそのポートを開き、**サイドバーのエージェント名・部屋名から推測する**（例: `animation-builder` のような名前が並んでいれば、アニメーション系プロジェクトだと分かる）。
- プロジェクトごとにポート番号を固定する運用にしておく（例: `order_app` は4174、別プロジェクトは4175、など）と、以後この確認作業自体が不要になる。**複数プロジェクトを扱うなら、最初からこのルールを決めておくことを推奨。**

---

## 3. 複数プロジェクトを同時に監視する（ポートを分ける）

1プロセス＝1ターゲットプロジェクトなので、複数見たい場合はポートを変えて別プロセスとして起動する（`docs/setup.md` §5.1）。

```powershell
# プロジェクトA（既定ポート 4173）
cd D:\work\project-a
agent-village

# プロジェクトB（ポートを変えて別プロセスとして起動。別ターミナルで）
cd D:\work\project-b
$env:PORT=4174; agent-village
```

既存のプロセスを止めずに新しいプロジェクトを見たいだけなら、**既存プロセスには触れず、空いているポートで新しく起動すればよい**（今回のように「動いているのは自分が今見たいプロジェクトかどうか分からない」状況を避けられる）。

---

## 4. 起動中のインスタンスを安全に停止する

### 4.1 起動したターミナルが分かる場合（推奨）

そのターミナルで `Ctrl+C`。もっとも安全でクリーン。

### 4.2 ターミナルが無い/バックグラウンド化されている場合

§2で対象プロセスのPIDを確認したうえで、

```powershell
powershell -Command "Stop-Process -Id <PID> -Force"
```

**§1の通り、これは「ダッシュボードの画面」を止めるだけ**なので、対象プロジェクトの実際のClaude Codeセッションやhooksによる状態書き込みには影響しない。安心して実行してよい。

### 4.3 再起動したいだけの場合

止めてから、同じ手順（`agent-village` を対象プロジェクトのディレクトリで実行、または `--target` 指定）でもう一度起動するだけでよい。コード変更（`agents_app` 側の `server/`・`bin/` を編集した場合など）を反映させたいときは、この停止→再起動が必要（フロントエンドの `public/js/*.js` は静的ファイルなので、ブラウザの再読み込みだけで新しい内容が反映されるが、`server/` 側のロジックはプロセスの再起動が必要）。

---

## 5. hooksの設定を変更する・解除する

対象は `.claude/settings.json`（チーム共有）または `.claude/settings.local.json`（自分のマシンのみ）の `hooks` キー（`docs/setup.md` §10、`docs/manual-install-guide.md` §5）。

### 5.1 現在の設定を確認する

```powershell
node -e "console.log(JSON.stringify(JSON.parse(require('fs').readFileSync('.claude/settings.local.json','utf8')).hooks, null, 2))"
```

### 5.2 一部の連携だけ止める（例: 権限待ち吹き出し機能だけ切る）

`hooks.PermissionRequest` のキーだけを削除し、`SubagentStart`/`SubagentStop` は残す。他の連携（開始/終了に応じたキャラクター移動）は動き続ける。

```jsonc
{
  "hooks": {
    "SubagentStart": [ /* そのまま残す */ ],
    "SubagentStop": [ /* そのまま残す */ ]
    // "PermissionRequest": [ ... ]  ← このキーを削除するだけ
  }
}
```

### 5.3 連携を完全に解除する

`hooks` オブジェクトの中身（`SubagentStart`/`SubagentStop`/`PermissionRequest`）をすべて削除する。`hooks` キーの中に他の（Agent Village と無関係な）フックが同居している場合は、それらは残し、Agent Village 関連のキーだけを消すこと。

解除しても既存の `agents/state/*.json` は残る（次にhookが発火しなくなるだけ）。キャラクターの状態を完全にリセットしたい場合は、対象プロジェクトの `agents/state/*.json` を削除してよい（自動生成物であり、プロジェクトのコードには影響しない）。

```powershell
Remove-Item "agents\state\*.json"
```

### 5.4 設定ファイルが壊れていないか確認する

編集後は必ず構文チェックする（`docs/manual-install-guide.md` §8のトラブルシューティングでも案内されている手順）。

```powershell
node -e "JSON.parse(require('fs').readFileSync('.claude/settings.local.json','utf8')); console.log('OK')"
```

---

## 6. クイックリファレンス

| やりたいこと | すること |
|---|---|
| 今動いているのが自分のプロジェクトか分からない | §2。分からなければ止めずに別ポートで新規起動（§3）が最も安全 |
| 別プロジェクト用に動いているものを止めたい | §4。ダッシュボードを止めるだけなので実作業への影響はない（§1） |
| 権限待ち吹き出し機能だけ止めたい | §5.2（`PermissionRequest` キーだけ削除） |
| hooks連携を全部やめたい | §5.3 |
| `agents_app` 側のコードを変更したので反映させたい | §4で一度止めて、再起動（§4.3） |
| 複数プロジェクトを同時に見たい | §3（ポートを分けて別プロセス） |

---

## 7. 関連ドキュメント

| ドキュメント | 内容 |
|---|---|
| `docs/manual-install-guide.md` | 導入だけに絞った簡潔ガイド |
| `docs/setup.md` | 導入・起動・トラブルシューティングの詳細版 |
| `docs/design/05-hooks-state-writer.md` | hooks連携の設計・実測データ |
| `docs/design/06-permission-wait-bubble.md` | `PermissionRequest` hookによる権限待ち表示機能の設計 |
