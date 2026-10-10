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
| `characters.<人物ID>.<ポーズ>` | 立ち絵(台詞枠の横の顔も同じ絵から切り出す) | 行の `cast[].character`・`cast[].pose`、`portrait` | `cast.json` の `color` の輪郭と名札だけのシルエットカード。顔は名前の頭文字 |
| `stills.<スチルID>` | 一枚絵(その行だけ舞台を置き換える)。章の扉絵にも使う | 行の `still`、章の `art`(記録タブの読み返し一覧の小窓) | 地の色で舞台を覆い「仮の一枚絵 · ID」 |

値は `public/art/` からの相対パスで書く。拡張子まで書く。

```json
"guild": "backgrounds/guild.webp"
```

→ `public/art/backgrounds/guild.webp` を読む(ビルド後は `dist/art/...`)。

画像が見つからない・読めないときも、その場で仮の見た目に戻る。差し替えの途中で一部だけ置いても止まらない。

## 推奨する画像

前作(GuildQuest)と同じ寸法に揃えると、そのまま収まる。

| 種類 | 寸法 | 形式 | 収まり方 |
|---|---|---|---|
| 背景 | 1536×1024(3:2) | WebP(品質85目安) | 舞台いっぱいに `cover`。中央基準で切るので、要素は中央へ寄せる。375px 幅のスマートフォンでは左右が大きく切れる |
| 立ち絵 | 512×1024(1:2)、背景透過 | WebP(アルファ付き) | 全身の絵を舞台の高さの 2.8 倍に伸ばし、上端基準で胸から上を見せる。頭は絵の上端近くに置く。台詞枠の顔は同じ絵の上部(顔のあたり)を切り出す |
| 一枚絵 | 1536×1024(3:2) | WebP | 舞台に `contain`(全体が見える。余白は暗い地の色) |

- 元画像(PNG)は `artifacts/source-art/`、配布する WebP は `public/art/` に置く(CLAUDE.md の構成どおり)
- 置き場所の例: `public/art/backgrounds/<背景ID>.webp`、`public/art/characters/<人物ID>/<ポーズ>.webp`、`public/art/stills/<スチルID>.webp`

## 人物・背景・一枚絵を足すとき

1. 人物: `src/data/cast.json` に `{ "id", "name", "color", "poses": ["neutral", …] }` を足し、`art.json` の `characters` に同じ id と全ポーズの枠(`null` でよい)を足す。台詞の `speaker` は `name` と一字一句同じにする
2. 背景: `art.json` の `backgrounds` にキーを足す。仮の見た目のグラデーションが欲しければ `storyPlayer.css` に `[data-background='<ID>']` を足す(無ければ既定の色)
3. 一枚絵: `art.json` の `stills` にキーを足し、台本の行の `still` か章の `art` から指す

台本・キャスト・art.json の食い違い(知らない人物・ポーズ・背景・一枚絵、ポーズの枠の過不足)は `npm test`(`tests/story.test.ts`)が見つける。

## 確かめ方

1. `npm test` が通る
2. `npm run dev` で開き、新しく始めるとプロローグが出る。読み終えた章は記録タブの「物語」から読み返せる
3. 絵が出ないときは、パスの綴り(`public/art/` からの相対か、拡張子があるか)を見る
