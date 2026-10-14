# 依頼: 物語(序章〜終章)をゲームに組み込む

新規セッションに貼る依頼文。2026-10-14 時点で台本と素材は揃っている(台本 3e56f48・7f3c8e8、素材 6e86daf・9bb3551。顔専用画像とアイリスのコートなし立ち絵、終章のコートを返す追記まで済み)。

---

## 依頼文(ここから貼る)

`docs/story/scripts/*_script.md` の台本7章(序章・第一〜五章・終章)を、紙芝居エンジンで再生できるようにゲームへ組み込んでください。素材は `public/art/` に全部揃っています(立ち絵76枚、顔専用画像76枚、背景、一枚絵)。足りない素材はありません。進め方は CLAUDE.md(TDD、決定論、セーブ互換、計測)に従い、設計の判断が要る所は止まって聞いてください。

### 先に読むもの

1. `docs/plans/2026-10-14-story-art-integration.md` — 組み込みの手順、決定5件、エンジンに足すもの
2. `docs/art/STORY-ASSETS.md` の先頭の決定表 と `docs/art/PLACEHOLDER.md` — 素材の寸法と art.json の形
3. `docs/story/RULES.md` 3-2 — 演出タグの語彙(現行+追加予定)
4. `docs/story/PLOT.md` の各章の「解放条件」 — `story.ts` の語彙で書いてある
5. `src/core/story.ts`、`src/core/presentation.ts`、`src/ui/storyPlayer.ts`、`tests/story.test.ts` — 現行の仕組み
6. `artifacts/source-art/story-assets-verification.json` — 現行素材82枚と顔76枚の一覧(これに無い画像は使わない)

### やること(この順で。1段ごとにテストを緑にしてコミット)

**1. エンジンの語彙を足す**(`src/core/presentation.ts`、`storyPlayer.css`、`storyAudio.ts`)
- motion に `spin-out`(回転しながら画面外へ)、`hit`(縦揺れ+一瞬の赤み)、`tremble`(細かい震え)
- sfx に `slash` `blow` `roar` `flame`(合成音でよい。既存の7音と同じ作り方)
- `prefers-reduced-motion` のときは既存の動きと同じく抑える

**2. 立ち絵の表示を人物別に調整できるようにする**
- 今は全人物が `height: 280%`・上端基準。人物ごとに倍率と基準位置を上書きできる口を作る(`cast.json` に `display` を持たせるか、`data-character` 属性で CSS を分ける)
- アウレリアの `dragon` ポーズは 1024×1024 の横長なので、縦長に変形させず枠に収める専用の設定

**3. 顔(台詞枠の横)を別ファイルで読む**
- 今は立ち絵の上端を 650% に拡大して切り出しているが、ティナのポニーテールやヴィオラの鎧で顔が切れる
- 顔専用の画像が `public/art/faces/<id>/<pose>.webp`(256×256、透過)に全ポーズぶんある。`art.json` の各ポーズを `{ "image": "characters/<id>/<pose>.webp", "face": "faces/<id>/<pose>.webp" }` の形にし、`face` を台詞枠の顔にそのまま表示する(拡大切り出しはやめる)。`face` が無いポーズ(値が文字列だけの旧形式)は従来の切り出しに戻す互換を残す
- `tests/story.test.ts` の art.json 検査を新しい形に対応させ、全ポーズに `face` があることも検査する

**4. cast.json / art.json を本番の人物で作り直す**
- 人物: kai, tina, iris, noel, sera, viola, ruu, fine, aurelia, gald。ポーズは `public/art/characters/<id>/` にある WebP の通り(viola は `scout_*` 4つを含む10、iris は `coatless_*` 2つを含む8、gald は coat あり/なし4、aurelia は人型5+`dragon`)。`color` と `name`(台本の話し手名と一字一句同じ)を決める
- 話し手だけで立ち絵の無い「母」と、終章27行目の「全員」も cast に要る(絵は null)。「全員」は分割して各人に言わせる案でもよい。どちらにするかは聞いてから
- 背景: `bg_street_morning` `bg_guild_office` `bg_guild_office_night` `bg_guild_office_sunset` `bg_guild_hall`(受付背景 `guild-reception-v1.webp` を流用) `bg_dungeon_mine` `bg_dungeon_crystal` `bg_dungeon_dragon`。序章シーン1(門前)には `stills/prologue.webp` を背景として使う(人物なしの門前の絵)
- 一枚絵: `prologue`(序章の扉絵)、`dragon`(終章の決着と扉絵)。旧 `founding` と旧キー(guild / town / night / tavern / office、master / clerk / unique)は story.json の書き換え後に削除

