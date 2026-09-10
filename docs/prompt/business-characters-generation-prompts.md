# ビジネスキャラクター生成プロンプト集(Nano Banana / Adobe Firefly用)

対象読者: 画像生成担当者(ユーザー)。Agent Villageダッシュボードで実用するための、ビジネス用(スーツ)キャラクター4体分のプロンプト集。

関連: `docs/prompt/test-characters-generation-prompts.md`(前回のテストキャラクター4体、体型・服装の汎化性検証用)、`docs/project-status.md` §10〜§12(まばたき機能の実機検証・修正の記録)。

**背景**: 前回のテストキャラクター4体(魔法使い・巫女・マフラー少年・精霊)による検証で、まばたき機能(`ani_convert_app/app/blink.py`)は「髪の色と瞳の色が近い」「髪の塗りが細かく賑やか」「体型が極端」といった要素があると、目の位置を正しく検出できない・誤った色で塗ってしまう、という限界が繰り返し見つかった(詳細は`docs/project-status.md` §10〜§12)。今回は、いきなり多様なデザインに挑むのではなく、**まず検出しやすい・安定して動くキャラクターでパイプライン全体を仕上げる**方針に切り替える。ビジネス(スーツ)キャラクター4体は、実用面での需要に加えて、この「検出しやすい基準セット」としての役割も兼ねる。

## 0. 全プロンプト共通ルール

`test-characters-generation-prompts.md` §0の共通ルール(chibiスタイル・腕を下ろした正面立ち・単一被写体・単色背景等)をそのまま踏襲する。**それに加えて**、前回の検証で判明した、まばたき機能が苦手とするパターンを避けるための追加ルールを設ける。

### 0.1 基本ルール(前回と共通、再掲)

```
chibi anime character, full body, standing straight, facing forward,
both arms relaxed and down at the sides (NOT a T-pose, NOT arms raised,
NOT hands on hips), legs together or very slightly apart, single character only,
centered in frame, character occupies about 60-70% of the frame height,
plain flat light gray background (no scenery, no props, no shadow on the background),
clean bold outline, flat cel-shaded coloring, no text, no watermark, no signature,
square image, high resolution
```

### 0.2 追加ルール(今回のねらい: まばたき検出との相性を最優先)

```
eye color must be a vivid, clearly saturated color that is CLEARLY DIFFERENT
in hue from the hair color (high contrast between eyes and hair - not a similar
or neighboring color), simple flat/smooth hair shading with at most one soft
highlight streak (avoid busy, heavily textured, or speckled hair shading),
moderate chibi proportions (about 2.5-3 heads tall, not extremely squashed or
oversized head), keep hair length moderate (not reaching past the waist),
neutral calm facial expression, mouth as a small closed neutral line (not a
distinctive dark mark)
```

**このルールを外してはいけない理由**(前回の実機検証で確認済み):
- **目と髪の色が近いと検出に失敗する**: 銀髪(グレー〜ラベンダー系)に紫の瞳を持つキャラクターで、目検出アルゴリズムが「瞳の暗い点」と「髪のハイライトの暗い点」を色だけで区別できず、まばたきの色・位置が安定しなかった(`docs/project-status.md` §12.1・§12.2)。
- **髪の塗りが賑やかすぎると誤検出の元になる**: 髪の陰影・ハイライトが細かく描き込まれていると、目の検出に使う「暗い点」の候補が髪の中に大量に生まれてしまい、瞳ではなく髪の一部を選んでしまうことがあった。
- **体型が極端だと閾値が効かない**: 頭が体のほとんどを占めるような極端なデフォルメでは、顔・目の位置を推定するための各種の目安(頭身に対する比率)が成立しにくい。中庸な頭身の方が安定する。
- **口が目立つ暗いマークだと口抑制と干渉しうる**: 今回は口抑制自体は未修正のため深追いしないが、念のため控えめな表現にしておく。

## 1. キャラクターA:「営業/企画職の男性」— スーツ・髪色1(黒)

**差別化要素**: 黒髪、青系の瞳(髪と瞳の色相を明確に分離)。

**デザイン仕様(固定文・毎回含める)**:
```
a 2.5-head-tall chibi character, young businessman, short neat black hair
with a simple side part (no spiky details, smooth flat shading), vivid blue
eyes, wearing a dark navy business suit with a white dress shirt and a plain
dark red necktie, black dress shoes, no glasses, no facial hair, calm
professional expression
```

| アングル | プロンプト(共通ルール0.1+0.2 + デザイン仕様 + 下記) |
|---|---|
| 正面(必須) | `front view, symmetrical pose` |
| 斜め左(推奨) | `three-quarter view from the left, character body turned slightly to face left, same design as front` |
| 斜め右(推奨) | `three-quarter view from the right, character body turned slightly to face right, same design as front` |
| 横向き(任意) | `full side profile view, facing left, same design as front` |
| 後ろ向き(任意) | `back view, same design as front` |

