# 物語画像素材の納品記録

対象: `docs/art/STORY-ASSETS.md`（2026-10-14）。画像生成は内蔵 `image_gen` を使用。

**現行素材80枚をPNG・WebPの両形式、計160ファイルで保存済み。** 汎用キャラは男女×6性格の各neutral1枚へ整理。強欲な男女のneutralを修正し、happy差分と旧素材は予備として保存。寸法・形式・読み込み・アルファ・重複なしと生成記録・リンクを検証。[最終集計](story-assets-final-check.json)。

- [素材一覧](story-assets-review.html): 全身・表情拡大、透過チェック、人物ID検索、PNG/WebPへのリンク。
- [機械検証](story-assets-verification.json): 保存済み数、未納品、寸法、アルファ、SHA256、ファイル容量。
- 生成条件・記録: [背景・一枚絵](story-batch-environments.json)、[人物A](story-batch-a.json)、[人物B](story-batch-b.json)。生成元の記録を含む。背景・一枚絵は実行プロンプト全文、人物Bは共通テンプレートと画像別条件、人物Aは共通条件と差分の要約記録であり、実行全文の保存ではない。
- [目視確認のスクリーンショット](../story-assets-review/): 人物ごとの全表情を比較。生成途中に保存した画像には当時の完了数が表示される。最終納品数は上記の最終集計を参照。

## 枚数

現行: 背景4枚・主要人物61枚・竜1枚・汎用冒険者12枚・一枚絵2枚の合計80枚。以下は初回納品時の経緯。

初回の発注書には「主要人物57枚」「合計76枚」とあるが、各行の指定表情を足すと主要人物59枚。指定表情を省略せず、背景4枚・主要人物59枚・竜1枚・汎用冒険者12枚・一枚絵2枚の **合計78枚** を納品対象とする。最新の完了数は検証JSONで確認する。

## 保存先

- 元PNG: `artifacts/source-art/backgrounds/<id>.png`、`characters/<id>/<pose>.png`、`stills/<id>.png`。
- 配布WebP: `public/art/backgrounds/<id>.webp`、`characters/<id>/<pose>.webp`、`stills/<id>.webp`。
- 背景・一枚絵は1536×1024。人物立ち絵は512×1024、竜は1024×1024、アルファ付き。寸法・形式の変換のみ画像処理ライブラリを使用し、描画・修正は `image_gen` で行う。
- 基準絵は `artifacts/characters/tina.png`、各人物の採用デザイン画と三面図。アイリスはコート版。ヴィオラは鎧と斥候服を別ポーズとして制作。

## 素材の確認

- 既存の昼の執務室にソファがあることを目視確認。夕暮れ版は同じ家具配置を維持。
- ロビー・廊下には既存受付背景を流用するため、新規生成なし。
- 火口背景に竜は入れず、竜の立ち絵と討伐スチルを別に制作。討伐スチルは同じ竜デザインを参照し、特定のヒロインが目立たない4人の構図。
- 序章は門と朝の街路だけの背景へ変更。人物・回転軌跡・砂煙は含めず、既存立ち絵を使う演出は別工程。
- 既存採用画11点のSHA256が既存manifestと一致することを確認。

## 組み込みとの境界

発注書の第6節に従い、今回の範囲は画像素材の生成・保存・検査。`src/data/art.json`、`cast.json`、台本は変更しない。ゲーム内の表情切り替え・顔切り出し・スマートフォン表示の実プレイ確認は未実施。

一覧の右下には、現行 `storyPlayer.css` の顔画像と同じ「上端・中央基準、高さ650%」の切り出しを表示する。この固定倍率ではヴィオラの鎧版は口元が下端にかかり、ティナは高いポニーテールが中心となって顔が大きく切れることを一覧で確認。採用画の髪型・頭身を維持した素材なので、組み込み時にはキャラクターごとの顔位置と倍率の調整が必要。これは実ゲームでの確認結果ではなく、同じCSS条件を再現した一覧上の確認結果。

次工程では各ID/ポーズの登録、旧IDとの整合、`bg_guild_hall` の受付背景流用、不要な `founding` 枠の処理、台本参照、`npm test` と実表示を確認する。

一覧・機械検証の再生成:

```powershell
python artifacts/source-art/verify-story-assets.py --require-complete
```

## Prologue anatomy correction

Redrew Kai with a coherent forward-tumbling pose, correcting the neck and shoulder orientation. Updated the canonical PNG and WebP; retained the previous files in `revisions/prologue-before-anatomy-fix.*`. Built-in image_gen edit prompt and inputs are recorded in [prologue-anatomy-revision.json](prologue-anatomy-revision.json). All 78 assets passed the dimension, decoding and transparency audit again after this revision.

