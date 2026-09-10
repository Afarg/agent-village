# Agent Village

Claude Code のサブエージェント群を、ピクセルアート風の「村（オフィス）」でキャラクターとして可視化するローカルダッシュボード。`.claude/agents/*.md`（サブエージェント定義）と `agents/state/*.json`（実行時の状態、Claude Code の hooks から書き込まれる）を読み取り、各エージェントを1体のドット絵キャラクターとしてブラウザ上にリアルタイム表示する。

> A local dashboard that visualizes Claude Code sub-agents as pixel-art characters wandering a Game Boy–style "village". It watches each agent's live state (written via Claude Code hooks) and streams updates to the browser over SSE. Idle agents wait in a break room; working agents occupy a role-appropriate room, with progress logs shown as chat bubbles.

## 特徴

- **エージェント = キャラクター**: 待機中は休憩所に、作業中は役職に応じた部屋に配置され、進捗ログをチャット吹き出しで表示する。
- **リアルタイム更新**: Node.js のローカルサーバーがファイル（`.claude/agents/`・`agents/state/`）を [chokidar](https://github.com/paulmillr/chokidar) で監視し、Server-Sent Events でブラウザへ配信する。
- **Claude Code hooks 連携**: `SubagentStart` / `SubagentStop` / `PermissionRequest` の各 hook から状態ファイルを書き込むことで、実際のサブエージェントの動きをそのまま可視化する（`bin/agent-village-hook.js`）。
- **どのプロジェクトでも動く**: `agent-village` を1個のCLIコマンドとして起動すると、実行時のカレントディレクトリを自動的に監視対象（ターゲットルート）にする。このツール自体（インストールルート）と監視対象プロジェクト（ターゲットルート）は別プロジェクトでもよい。
- **ドット絵アートスタイル**: ポケモン金銀（GBC）期を基準にした見下ろし型・タイルグリッド・4方向スプライトのレトロなビジュアル（`docs/design/01-visual-concept.md`）。
- **カスタムキャラクター画像の取り込み**: [img_to_pixcel_app](https://github.com/Afarg/img_to_pixcel_app)（写真→ピクセルキャラ変換）と [ani_convert_app](https://github.com/Afarg/ani_convert_app)（まばたき・歩行差分生成）と組み合わせることで、任意の画像から作ったキャラクターをエージェントの見た目として差し替えられる。

## パイプライン全体像

このツールは3プロジェクトから成るパイプラインの最終段（表示側）。

```
① img_to_pixcel_app          ② ani_convert_app              ③ agents_app (this repo)
   写真 → ピクセルキャラ変換   →   まばたき・歩行差分生成    →   ダッシュボードで表示
```

## 技術スタック

- Node.js / Express（ローカルサーバー、`server/`）
- chokidar（ファイル監視） / Server-Sent Events（リアルタイム配信）
- Phaser 3（フロントエンドのゲーム描画、CDN経由で読み込み、`public/`）

## セットアップ

```bash
npm install
npm start          # 監視対象は実行時のカレントディレクトリ
# デモ用のダミーデータを試す場合
npm run demo
```

詳細な導入手順は `docs/manual-install-guide.md`（要点のみ）または `docs/setup.md`（オプション・トラブルシューティング・設計背景を含む詳細版）を参照。

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| `docs/setup.md` | 導入手順（詳細版） |
| `docs/manual-install-guide.md` | 導入手順（要点版） |
| `docs/operations-guide.md` | 運用ガイド |
| `docs/system-architecture.md` | システムアーキテクチャ |
| `docs/design/` | ビジュアルコンセプト・状態モデル・技術選定などの設計ドキュメント |