**5. story.json を7章で書き起こす**
- 台本の表(話者・台詞・背景・立ち絵配置・演出)を1行ずつ `lines` に写す。台本の表情名→ポーズ id の対応は STORY-ASSETS.md 3-2(通常=neutral、喜び=happy、怒り=angry、驚き=surprised、照れ=shy、固有は人物ごと)。「通常・斥候服」は `scout_neutral`
- 解放条件は PLOT.md の `{"all": [{"flag": "story:<前章>"}, …]}` をそのまま
- 演出の `motionAt` / `effectAt` / `sfxAt` は、その行の本文にある語に結びつける(テストが検査する)
- 独白(序章1〜4行)は話し手なしの地の文として `text` だけで書く
- 終章のシーン1(竜との戦闘)は、ボス戦の紙芝居(戦闘ログ連動)が別の仕組みなので、**今回は固定の台本として**ユニーク全員が出る版で書く。汎用冒険者の行は入れない。戦闘ログ連動は次の依頼
- 終章シーン3は台本どおり、26〜30行目のガルドは `coatless_happy`、31行目でコートを受け取ってから `happy`。アイリスは31行目以降 `coatless_happy`(台本の「喜び・コートなし」)
- 章の `art`(扉絵)は序章=`prologue`、終章=`dragon`、他は無し

**6. 冒険者の性別と外見IDを持たせる**(物語とは独立。別コミット)
- `Adventurer` に `gender: 'male' | 'female'` と `appearance: string` を足す。`generateAdventurer` で rng から決める(`adv_<性格>_<性別>`)。ユニークは人物 id
- `SAVE_VERSION` を 2 に上げ、読み込み時に無い冒険者へ `hash(seed, 'appearance', adv.id)` から一度だけ補完して保存。`Math.random` は使わない
- 転職・装備変更・再読み込みで変わらないことをテストで固定する
- 名簿・候補への顔表示は顔ファイルが揃ってから。今回は保存まで

### やらないこと(次の依頼)

- ボス戦の紙芝居(戦闘ログ→台詞表→実行時キャスト)。終章シーン1は固定台本で代替
- 忠誠イベント(50/120/255)の台本と組み込み
- 勘違いイベントのミニ劇化
- 名簿・候補・派遣画面の顔表示
- 台本の文章そのものの修正(Antigravity の担当。おかしい所はコメントで指摘だけ)

### 守ること

- 画像は `artifacts/source-art/story-assets-verification.json` にある80枚だけ使う。`revisions/` の予備は登録しない
- `src/core/` に DOM を書かない。数値はコードに埋めず JSON へ
- 既存セーブが読めること(`tests/save.test.ts` に版2の移行テストを足す)
- 終わったら `npm test`、`npm run build`、`npm run test:browser` を通し、スマートフォン幅(375px)で序章と第二章(ヴィオラの鎧・斥候服の切り替え)と終章(竜の立ち絵)の見え方をスクリーンショットで確認して `docs/VERIFICATION.md` に日付付きで追記
- 決定を変えたい所(台本の矛盾、エンジンの制約で表現できない演出)は、自分で直さず列挙して止まる

---

## 依頼文はここまで。以下はこの依頼を出す側のメモ

### 揃っているもの

- 台本7章(`docs/story/scripts/*_script.md`)。文章版は派生なので組み込みには使わない
- 素材80枚(背景9、立ち絵74、一枚絵2)。`public/art/` に配布 WebP
- 解放条件(PLOT.md、`story.ts` の語彙で書いてある)
- 演出タグの語彙(RULES 3-2)

### 2026-10-14 時点で揃ったもの(当初「足りない」としていた分)

| 項目 | 状態 |
|---|---|
| 顔専用 WebP 76枚 | 納品済(9bb3551)。`public/art/faces/` |
| アイリスのコートなし立ち絵2枚 | 納品済(9bb3551) |
| 終章の「コートを返す」追記 | 台本・文章版とも済(7f3c8e8) |
| 第二章・終章の文章版の差し戻し2件 | 済(7f3c8e8) |

### 組み込みの後に判断するもの

- 第二章を「坑道の確認」で開くか「初帰還」で開くか(今は確認)
- 坑道を確認しないと第三章以降が出ない。山村の依頼などで誘導するか
- 「全員」の台詞を1人の話し手にするか、分割するか(依頼文の手順4で聞いてくる)
