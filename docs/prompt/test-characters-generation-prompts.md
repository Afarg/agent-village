# テストキャラクター生成プロンプト集(Nano Banana / Adobe Firefly用)

対象読者: 画像生成担当者(ユーザー)。次の検証工程「異なる体型・服装・アートスタイルでの閾値汎化性確認」で使う入力画像を、Adobe Fireflyのnanobanana(Gemini系画像生成)で作成するためのプロンプト集。

関連: `docs/project-status.md` §7(次の工程1番目)、`img_to_pixcel_app/docs/design/04-constraints-and-limitations.md`(入力画像ガイドライン)、`img_to_pixcel_app/docs/design/06-multi-angle-input.md`(アングル構成・ファイル命名)。

**背景**: これまでの実機検証は蝙蝠の羽根・丈の長いジャケットの青髪キャラ(2頭身・チビキャラ)を使い回してきた。`leg_fraction`/`shift_fraction`/口検出バンド/`fix_stray_band_pixels`/目検出の各閾値が、体型・服装・アートスタイルの異なる入力でも汎化するかを確認するため、狙いを変えた4体を新規に生成する。

---

## 0. 全プロンプト共通ルール

キャラクターごとのプロンプトの**先頭に必ず付け足す**共通指示。既存パイプラインの入力ガイドライン(`img_to_pixcel_app/docs/design/04-constraints-and-limitations.md` §3)にそのまま対応している。

```
chibi anime character, full body, standing straight, facing forward,
both arms relaxed and down at the sides (NOT a T-pose, NOT arms raised,
NOT hands on hips), legs together or very slightly apart, single character only,
centered in frame, character occupies about 60-70% of the frame height,
plain flat light gray background (no scenery, no props, no shadow on the background),
clean bold outline, flat cel-shaded coloring, no text, no watermark, no signature,
square image, high resolution
```

**この共通ルールを外してはいけない理由**:
- 「腕を下ろした正面立ち」以外(Tポーズ・手を上げる等)は、幅/高さ比0.75超で自動トリミングが`UnsupportedPoseError`を出して弾かれる(§3.1のハードバリデーション)。
- 「単一被写体・中央寄り・画面の30%以上」は背景除去(`rembg`)の精度に直結する。
- 「背景と被写体にコントラストがある単色背景」は、背景除去モデルが被写体を誤検出しないための推奨事項。**透過背景を直接生成させるより、無地の単色背景で生成して`rembg`に除去させる方が輪郭が安定する**(生成AIの疑似透過はエッジがノイズになりやすいため)。

### 同一キャラクターを5アングル分、一貫させるコツ

nanobananaは呼び出しごとに独立した生成になるため、**キャラクターのデザイン仕様(髪型・色・服・小物の色コード)を毎回のプロンプトに全文書き直す**こと(「前の画像と同じ」だけでは再現されない)。各キャラクターのセクションに「デザイン仕様(固定文)」を用意しているので、5アングルすべてに必ずそのまま含めること。

生成後、明らかに配色や小物が前のアングルとズレた場合は、そのアングルだけ再生成すること。多少のズレ(数px単位の細部)は`img_to_pixcel_app`側のパレット統一処理(正面基準で他アングルを合わせる、`06-multi-angle-input.md` §5)で吸収されるため、完全一致でなくてよい。

### ファイル保存名(アップロード時にこの名前にする)

| アングル | 必須度 | ファイル名 |
|---|---|---|
| 正面 | 必須 | `front.png` |
| 斜め(左向き) | 推奨 | `diagonal_left.png` |
| 斜め(右向き) | 推奨 | `diagonal_right.png` |
| 横向き | 任意 | `side.png` |
| 後ろ向き | 任意 | `back.png` |

4体すべてを正面+斜め両方(フェーズ2相当)まで揃えれば次の工程には十分。横向き・後ろ向きは余裕があれば追加する任意扱い。

---

## 1. キャラクターA:「ロングコートの魔法使い」— 服の丈の限界を再検証

