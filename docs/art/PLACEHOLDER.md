# 紙芝居の絵の差し替え(art.json)

物語の章(紙芝居)の絵は `src/data/art.json` で引き当てる。値が `null` のあいだは仮の見た目を出し、パスを入れるとその画像を読む。
画像を置いてパスを書くだけで差し替わり、コードは触らない。

## art.json の形

```json
{
  "backgrounds": { "guild": null, "town": null, "night": null, "tavern": null, "office": null },
  "characters": {
    "master": { "neutral": null, "happy": null, "thoughtful": null }
  },
  "stills": { "founding": null, "dragon": null }
}
```

| キー | 何の絵か | 台本(`src/data/story.json`)のどこから引くか | null のあいだの仮の見た目 |
|---|---|---|---|
| `backgrounds.<背景ID>` | 舞台の背景 | 行の `background` | 背景IDごとの CSS グラデーション(`storyPlayer.css` の `[data-background='…']`)と、左上の「仮の背景 · ID」 |
| `characters.<人物ID>.<ポーズ>` | 立ち絵と台詞枠の横の顔(下の「人物の絵の3つの形」) | 行の `cast[].character`・`cast[].pose`、`portrait`、話し手 | `cast.json` の `color` の輪郭と名札だけのシルエットカード。顔は名前の頭文字(`portrait` を書いた行だけ。話し手の顔は絵が無ければ出さない) |
| `stills.<スチルID>` | 一枚絵(その行だけ舞台を置き換える)。章の扉絵にも使う | 行の `still`、章の `art`(記録タブの読み返し一覧の小窓) | 地の色で舞台を覆い「仮の一枚絵 · ID」 |

値は `public/art/` からの相対パスで書く。拡張子まで書く。

```json
"guild": "backgrounds/guild.webp"
```

→ `public/art/backgrounds/guild.webp` を読む(ビルド後は `dist/art/...`)。

### 人物の絵の3つの形

`characters.<人物ID>.<ポーズ>` の値は次のどれか。

```json
"neutral": null,
"happy": "characters/master/happy.webp",
"thoughtful": { "image": "characters/master/thoughtful.webp", "face": "faces/master/thoughtful.webp" }
```

| 値 | 立ち絵 | 台詞枠の横の顔 |
|---|---|---|
| `null` | シルエットカード | `portrait` の行は名前の頭文字。話し手の顔は出さない |
| 文字列(旧形式) | その絵 | 同じ絵の上部(顔のあたり)を拡大して切り出す。ポニーテールや鎧で顔が切れることがある |
| `{ "image", "face" }`(新形式) | `image` の絵 | `face` の絵を枠いっぱいに出す。`image` と `face` はどちらも書く |

### 台詞枠の横の顔が出る行

- 行に `portrait` があれば、その人物・ポーズの顔を出し、その人物は立ち絵に重ねない
- `portrait` が無ければ話し手(`speaker` が `cast.json` の `name` と一致する人物)の顔を出す。話し手がその行の `cast` にいればそのポーズ、いなければ `neutral`。立ち絵にも残す
- 地の文(話し手なし)、`cast.json` に無い話し手、顔の絵が `null` の話し手は顔を出さない

画像が見つからない・読めないときも、その場で仮の見た目に戻る。差し替えの途中で一部だけ置いても止まらない。

## 推奨する画像

前作(GuildQuest)と同じ寸法に揃えると、そのまま収まる。

| 種類 | 寸法 | 形式 | 収まり方 |
|---|---|---|---|
| 背景 | 1536×1024(3:2) | WebP(品質85目安) | 舞台いっぱいに `cover`。中央基準で切るので、要素は中央へ寄せる。375px 幅のスマートフォンでは左右が大きく切れる |
| 立ち絵 | 512×1024(1:2)、背景透過 | WebP(アルファ付き) | 全身の絵を舞台の高さの 2.8 倍に伸ばし、上端基準で胸から上を見せる。頭は絵の上端近くに置く。人物・ポーズごとの調整は下の「立ち絵の収め方」 |
| 顔 | 256×256(1:1)、背景透過 | WebP(アルファ付き) | 台詞枠の横の枠いっぱいに出す(`cover`)。顔を中央に置く。`face` が無い人物は立ち絵の上部を切り出して代用する |
| 一枚絵 | 1536×1024(3:2) | WebP | 舞台に `contain`(全体が見える。余白は暗い地の色) |

- 元画像(PNG)は `artifacts/source-art/`、配布する WebP は `public/art/` に置く(CLAUDE.md の構成どおり)
- 置き場所の例: `public/art/backgrounds/<背景ID>.webp`、`public/art/characters/<人物ID>/<ポーズ>.webp`、`public/art/faces/<人物ID>/<ポーズ>.webp`、`public/art/stills/<スチルID>.webp`

### 立ち絵の収め方(cast.json の display・poseDisplay)

既定の収め方(2.8 倍・上へ 4%)が合わない人物は、`cast.json` の人物に `display` を書く。ポーズだけ違うときは `poseDisplay` でそのポーズを上書きする。

```json
{
  "id": "aurelia", "name": "アウレリア", "color": "#c0504d", "poses": ["neutral", "dragon"],
  "display": { "scale": 2.6, "top": -0.02 },
  "poseDisplay": { "dragon": { "scale": 1, "top": 0 } }
}
```

| キー | 意味 | 既定 |
|---|---|---|
| `scale` | 枠の高さに対する絵の高さの倍率(正の数) | 2.8 |
| `top` | 枠の高さに対する絵の上端のずれ。負で上へ | -0.04 |

- `poseDisplay` は書いた値だけを上書きし、書いていない値は `display`(それも無ければ既定)のまま
- `poseDisplay` のキーはその人物の `poses` にあるもの。`npm test` が確かめる
- 絵は縦横比を保ったまま(変形しない)。横にはみ出したぶんは隣の枠へはみ出して見える
- 狭い画面(幅 600px 以下)で2人以上が並ぶ行は、どの人物も倍率に 6/7 を掛けて小さくする

#### 例外: 竜の姿(1024×1024)

アウレリアの `dragon` ポーズは四足の竜で、立ち絵の 1:2 ではなく 1024×1024(1:1)の横長の絵にする。胸から上を切り出すと竜の体が見えないので、`poseDisplay: { "dragon": { "scale": 1, "top": 0 } }` で枠の高さに全体を収める。

## 人物・背景・一枚絵を足すとき

1. 人物: `src/data/cast.json` に `{ "id", "name", "color", "poses": ["neutral", …] }` を足し、`art.json` の `characters` に同じ id と全ポーズの枠(`null` でよい)を足す。台詞の `speaker` は `name` と一字一句同じにする。収め方を変えるなら `display`・`poseDisplay` も書く
2. 背景: `art.json` の `backgrounds` にキーを足す。仮の見た目のグラデーションが欲しければ `storyPlayer.css` に `[data-background='<ID>']` を足す(無ければ既定の色)
3. 一枚絵: `art.json` の `stills` にキーを足し、台本の行の `still` か章の `art` から指す

台本・キャスト・art.json の食い違い(知らない人物・ポーズ・背景・一枚絵、ポーズの枠の過不足、人物の絵の形、`display`・`poseDisplay` の値)は `npm test`(`tests/story.test.ts`)が見つける。

## 確かめ方

1. `npm test` が通る
2. `npm run dev` で開き、新しく始めるとプロローグが出る。読み終えた章は記録タブの「物語」から読み返せる
3. 絵が出ないときは、パスの綴り(`public/art/` からの相対か、拡張子があるか)を見る
