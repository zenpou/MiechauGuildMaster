# Codex への依頼: 序章の背景2枚(前世のオフィス・実家の中)と母のシルエット

2026-10-17。序章の展開改修(41b272b・4e81beb)に合わせた追加素材3件。`docs/art/STORY-ASSETS.md` の決定表を最新の仕様とする。

---

## 依頼文(ここから貼る)

対象プロジェクト: `C:\Users\takas\project\MiechauGuildMaster`

序章(`docs/story/scripts/prologue_script.md`)の冒頭に使う素材を3件お願いします。(1) 前世のオフィスの背景、(2) 実家の中の背景、(3) 母のシルエット(立ち絵と顔)。画像の作成・検証・一覧の更新までで、`src/` 配下と `src/data/*.json` は触らないでください(ゲームへの登録は別セッションが行います。`src/data/art.json` には3件のキーを `null` で用意してあります)。

絵柄の基準は既存の背景(`artifacts/source-art/backgrounds/guild-office-day-v1.png` など)と `artifacts/source-art/characters/tina/design-approved-v1.png`。新しい3枚も同じ絵柄・同じ塗りに揃えてください。

### 1. 背景 `bg_office_past`: 前世のオフィス(深夜)

**使う所**: 序章 No.1〜3。カイの独白「名ばかり管理職、終電帰りは当たり前。胃薬をエナドリで流し込み……最後はデスクで静かに過労死した」の間だけ映る。異世界の絵の中に一瞬だけ現代の職場が差し込まれる対比が狙い。

- 寸法・形式: 1536×1024、元PNG `artifacts/source-art/backgrounds/bg_office_past.png`、配布 `public/art/backgrounds/bg_office_past.webp`(品質85目安)。
- 内容: 現代日本の事務所の島の一角、深夜。蛍光灯が一部消えて薄暗い。手前のデスクに書類の山、点いたままのモニターの青白い光、エナジードリンクの空き缶と胃薬の箱、ずれたキーボード。窓の外は夜のビルの灯り。壁掛け時計は0時過ぎ。
- 人物は描かない(椅子は空、または倒れた椅子)。
- 色は全体を少し脱色し、灰青に寄せる。「思い出している記憶」に見えるように、他の背景より彩度を落とす。
- 要素は中央に寄せる(375px 幅のスマートフォンでは左右が大きく切れる)。文字(書類の字、時計の数字)は読めないぼかしにし、実在のロゴ・社名は入れない。

### 2. 背景 `bg_home_morning`: 実家の中(朝)

**使う所**: 序章 No.4〜9。母(声のみ)との問答と「この穀潰しがぁー！」まで。No.10 でカイが回転して外へ吹き飛び、No.11 からは既存の門前の一枚絵(`stills/prologue.webp`)に切り替わる。

- 寸法・形式: 1536×1024、元PNG `artifacts/source-art/backgrounds/bg_home_morning.png`、配布 `public/art/backgrounds/bg_home_morning.webp`。
- 内容: 村人の家の中。カイの衣装(生成りの麻チュニック、`artifacts/source-art/characters/kai/neutral.png`)と同じ生活水準の、素朴で小ぎれいな農家風の居間。板の間か土間、木の梁、窓から朝日が斜めに差し込む。手前の床に敷いたままの寝床(藁布団と毛布、脱ぎ捨てた上着)=カイの昼寝の場所。奥の壁に玄関の木扉が見え、少し開いて外の朝の光が差している(ここから蹴り出される)。棚に農具や鍋、吊るした薬草。
- 人物は描かない。
- 要素は中央に寄せる(上と同じ理由)。玄関の扉は中央〜やや右に置く(カイの立ち絵は右側に出るため、扉との位置関係が分かる)。

### 3. 母のシルエット `mother` / `neutral`(立ち絵と顔)

**使う所**: 序章 No.5・7・9 の母の台詞。母は「声のみ」の話し手で、舞台に立ち絵は出さず、台詞枠の横の顔だけに出す。顔が無い現状では台詞枠に顔が出ない(`tests/story.test.ts` の「絵の無い話し手は母と全員だけ」)。

- id / ポーズ名: `mother` / `neutral`。1表情だけ。
- 立ち絵: 512×1024、透過PNG `artifacts/source-art/characters/mother/neutral.png`、配布 `public/art/characters/mother/neutral.webp`。他の立ち絵と同じく全身、頭を上端近くに置く。
- 顔: 256×256、透過、`artifacts/source-art/faces/mother/neutral.png`、配布 `public/art/faces/mother/neutral.webp`。立ち絵から切り出し、範囲を `artifacts/source-art/faces/face-regions.json` に足す(他の人物と同じ手順)。
- 絵: **顔の造作を描かない黒〜濃い墨色の影**。輪郭だけで「怒った母親」と分かること。髪は後ろで束ねて三角巾、エプロン、袖をまくった腕を腰に当てる(または腕組み)。背は低めでがっしり。頭の周りに小さな怒りの湯気や火花を2〜3本。
- 影の色は真っ黒にせず、濃い墨色+縁にわずかな明るいハイライトを入れて、昼の家の中でも門前の一枚絵でも輪郭が見えるようにする。
- 顔の256×256は、頭と肩の影の輪郭(三角巾・湯気)が入るように切る。48px に縮めても「怒っている母の影」と分かる形を優先する。

### 検証と納品の形

- `verify-story-assets.py` の一覧に背景2件、`mother` の立ち絵1件・顔1件を足し、`python artifacts/source-art/verify-story-assets.py --require-complete` が通る状態で終える(素材総数 82 → 85、顔 76 → 77)。
- `story-assets-verification.json` と `story-assets-review.html` に3件を足す。
- `STORY-ASSETS-DELIVERY.md` に今回の節を追記(実行プロンプト、迷った点)。
- 既存のファイルは変更しない(SHA256 が前回と一致すること)。

---

## 依頼文はここまで。出す側のメモ

- 台本側は先に新しい背景IDへ直してある(序章 No.1〜3 `bg_office_past`、No.4〜9 `bg_home_morning`、No.10〜11 `bg_street_gate`)。`art.json` は `bg_office_past` / `bg_home_morning` を `null`、`mother.neutral` を `null` で持ち、仮の見た目で動く。届いたらパスを書く。
- 母は `cast.json` で `poses: ["neutral"]` 済み。立ち絵は舞台に出さない方針(台本の立ち絵配置は「なし」のまま)なので、立ち絵ファイルは顔の切り出し元と、将来舞台に出すときの保険。
- 組み込み時に `tests/story.test.ts` の「絵の無い話し手は母と全員だけ」を「全員だけ」に直す。