**ねらい**: `shift_fraction=0.65`の境界(脚部領域の下65%のみシフト)を明確に超える、既存キャラより丈の長いコートで、歩行時の胴体崩れ(§6既知の限界)が実際に再発するかを確認する。あわせて、既存キャラ(2頭身)より少し高めの頭身で体型差の影響も見る。

**デザイン仕様(固定文・毎回含める)**:
```
a 3-head-tall chibi character, young wizard boy, short messy silver hair,
purple eyes, wearing a very long flowing purple coat that reaches all the way
down to the ankles (coat hem extends past the knees, well below the normal
leg-shift boundary), the coat has a row of gold buttons down the front,
wearing plain black pants underneath (only visible below the coat hem),
black pointed shoes, no hat, no wings
```

| アングル | プロンプト(共通ルール + デザイン仕様 + 下記) |
|---|---|
| 正面(必須) | `front view, symmetrical pose` |
| 斜め左(推奨) | `three-quarter view from the left, character body turned slightly to face left, same design as front` |
| 斜め右(推奨) | `three-quarter view from the right, character body turned slightly to face right, same design as front` |
| 横向き(任意) | `full side profile view, facing left, same design as front` |
| 後ろ向き(任意) | `back view, showing the back of the long coat, same design as front` |

---

## 2. キャラクターB:「和装の巫女」— 服の丈 × 左右非対称の複合パターン

**ねらい**: キャラクターAとは別種の「丈の長い服」(裾が広がる着物風スカート)に加えて、**左右非対称の装飾**(片側だけの飾り)を持たせ、斜め(左向き)/斜め(右向き)を左右反転の使い回しではなく個別に用意する意味を検証する。

**デザイン仕様(固定文・毎回含める)**:
```
a 2.5-head-tall chibi character, shrine maiden girl, long black hair tied
into a single low side ponytail on the RIGHT side only (left side has no
ponytail, hair is asymmetric), red eyes, wearing a white and red kimono-style
outfit with a long flared skirt reaching below the knees (longer than a normal
skirt, extends well past the standard leg region), a large red ribbon bow tied
on the LEFT hip only (asymmetric, no bow on the right hip), holding nothing
in the hands, white socks, wooden sandals
```

| アングル | プロンプト |
|---|---|
| 正面(必須) | `front view, symmetrical pose, asymmetric hair and bow clearly visible` |
| 斜め左(推奨) | `three-quarter view from the left, same design as front, showing the left hip bow` |
| 斜め右(推奨) | `three-quarter view from the right, same design as front, showing the right-side ponytail` |
| 横向き(任意) | `full side profile view, facing left, same design as front` |
| 後ろ向き(任意) | `back view, same design as front` |

---

## 3. キャラクターC:「マフラーのパーカー少年」— 目検出・口検出の限界を検証

**ねらい**: 目の色が肌・髪と彩度的に近い配色(`ani_convert_app/docs/design/05-constraints-and-limitations.md` §1の既知の限界)にして目検出(彩度ヒューリスティック)の汎化性を見る。加えて、マフラーが口元にかかるデザインで口抑制(②.5)が「検出できずフェイルソフトする」想定通りに動くかを確認する。塗りのタッチも既存キャラ(フラットな塗り)と変え、ソフトなグラデーション塗りにしてアートスタイル軸も同時に見る。

**デザイン仕様(固定文・毎回含める)**:
```
a 2-head-tall chibi character, boy wearing a brown hoodie, messy brown hair,
brown eyes with LOW saturation (eye color close to the same muted brown tone
as the hair and skin, not a bright contrasting color), soft painterly
gradient shading instead of flat cel-shading, wearing a thick beige knit
scarf wrapped around the neck and covering the lower half of the face up to
the nose (mouth and chin fully hidden by the scarf), gray sweatpants, white
sneakers
```

