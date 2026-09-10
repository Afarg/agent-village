# 07. 複数フレーム・複数方向スプライートの再生対応 — Agent Village Dashboard

`ani_convert_app`（PixelAnimator、仮称）が生成するまばたき・歩行の差分フレームをAgent Villageで実際に再生できるようにするための、本体側の設計。

対象読者: `server/src/lib/customAssets.js` / `server/src/index.js` / `public/js/game.js` の実装者。
関連: `ani_convert_app/docs/design/04-output-format-and-agent-village-handoff.md`（本ドキュメントが受け取るバンドル形式）、`02-agent-state-model.md`（既存のViewModel）、`01-visual-concept.md` §3.2（アニメーション仕様の原案）。

**実装状況**: 実装済み・実機検証済み（2026-07-29）。§5の実装ステップ0〜5をすべて実施し、実際に`ani_convert_app`で生成したバンドル（正面+斜め、まばたき+歩行差分入り）をダッシュボードのHUDからアップロードして実機で動作確認した（更新履歴参照）。同日中に2件追加変更: ①`diagonal`を`diagonal_left`/`diagonal_right`に分割（§2・§4.2）、②歩行フレームが2枚とも生成物になった（`_walk1.png`/`_walk2.png`、`ani_convert_app`側の対側性歩行への作り直しに伴う、`ani_convert_app/docs/design/02-generation-pipeline.md` §3参照）。②は`game.js`側の再生ロジックが配列を汎用的に扱っているため無変更で対応できている。

---

## 1. 背景・目的

現状のAgent Village（`server/src/lib/customAssets.js`・`public/js/game.js`）は、キャラクターの見た目を**1エージェントにつき1枚のPNG（`<agentId>.png`）**として扱う。`public/js/game.js`の`applyCharacterSprite`は単一テクスチャを差し替えるだけで、複数フレームを切り替えて再生する仕組みは無い。

`ani_convert_app`が生成する「まばたき」「歩行」の差分フレーム、および複数アングル（正面/斜め/横向き/後ろ向き）を活かすには、Agent Village側に**複数ファイル＋方向の概念を持つアニメーション再生機構**を追加する必要がある。

**既存の単一PNGアップロード機能は壊さない。** アニメーションは任意の追加機能とし、設定しなければ従来通り1枚絵の静止表示になる（後方互換性を最優先する）。

## 2. データモデルへの拡張

`02-agent-state-model.md`の`AgentCharacter`（表示専用フィールド）に、既存の`spriteUrl`とは別に**任意の`animation`フィールド**を追加する。

```ts
interface AgentCharacter {
  // ...既存のフィールドはすべてそのまま...
  spriteUrl?: string;          // 既存。animationが無い場合の静止画（後方互換）

  animation?: {                 // 新規・任意。無ければ静止表示（既存動作のまま）
    views: {
      [view in "front" | "diagonal_left" | "diagonal_right" | "side" | "back"]?: {
        idle: string[];         // 1枚なら静止、2枚ならまばたきループ用URL配列
        walk: string[];         // 通常2枚（歩行パターン1・2）のURL配列
      };
    };
  };
}
```

- `views`に存在しない方向は「提供されていない」ことを意味する（`ani_convert_app/docs/design/04-output-format-and-agent-village-handoff.md` §2と同じ考え方）。
- `spriteUrl`と`animation`は共存可能だが、`animation`がある場合はそちらを優先して描画する（§4）。

## 3. ストレージ・APIの拡張

### 3.1 ディレクトリ構成

既存: `assets/custom/characters/<agentId>.png`（1ファイル）

追加: `assets/custom/characters/<agentId>/`（ディレクトリ）に、`ani_convert_app`のバンドル一式（`front.png`, `front_blink.png`, `front_walk1.png`, `front_walk2.png`, `back.png`, ..., `anim-manifest.json`）をそのまま保存する。既存の単一ファイル方式とディレクトリ方式は共存できる（`customAssets.js`の`assetInfo`はファイルの有無で判定しているため、判定ロジックに「ディレクトリの存在も見る」分岐を1つ足すだけで済む）。

### 3.2 新規エンドポイント

```
POST   /api/agents/:agentId/animation   複数ファイル + anim-manifest.json をまとめて受け取る（multerの.any()等で複数ファイル受信）
DELETE /api/agents/:agentId/animation   アニメーションを解除し、spriteUrl（あれば）の静止表示に戻す
```

- バリデーションは既存の`CHARACTER_SPRITE`制約（`customAssets.js`）を各フレームに適用する。合計サイズの上限も新設する（例: 1エージェントあたりのバンドル合計 2MB、フレーム数が多くなるため単一ファイルの300KB上限をそのまま合計に適用すると窮屈すぎる可能性があり、実装時に実測して調整する）。
- 既存の`/api/agents/:agentId/sprite`（単一PNG）はそのまま残す。どちらを使うかはユーザーの選択（ダッシュボードUI側に「アニメーション一式をアップロード」という別枠を追加する形にし、既存の「見た目を差し替える」欄とは分ける）。