## 2. キャラクターB:「管理職/ベテランの男性」— スーツ・髪色2(アッシュグレー)

**差別化要素**: アッシュグレー(落ち着いた灰色)の髪、暖色系の琥珀色の瞳(寒色系の髪と暖色系の瞳で明確にコントラストを付ける)。

**デザイン仕様(固定文・毎回含める)**:
```
a 2.5-head-tall chibi character, middle-aged businessman, short neat ash-gray
hair (smooth flat shading, no busy texture), warm amber/brown eyes, wearing
a charcoal gray business suit with a light blue dress shirt and a plain navy
necktie, black dress shoes, no glasses, no facial hair, calm confident
expression
```

| アングル | プロンプト |
|---|---|
| 正面(必須) | `front view, symmetrical pose` |
| 斜め左(推奨) | `three-quarter view from the left, character body turned slightly to face left, same design as front` |
| 斜め右(推奨) | `three-quarter view from the right, character body turned slightly to face right, same design as front` |
| 横向き(任意) | `full side profile view, facing left, same design as front` |
| 後ろ向き(任意) | `back view, same design as front` |

## 3. キャラクターC:「オフィスカジュアルの女性」— レディース・髪色3(オーバーン)

**差別化要素**: オーバーン(赤みのある茶色)の髪、緑の瞳(暖色系の髪と寒色系の瞳で分離)。服装は「レディース」= スーツではなく、ブラウス+膝丈スカートのオフィスカジュアル。

**デザイン仕様(固定文・毎回含める)**:
```
a 2.5-head-tall chibi character, young businesswoman, shoulder-length auburn
hair with a simple straight cut (smooth flat shading, no busy texture, hair
does not extend past the shoulders), vivid green eyes, wearing a light
cream-colored blouse, a simple knee-length charcoal pencil skirt, a thin
cardigan optional (keep simple), plain black low-heel shoes, no glasses,
calm professional expression
```

| アングル | プロンプト |
|---|---|
| 正面(必須) | `front view, symmetrical pose` |
| 斜め左(推奨) | `three-quarter view from the left, character body turned slightly to face left, same design as front` |
| 斜め右(推奨) | `three-quarter view from the right, character body turned slightly to face right, same design as front` |
| 横向き(任意) | `full side profile view, facing left, same design as front` |
| 後ろ向き(任意) | `back view, same design as front` |

## 4. キャラクターD:「パンツスーツの女性」— スーツ・髪色4(ダークブラウン)

**差別化要素**: ダークブラウン(濃い茶色)の髪、青系の瞳。服装は女性用のパンツスーツで、キャラクターCの「レディース」と明確に差別化。

**デザイン仕様(固定文・毎回含める)**:
```
a 2.5-head-tall chibi character, professional businesswoman, short neat
dark brown bob haircut (smooth flat shading, no busy texture, hair does not
extend past the shoulders), vivid blue eyes, wearing a dark navy women's
pantsuit (blazer and trousers) over a plain white blouse, plain black
low-heel shoes, no glasses, calm confident expression
```

| アングル | プロンプト |
|---|---|
| 正面(必須) | `front view, symmetrical pose` |
| 斜め左(推奨) | `three-quarter view from the left, character body turned slightly to face left, same design as front` |
| 斜め右(推奨) | `three-quarter view from the right, character body turned slightly to face right, same design as front` |
| 横向き(任意) | `full side profile view, facing left, same design as front` |
| 後ろ向き(任意) | `back view, same design as front` |

## 5. 生成後のチェックリスト

`test-characters-generation-prompts.md` §5の基本チェック(腕を下ろしているか・単一被写体か・中央寄りか・背景コントラストか)に加えて、今回は以下も確認する。

- [ ] 瞳の色が髪の色とはっきり違う色相になっているか(似た系統の色になっていないか)
- [ ] 髪の塗りが単純で、細かいハイライト・陰影が入りすぎていないか
- [ ] 頭身が極端になっていないか(2.5〜3頭身程度)
- [ ] 4人それぞれの髪色が実際に異なっているか(黒・アッシュグレー・オーバーン・ダークブラウン)
- [ ] 女性2人の服装が「レディース(ブラウス+スカート)」と「スーツ(パンツスーツ)」で明確に違うデザインになっているか

生成できたら、4体それぞれ正面(必須)+斜め左右(推奨)まで揃えて教えてください。`img_to_pixcel_app`の12パターン検証、`ani_convert_app`のまばたき・歩行生成、Agent Villageダッシュボードでの表示確認まで通します。