| アングル | プロンプト |
|---|---|
| 正面(必須) | `front view, symmetrical pose, scarf covering mouth clearly visible` |
| 斜め左(推奨) | `three-quarter view from the left, same design as front` |
| 斜め右(推奨) | `three-quarter view from the right, same design as front` |
| 横向き(任意) | `full side profile view, facing left, same design as front` |
| 後ろ向き(任意) | `back view, same design as front` |

---

## 4. キャラクターD:「丸っこいデフォルメの精霊」— 極端な体型 × 翼以外の付属物

**ねらい**: 既存キャラ(2頭身・蝙蝠の羽根)よりさらに極端な超デフォルメ体型(丸っこい胴体・短い手足)にして`leg_fraction`(bounding boxの下35%を脚とみなす)の前提が崩れやすい入力を作る。付属物も蝙蝠の羽根とは別種(背中のケープ)にして、歩行時のシフト処理との干渉パターンを増やす。

**デザイン仕様(固定文・毎回含める)**:
```
a very round 1.5-head-tall super-deformed chibi character, spirit creature
with a round pudgy body and very short stubby arms and legs, big round green
eyes, teal-colored fur/skin, wearing a small red cape attached at the
shoulders that hangs down to just above the short legs, no hat, round ears,
no visible neck (head connects almost directly to the round body)
```

| アングル | プロンプト |
|---|---|
| 正面(必須) | `front view, symmetrical pose` |
| 斜め左(推奨) | `three-quarter view from the left, same design as front` |
| 斜め右(推奨) | `three-quarter view from the right, same design as front` |
| 横向き(任意) | `full side profile view, facing left, same design as front` |
| 後ろ向き(任意) | `back view, same design as front` |

---

## 5. 生成後のチェックリスト(アップロード前に確認)

各画像について、`img_to_pixcel_app/docs/design/04-constraints-and-limitations.md` §3のガイドラインに沿って以下を確認する。不合格の場合はそのアングルだけ再生成する。

- [ ] 腕が下がっている(Tポーズ・手を上げるポーズになっていないか)
- [ ] キャラクターが1体だけ写っている
- [ ] キャラクターが画像中央寄りで、画面の3割以上を占めている
- [ ] 背景が単色に近く、キャラクターとのコントラストが十分にある
- [ ] 同一キャラクターの5アングル間で、髪型・配色・小物の位置(特にキャラクターBの左右非対称要素)が大きくズレていない
- [ ] キャラクターC・Dのように「服が口にかかる」「頭身が極端」といった、そのキャラで検証したい特徴が実際に描画に反映されている

## 6. どのキャラで何を検証するか(対応表)

| キャラクター | 主な検証対象 | 関連ドキュメント |
|---|---|---|
| A. ロングコートの魔法使い | `shift_fraction`境界超えの服丈での胴体崩れ再発有無 | `ani_convert_app/docs/design/05-constraints-and-limitations.md` §2 |
| B. 和装の巫女 | 服丈 × 左右非対称、斜め(左向き)/(右向き)個別提供の効果、`fix_stray_band_pixels`の斜めビュー色衝突 | `img_to_pixcel_app/docs/design/06-multi-angle-input.md` §5更新履歴(2026-07-31) |
| C. マフラーのパーカー少年 | 目検出(低彩度)の汎化、口抑制②.5のフェイルソフト動作、非フラット塗りでの減色 | `ani_convert_app/docs/design/05-constraints-and-limitations.md` §1、`img_to_pixcel_app/docs/design/04-constraints-and-limitations.md`(口の抑制の限界) |
| D. 丸っこいデフォルメの精霊 | `leg_fraction`前提が崩れる極端な体型、翼以外の付属物とのシフト干渉 | `ani_convert_app/docs/design/05-constraints-and-limitations.md` §2 |

生成が揃ったら、各キャラクターにつき`grid_size∈{32,64,128}`×`colors∈{8,10}`×`output_size∈{64,128}`の12パターン(`CLAUDE.md`のピクセル変換検証ルール)で`img_to_pixcel_app`のパイプラインを通し、`ani_convert_app`側でまばたき・歩行の生成まで確認する。