## 4. フロントエンドの再生ロジック（`public/js/game.js`）

### 4.1 フレーム切り替えの方式

`ani_convert_app`の出力は**個別のPNGファイル**であり、1枚のスプライートシートに詰めたものではない（`ani_convert_app/docs/design/02-generation-pipeline.md` §4の命名規則）。そのため、Phaserの正式なスプライートシート/アニメーションマネージャーは使わず、**タイマーで`sprite.setTexture(key)`を単純に切り替える**方式にする（実装がシンプルで、ビルド不要という既存方針と合う）。

- idle（まばたき）: `idle`配列が2枚以上ある場合、数秒おきにランダムなタイミングで一瞬だけまばたきフレームに切り替えて戻す（既存の`01-visual-concept.md` §4 idle説明「3〜8秒ごとにランダムでまばたき」という演出仕様にそのまま合わせられる）。1枚しか無ければ何もしない（静止）。
- walk（歩行）: `working`/`walking_to_room`中、`walk`配列の2フレームを一定間隔（既存の`WALK_SPEED`関連の値を流用）で交互に切り替える。1枚しか無ければ何もしない（既存のsquashアニメのみで代替）。

### 4.2 方向（`facing`）に応じたビューの選択

`game.js`にはキャラクターの向きを計算する`facingFromDelta`が既に実装されている（現状はプレースホルダーキャラの目の位置オフセットにのみ使われている）。これを流用し、`facing`の値から使用する`view`を決定する。

> **更新履歴（ユーザーとの合意、2026-07-28・2回目）**: `img_to_pixcel_app`側の入力要件が3段階のフェーズ構成に整理された（`img_to_pixcel_app/docs/design/06-multi-angle-input.md`更新履歴）: **フェーズ1＝正面のみ（必須）**、**フェーズ2＝正面＋斜め（推奨）**、**フェーズ3＝正面＋斜め＋横向き＋後ろ向き（フル）**。`diagonal`は「必須」ではなく「推奨」に戻った点に注意（一度は必須化を検討したが、正面のみでも最低限使える段階的な設計に変更）。これに合わせて下表のフォールバック連鎖を「無ければ`front`まで戻る」形に更新した。
>
> **更新履歴（ユーザーとの合意、2026-07-29）**: 左右非対称なキャラクターに対応するため、単一の`diagonal`が`diagonal_left`/`diagonal_right`の2ビューに分かれた（`img_to_pixcel_app/docs/design/06-multi-angle-input.md`更新履歴）。`facing=left`/`right`では該当する側の画像をそのまま（水平反転なしで）優先し、その側が無い場合のみ反対側を反転して代用する。`facing=down`/`up`は左右どちらかへの偏りが無い移動のため、`diagonal_right`→`diagonal_left`の順で恣意的だが決定的に選ぶ（実装は`public/js/game.js`の`pickWalkView()`）。下表を更新済み。

| 状態 | 優先して使う`view` | 無ければのフォールバック |
|---|---|---|
| 静止（`idle`・会話中など、移動していない時） | `front` | — （`front`は唯一の必須スロットのため常に存在する） |
| 移動中・`facing=down` | `diagonal_right`（提供されていれば） | `diagonal_left`（提供されていれば）→ 無ければ`front` |
| 移動中・`facing=up` | `back`（提供されていれば） | `diagonal_right`→`diagonal_left`（いずれか提供されていれば）→ 無ければ`front` |
| 移動中・`facing=left` | `side`（提供されていれば、`flipX=false`） | `diagonal_left`（`flipX=false`、提供されていれば）→ 無ければ`diagonal_right`（`flipX=true`で水平反転）→ 無ければ`front` |
| 移動中・`facing=right` | `side`（提供されていれば、`flipX=true`で水平反転） | `diagonal_right`（`flipX=false`、提供されていれば）→ 無ければ`diagonal_left`（`flipX=true`で水平反転）→ 無ければ`front` |

`front`だけが唯一の必須スロットなので、**フォールバック連鎖は常に`front`で止まり、「最終的に何も表示できない」状況は起こらない**。フェーズ1（正面のみ）の利用者は、移動中も`front`がそのまま使われる（見た目のブレは無いが、専用の移動アングルも無い）。フェーズ2（+斜め）に進むと、移動中は`diagonal_left`/`diagonal_right`（片方のみ提供の場合は反転で使い回す）に切り替わり、見た目の自然さが増す。両方提供すれば、左右非対称なキャラクターも移動方向ごとに正確な絵で表示される。フェーズ3（+横向き+後ろ向き）でさらに精度が上がる、という段階的な体験になる。

`side`を左右共通で使い回すのは、`01-visual-concept.md` §3.2「walk: 2フレーム（第1世代式の足踏み反転で可）」で既に前提とされている考え方（横向き1枚を反転して逆方向に使う）をそのまま踏襲したもの。`diagonal_left`/`diagonal_right`のどちらか片方のみ提供された場合も同じ考え方でもう片方を反転して代用する。両方提供されていれば反転は行わず、それぞれの実画像をそのまま使う。