## 序章を背景のみへ変更

人物入りスチルを採用せず、門と朝の街路だけの背景へ差し替え。`stills/prologue` のPNG・WebPを更新し、人物入り旧版は `revisions/prologue-before-background-only.*` に保存。生成条件は [prologue-background-revision.json](prologue-background-revision.json) に記録。今回の範囲は背景素材の差し替えまでで、立ち絵の回転・移動などのゲーム内演出は未実装。

## ガルドのコートなし版を追加

`characters/gald/coatless_neutral` と `characters/gald/coatless_happy` を追加（各512×1024、透過PNG・WebP）。アイリスにコートを貸している場面用。顔・体格・腰に手を置くポーズを維持し、腕まくりした黒いシャツ姿で生成。コートあり版は変更なし。内蔵image_genの実行プロンプトは [story-batch-gald-coatless.json](story-batch-gald-coatless.json)。素材一覧は合計80枚・160ファイルに更新。ゲーム組み込みは未実施。

## 竜の姿勢・仲間思いの冒険者の識別性を修正

竜は二足直立から自然な四足へ変更（竜のみ1024×1024の透過素材）。`adv_caring` は通常・笑顔とも黒い短髪、褐色肌、緑／ベージュ／橙の服装に変更し、ノエルと区別。旧3枚のPNG・WebPは `revisions/dragon-caring-redesign/` に保存。内蔵image_genの実行プロンプトは [dragon-caring-revision.json](dragon-caring-revision.json)。ノエルの全ファイルは変更前後のSHA256一致を確認。素材数は80枚のまま。ゲーム表示の調整は未実施。

## 臆病な冒険者の識別性を修正

`adv_timid/neutral` と `happy` を、短い砂色の髪・細長い顔・細身の成人男性に変更。青灰色のケープと茶の革鎧で、小盾を抱え周囲を警戒する姿。セラの全ファイルは変更前後のSHA256一致を確認。旧版は `revisions/timid-redesign/` に保存。内蔵image_genの実行プロンプトは [timid-redesign-revision.json](timid-redesign-revision.json)。512×1024透過PNG・WebP。素材数80枚のまま、ゲーム組み込みは未実施。

## カイを村人風の衣装へ変更

カイの全6表情を生成りの紐付きチュニック、革ベルトと腰袋、布ズボン、柔らかい革ブーツへ変更。顔・髪と気だるげな個性は保持。512×1024透過PNG・WebPを差し替え、旧6枚は `revisions/kai-villager/` に保存。内蔵image_genの実行プロンプトは [kai-villager-revision.json](kai-villager-revision.json)。旧デザイン画と三面図は保存し、以後の衣装参照は新しいneutralを優先。素材数80枚のまま、ゲーム組み込みは未実施。

## 男女別汎用冒険者24枚の初回納品（現在はneutralのみ採用）

6性格それぞれ男女を用意し、通常・笑顔の24枚を内蔵image_genで生成。キャラごとの顔・髪・体格と、同一人物の表情間の衣装・姿勢を目視確認。職業に依存しない旅装で、武器・盾・回復道具を使わず性格を示す。各512×1024の透過PNG・WebP。保存先は `characters/adv_<personality>_<male|female>/<neutral|happy>`。

- [男性12枚の実行プロンプト・生成記録](story-batch-generic-male.json)
- [女性12枚の実行プロンプト・生成記録](story-batch-generic-female.json)
- [性別・性格・画像IDの対応表](generic-character-assets.json)

旧 `adv_brave` / `adv_cautious` / `adv_greedy` / `adv_caring` / `adv_proud` / `adv_timid` の12枚は元のパスに残し、現行一覧と納品数からは除外。今回の親側目視確認は画像ファイルを直接開いて実施。顔アイコンの切り出し調整とゲームへの登録・転職時の外見固定処理は未実装。

## 汎用キャラ各1枚への整理と強欲キャラの修正

男女×6性格のneutral12枚を採用し、happy12枚は予備として元の場所に保持。`generic-character-assets.json` と検証器・一覧をneutralのみへ変更。強欲男性は顔の成人らしい比率を整え、女性は標準的な体格と控えめなゆったりした服装へ修正。両neutralのPNG・WebPを差し替え、旧版は `revisions/greedy-single-sprite/` に保存。内蔵image_genの実行プロンプトは [greedy-single-sprite-revision.json](greedy-single-sprite-revision.json)。予備happyは旧デザインなのでゲームに登録しない。現行80枚・160ファイル。ゲーム組み込みと最終顔切り出しは未実施。
