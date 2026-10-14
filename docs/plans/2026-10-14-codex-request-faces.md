# Codex への依頼: 顔専用 WebP の切り出しと、アイリスのコートなし立ち絵

2026-10-14。素材80枚の納品(6e86daf)に続く2件。どちらも `docs/art/STORY-ASSETS.md` の決定表を最新の仕様とする。

---

## 依頼文(ここから貼る)

対象プロジェクト: `C:\Users\takas\project\MiechauGuildMaster`

前回納品した物語素材80枚に対して、2件お願いします。(1) 台詞枠の横に出す顔専用の画像を全ポーズぶん切り出す、(2) アイリスのコートなし立ち絵を2枚追加する。どちらも画像の作成・検証・一覧の更新までで、`src/` 配下と `src/data/*.json` は触らないでください(ゲームへの登録は別セッションが行います)。

### 1. 顔専用 WebP の切り出し

**背景**: 現行エンジンは立ち絵の上端・中央を650%に拡大して顔にしていますが、ティナ(高いポニーテール)、ヴィオラ(鎧の肩当て)、竜などで顔が枠に収まりません。以前の素材一覧で確認済みです。固定倍率を廃止し、ポーズごとに顔の範囲を決めて別ファイルに出します。

**対象**: `public/art/characters/<id>/<pose>.webp` にある現行の立ち絵74枚すべて(`artifacts/source-art/story-assets-verification.json` の `characters` の一覧と一致させる。`revisions/` の予備は対象外)。アウレリアの `dragon` も含む。

**仕様**

- 出力先: 元PNG `artifacts/source-art/faces/<id>/<pose>.png`、配布 `public/art/faces/<id>/<pose>.webp`。ファイル名は立ち絵と同じ `<id>/<pose>`。
- 寸法: 正方形 **256×256**、背景透過(立ち絵の透過をそのまま保つ)。
- 切り出しは**元の立ち絵PNG(`artifacts/source-art/characters/<id>/<pose>.png`、512×1024)から**行う。AIで顔を描き直さない。立ち絵と顔が同じ絵であることが条件。
- 範囲の決め方: 人物ごとに「顔範囲」(左上のx, y と一辺の長さ。元PNGの座標)を1つ決め、同じ人物の全ポーズに同じ範囲を当てる。ポーズで頭の位置がずれていて目や口が切れる場合だけ、そのポーズに個別の範囲を持たせる。目と口が必ず入り、髪や帽子が多少切れるのは構わない。顔の中心が枠の中央に来るようにし、顔の縦幅が枠の55〜70%になる倍率を目安にする。
- 竜(`aurelia/dragon`、1024×1024)は頭部(目と口)を同じ基準で切り出す。
- 範囲は `artifacts/source-art/faces/face-regions.json` に保存する。形は次のとおり。ポーズ個別の上書きがあるときだけ `poses` を書く。

```json
{
  "kai": { "x": 160, "y": 40, "size": 200 },
  "viola": { "x": 150, "y": 60, "size": 220, "poses": { "scout_neutral": { "x": 155, "y": 50, "size": 210 } } }
}
```

- 確認: 48px・58px・76px に縮小しても目と口が判別できること。素材一覧(`story-assets-review.html`)の右下の顔を、現行の650%切り出しから新しい顔ファイルの表示に替え、3サイズを並べて目視できるようにする。
- `verify-story-assets.py` を拡張し、顔ファイルの枚数(74)、寸法(256×256)、アルファの有無、`face-regions.json` との対応を検査する。`story-assets-verification.json` に `faces` の節を足す。

### 2. アイリスのコートなし立ち絵

**背景**: 終章でアイリスが父ガルドにコートを返す場面を足すことになりました。返した後のアイリス用に、コートなしの立ち絵が2表情必要です。

**仕様**

- id / ポーズ名: `iris` / `coatless_neutral`、`iris` / `coatless_happy`。
- 寸法・形式: 他の立ち絵と同じ 512×1024、透過PNG(`artifacts/source-art/characters/iris/`)と WebP(`public/art/characters/iris/`)。
- 絵: 顔・髪・頭の位置・立ち位置は現行の `iris/neutral.png`・`iris/happy.png` と同じにし、肩のコートだけを外す。中の衣装はコート版の下に着ているもの(生成りのブラウス、紫のベスト、紺のロングスカート)。コートなしのデザイン画 `artifacts/source-art/characters/iris/design-tina-redraw-v1.png` が基準。
- この2枚にも顔専用 WebP を切り出す(1 の対象に含める。合計 76 枚)。
- `verify-story-assets.py` の iris のポーズ一覧に2つ足し、素材総数を 82 枚に更新する。

### 納品の形

- `STORY-ASSETS-DELIVERY.md` に今回の節を追記(実行プロンプト、範囲の決め方で迷った人物、個別上書きしたポーズの一覧)。
- `python artifacts/source-art/verify-story-assets.py --require-complete` が通る状態で終える。
- 既存の80枚のファイルは変更しない(SHA256 が前回と一致すること)。

---

## 依頼文はここまで。出す側のメモ

- 顔を 256×256 にしたのは、表示先が 48〜76px で、2倍解像度の端末でも 152px あれば足りるため。立ち絵の顔部分は元PNGで 180〜220px 程度なので拡大にならない。
- `face-regions.json` はゲームでは読まない。ゲームは出力済みの顔 WebP を `art.json` の `face` から参照する(組み込み依頼の手順3)。範囲の記録は再切り出し用。
- 顔ファイルが届いたら、組み込み側で `art.json` の各ポーズに `"face": "faces/<id>/<pose>.webp"` を書く。