## 5. 実装ステップ案

| Phase | 内容 |
|---|---|
| 0 | `customAssets.js`にディレクトリ方式の`assetInfo`判定を追加（既存の単一ファイル方式との共存を実機で確認） |
| 1 | `POST/DELETE /api/agents/:agentId/animation`エンドポイントの実装 |
| 2 | `normalize.js`の`buildAgentCharacter`に`animation`フィールドを追加 |
| 3 | `game.js`にフレーム切り替え・方向選択ロジックを実装 |
| 4 | `hud.js`にアニメーション一式のアップロードUIを追加（既存の「見た目差し替え」欄とは別枠） |
| 5 | `ani_convert_app`から実際に出力したバンドルを使い、実機で一連の流れを確認 |

> **更新履歴（実装・実機検証、2026-07-29）**: 上記フェーズ0〜5をすべて実施。実装時に判明した、設計時点の想定との差分・追加で見つかった問題は以下の通り。
>
> - **§2の`animation`フィールドはPhase 2で計画したnormalize.jsではなく、index.jsの`buildCharacterWithAssets`に追加した。** 既存の`spriteUrl`自体も`normalize.js`の`buildAgentCharacter`ではなく`index.js`側で組み立てられている実装だったため（`characterSprite()`呼び出し）、既存パターンに合わせて`animation`も同じ場所に追加する方が一貫性がある。
> - **chokidarの既存ウォッチャーがディレクトリ形式のバンドルを正しく扱えないバグを発見・修正した。** `character-asset`種別の再読み込み処理は「変更されたファイルの拡張子を除いた名前」をagentIdとみなしていたが、これはバンドルがディレクトリ内の`front.png`等に変更があった場合、ファイル名（`front`等）を誤ってagentIdと解釈してしまう。変更されたファイルの親ディレクトリが`CHARACTER_ASSET_DIR`自身と異なる（＝1階層下＝バンドル内）場合は、親ディレクトリ名をagentIdとして扱うよう修正した。
> - **エージェント名変更（リネーム）時に、単一スプライートと同様アニメーションバンドルのディレクトリも移動するよう追加した。** 設計時点でこの動線は明記されていなかったが、既存の単一スプライート移動ロジックと同じ場所にあり、対応しないとリネームでバンドルが孤立する実質的なバグになるため、実装時に追加した。
> - **`game.js`側で2点、実装中に見つけて修正**: (1) `setWorkingAnim`/`tintError`が「カスタム画像かどうか」を`currentSpriteUrl`の有無だけで判定していたため、アニメーション表示中のキャラクターは非表示のプレースホルダー（`body`）の方を対象に処理してしまっていた（作業中のスカッシュ演出が視覚的に効かない）。両メソッドとも`entry.agent.animation`の有無も条件に加えて修正。(2) `removeCharacter()`がまばたき・歩行の繰り返しタイマーを止めずにキャラクターを破棄していたため、エージェント削除後もタイマーが永久に残り続ける潜在的なリークがあった（歩行タイマーは`loop:true`のため特に顕著）。破棄前に`stopIdleBlink`/`stopWalkFrames`を呼ぶよう修正。
> - **実機検証**: `ani_convert_app`で正面+斜めバンドル（まばたき・歩行差分入り）を生成し、ダッシュボードのHUDから実際にアップロード。(1) 静止時に正面のアイドル絵が即座にプレースホルダーより優先表示される、(2) デモシナリオでエージェントを実際に歩かせたところ、下方向移動時に設計通り`diagonal`ビューへ切り替わる（`facing="down"`→斜め、§4.2の表通り）、(3) 到着後は正面のアイドル表示に自動で戻る、(4) 「アニメーションを解除」でプレースホルダーへ正しくフォールバックする、(5) `anim-manifest.json`を含まない不正なアップロードで想定通りのエラーメッセージが出る、(6) アニメーション未設定の別エージェント（`agent-dispatcher`）は終始プレースホルダーのまま影響を受けない（後方互換）——以上をすべて実機で確認した。まばたき自体（3〜8秒間隔・150ms表示）は歩行フレーム切り替えと同一のコード経路（`loadAnimFrame`）を使っているため、歩行側の実機確認をもって同等に動作すると判断した。

## 6. 既知の限界

| 項目 | 内容 |
|---|---|
| フェーズ1（正面のみ）は移動中も見た目が変わらない | `diagonal_left`/`diagonal_right`が無い場合、移動中も`front`を使い回すため専用の移動アングルが無い。段階的な設計として許容する（§4.2の更新履歴） |
| フレーム数増加によるアセット容量 | 1エージェントあたり最大 (1方向あたり最大4枚: idle・blink・walk1・walk2) × 5方向(front/diagonal_left/diagonal_right/side/back) = 20枚 に増えうる。既存の1エージェント300KB制約をそのまま適用すると合計でさらに大きくなりうるため、§3.2の合計上限を別途設ける必要がある |
| 後方互換 | `spriteUrl`のみのエージェント（既存データ）は`animation`が無いため、これまで通り静止表示され続ける。移行作業は不要 |
