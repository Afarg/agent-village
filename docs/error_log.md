# エラーログ

セッション中に発生したエラー・不具合と、その原因・改善方法を継続的に追記していくファイル
（`CLAUDE.md`「エラーログの記録」恒久ルール・2026-09-10確定、2026-09-14から実運用開始）。
症状・原因・対処・教訓を簡潔に記録する。新しいエラーのたびに追記し、別ファイルは作らない。

---

## 2026-09-14: `.tab-btn`クラス共有によるサイドバー消失バグ

**症状**: レポートモニター機能（`docs/design/08-report-history.md`）の実装で、ヘッダーに
「オフィス」/「レポート」を切り替える`#view-switcher`を追加したところ、ブラウザ実機確認で
どちらのボタンをクリックしてもサイドバーの「エージェント一覧」「部屋」タブの中身が両方とも
消えてしまう不具合が発生した。

**原因**: `#view-switcher`のボタンに、見た目を流用する目的で既存の`.tab-btn`クラスをそのまま
付けた。ところが`public/js/hud.js`の`initTabs()`は`document.querySelectorAll(".tab-btn")`と
**スコープを絞らずに**クリックハンドラを登録していたため、新設した`#view-switcher`内のボタンにも
このハンドラが二重に付いてしまった。`initTabs()`のハンドラは`btn.dataset.tab`（`"agents"`/`"rooms"`）
を見て`#tab-agents`/`#tab-rooms`の`hidden`を切り替える実装だが、`#view-switcher`のボタンは
`data-tab`を持たず`data-view`しか持たないため、`btn.dataset.tab`が`undefined`になり、
`undefined !== "agents"`・`undefined !== "rooms"`がどちらも`true`と評価され、**両方の
タブパネルが同時に非表示になっていた**。

**対処**: `initTabs()`内のセレクタを`document.querySelectorAll("#tab-bar .tab-btn")`に変更し、
サイドバーのタブバー内のボタンだけにスコープを限定した。修正後、ブラウザで「オフィス」⇔
「レポート」を繰り返し切り替えてもサイドバーの中身が保持されることを確認済み。

**教訓**: 既存のCSSクラス（特に汎用的な名前の`.tab-btn`のようなもの）を「見た目の流用」目的で
別の要素に付ける際は、そのクラス名を**JS側が`querySelectorAll`等でスコープを絞らずに拾っていないか**
を事前に確認すること。CSS上は問題なく見えても、JSのイベントハンドラ登録が意図せず二重に付く形の
不具合は静的なコードレビューだけでは気づきにくく、実際にブラウザで操作して初めて発見できた
（`docs/design/08-report-history.md` §9の実機検証プロセスがなければ、コミット後に気づいていた
可能性が高い）。

---

## 2026-09-30: 新レイアウトの寸法情報を`/api/rooms`が返しておらず、オフィスが真っ黒になった

**症状**: フェーズ②の2-2（オフィス描画）の初回実機確認で、マップ部分が黒一色になった。コンソールには
`Cannot destructure property 'headerH' of 'this.roomsConfig.metrics' as it is undefined`。

**原因**: `server/src/lib/layout.js`の`computeLayout()`に`metrics`（名札帯・壁の高さ）を追加したが、
`server/src/index.js`の`roomsWithAssets()`は返す項目を**1つずつ列挙して組み立てている**ため、
新しい項目が自動では配信されなかった。

**対処**: `roomsWithAssets()`に`metrics: computed.metrics`を追加した。

**教訓**: `computeLayout()`の戻り値に項目を足すときは、`roomsWithAssets()`の列挙にも足すこと。
また、**Node.jsのサーバーコードを変えた場合、起動中のサーバー（4173番）は再起動するまで古い
APIを返し続ける**。一方で`public/`の画面側ファイルは即座に新しいものが配信されるため、「新しい画面＋古いAPI」
の組み合わせで壊れる。サーバー側の変更を含む作業のあとは、ダッシュボードの再起動が必要。

## 2026-09-30: claude-in-chromeのタブが「非表示」扱いで、Phaserの描画が止まり動作確認できなかった

**症状**: claude-in-chromeで開いたタブでは、状態ファイルを書き換えても、キャラクターが一切動かず
スクリーンショットも変化しなかった。

**原因**: 操作用のChromeウィンドウが背面にあり、`document.hidden === true`になっていた。
そのため`requestAnimationFrame`が0回/秒に止まり、Phaserのゲームループ・トゥイーン・タイマーも
すべて停止していた。ウィンドウのリサイズやページ内クリックでは解除されなかった。
静止画の確認はできるが、移動・アニメーションの確認には使えない。

**対処**: Chrome本体を`--headless=new --remote-debugging-port`で起動し、Node標準の`WebSocket`で
DevTools Protocolを直接操作する小さなスクリプトで検証した（playwright/puppeteerは未導入）。
ヘッドレスではページが常に「表示中」扱いのため、アニメーションが進む。
あわせて、`?debug`付きURLのときだけ`window.__villageScene`を公開するようにし、キャラの座標・
描画順（depth）を数値で確認できるようにした。

**教訓**: Phaserの動き（歩行・吹き出し・状態遷移）を検証するときは、`document.hidden`を最初に確認する。
非表示ならclaude-in-chromeでは検証できないので、ヘッドレスChromeを使う。
