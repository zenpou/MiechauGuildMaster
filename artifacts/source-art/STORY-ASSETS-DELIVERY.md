# 物語画像素材の納品記録

> 2026-10-14 追納: 現行素材は **82枚・164ファイル**、別途顔専用 **76枚・152ファイル**。以下の80枚という記載と650%表示の説明は前回納品時の記録。今回の詳細は末尾「顔専用素材とアイリスのコートなし版」を参照。

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

## 顔専用素材とアイリスのコートなし版（2026-10-14）

前回の現行立ち絵74枚（アウレリアの竜を含む）に、アイリスの `coatless_neutral` / `coatless_happy` を追加。立ち絵76枚、背景4枚、一枚絵2枚で素材総数82枚。顔画像は派生素材として別に76枚を数える。予備の `revisions/` は切り出し対象外。

### 顔の切り出し

- 元PNG: `faces/<id>/<pose>.png`、配布: `../../public/art/faces/<id>/<pose>.webp`。すべて256×256 RGBA、WebPは可逆圧縮。
- [face-regions.json](faces/face-regions.json) の元PNG座標（左上x/yと正方形のsize）で切り出し、Pillow LANCZOSで256×256に縮小・拡大。元のアルファを保持し、顔の描き直し・背景の描き足し・色変更は行わない。
- 人物ごとに同じ範囲を全ポーズへ適用。額から顎までの縦幅がおよそ枠の55〜70%になるようにし、顔中心と目・口の判別を優先。髪全体や帽子を入れるために顔を小さくしない。
- 範囲の判断に注意した人物: **ティナ**は高いポニーテールを基準にせず顔へ寄せた。**ヴィオラ**は肩当てを除き、鎧・斥候服とも同じ範囲で目と口が収まることを確認。**アイリス**のdizzy（額の手）、**フィーネ**のsparkle、**ガルド**のコート有無も共通範囲で確認。**高慢な男性冒険者**は横向き顔の中心に合わせて人物の基本xを調整。**竜**は角・たてがみ全体ではなく横顔の目・鼻先・口・下顎を優先。
- 個別上書きしたポーズは **`aurelia/dragon` のみ**（x=12, y=142, size=212）。元画像が1024×1024で人型と位置・大きさが異なるため。それ以外の75枚にポーズ別上書きはない。
- [素材一覧](story-assets-review.html) 右下は新しい顔WebPを48px・58px・76pxで並べる。竜も表示対象。透過・暗色・白背景の切り替えを維持。
- 全76枚の3サイズを目視確認した記録: [1](../story-assets-review/faces/faces-1.png)、[2](../story-assets-review/faces/faces-2.png)、[3](../story-assets-review/faces/faces-3.png)、[4](../story-assets-review/faces/faces-4.png)。閉じた目は元の表情どおり。目と口の位置が枠内に収まり、縮小後も表情を判別できる。

再生成コマンド（AI呼び出しなし）:

```powershell
python artifacts/source-art/crop-story-faces.py
```

### アイリス2枚の生成

内蔵 `image_gen` で既存neutral/happyを編集。肩に掛けた茶色のコートを外し、生成りのブラウス・金縁の紫ベスト・紺のロングスカートを露出。衣装基準は `characters/iris/design-tina-redraw-v1.png`。顔・銀髪・リボン・頭の配置・前で手を合わせる立ち姿を既存版と比較した。[比較画像](../story-assets-review/faces/iris-comparison.jpg)。生成差分のため元画像との全画素一致は主張しない。

実行プロンプト全文、入力参照、生成元パスは [story-batch-iris-coatless.json](story-batch-iris-coatless.json) に保存。neutralは既存neutral＋デザイン画を参照し「コート全体だけを除去、表情・頭位置・髪・姿勢を保持」、happyは既存happy＋生成済みcoatless_neutral＋デザイン画を参照し「笑顔を保持して同じコートなし衣装にする」と指定。生成画像887×1774をLANCZOSで512×1024へ変換し、透過PNGと可逆WebPを保存。顔も各完成PNGから同じアイリス用範囲で切り出した。

### 検証・変更範囲

`verify-story-assets.py` は82枚の素材と76枚の顔を別々に検証し、顔の対応集合・寸法・形式・アルファ・範囲設定・元PNGからの切り出し一致を検査する。`story-assets-verification.json` に `faces` を追加。前回の検証JSONを [変更前記録](faces/previous-delivery-verification.json) に保持し、既存80枚のPNG/WebP計160ファイルが前回SHA256と一致することを必須チェックにした。

```powershell
python artifacts/source-art/verify-story-assets.py --require-complete
```

今回の変更は画像の作成・検証・一覧・納品記録のみ。`src/` と `src/data/*.json` は変更しない。ゲームへの登録と実ゲームの台詞枠での表示確認は別セッションの担当。

最終結果: `--require-complete` は終了コード0、素材82/82、顔76/76、既存160ファイルのSHA256一致。全顔PNGが設定範囲からの切り出しと一致し、全顔WebPがPNGのRGBA画素と一致。PNG/WebP計316ファイル（立ち絵・背景・一枚絵164＋顔152）。

一覧はChromeで全314画像の読み込み、全228顔表示の48/58/76px実寸、1280px幅・375px幅で横はみ出しなしを確認した。[ブラウザー検証結果](faces/gallery-browser-check.json)、[アイリス](../story-assets-review/faces/gallery-iris.png)、[竜](../story-assets-review/faces/gallery-dragon.png)、[スマートフォン幅](../story-assets-review/faces/gallery-mobile-tina.png)。白・暗色・透過背景の切り替えも確認。複製した一時ワークスペースでは、顔PNG欠落・寸法違い・アルファなし・範囲外座標・未知ポーズ上書き・前回SHA256不一致の6ケースすべてを終了コード1で検出した。[失敗条件の検証結果](faces/negative-verification-checks.json)。

## 序章冒頭の背景2枚・母のシルエット（2026-10-17）

序章 No.1〜3 の前世オフィス、No.4〜9 の実家、No.5・7・9 の母の顔に使う3件を追加した。素材は85枚（背景6・一枚絵2・立ち絵77）、派生の顔は77枚、PNG/WebPは計324ファイル。ゲームへの登録と実ゲームの台詞枠表示は別セッションの担当。

| ID | 元PNG | 配布WebP | 寸法 |
|---|---|---|---|
| bg_office_past | [PNG](backgrounds/bg_office_past.png) | [WebP](../../public/art/backgrounds/bg_office_past.webp) | 1536×1024 |
| bg_home_morning | [PNG](backgrounds/bg_home_morning.png) | [WebP](../../public/art/backgrounds/bg_home_morning.webp) | 1536×1024 |
| mother / neutral 立ち絵 | [PNG](characters/mother/neutral.png) | [WebP](../../public/art/characters/mother/neutral.webp) | 512×1024・透過 |
| mother / neutral 顔 | [PNG](faces/mother/neutral.png) | [WebP](../../public/art/faces/mother/neutral.webp) | 256×256・透過 |

### 生成と判断

内蔵 `image_gen` を使用。背景の線・材質感は `backgrounds/guild-office-day-v1.png`、人物の輪郭とセル影は `characters/tina/design-approved-v1.png`、暮らしの水準は `characters/kai/neutral.png` を目視参照した。[実行プロンプト全文・全6呼び出しの引数と生成元](prologue-opening-work/generation-calls.json)、[採用素材の生成台帳](story-batch-prologue-opening.json)を保存。初回生成3回と部分修正3回で、採用する原画は3枚。顔は別生成していない。

- オフィスは無人、灰青の低彩度にし、書類・青白いモニター・缶・胃薬を中央の机に集めた。初回の時計は時刻が合わなかったため、針だけ約00:10へ修正。数字や文字は読み取れない表現にした。
- 実家はギルドの豪華さを引き継がず、素朴な梁・板床・調理道具・薬草と朝の光にした。初回は寝床が脚付きベッドになったため、木枠と脚を除去し、藁布団・毛布・上着を床に直接置く構図へ修正。開いた玄関は中央やや右に置いた。
- 母は顔の造作を描かない濃い墨色の影。真っ黒一色だと輪郭を見失うため、衣服は暗い階調のセル影とし、外縁に控えめな明るい線を残した。初回の上げた拳は下ろし、両手を腰へ変更。三角巾・後ろで束ねた髪・エプロン・まくった袖・3つの湯気で怒りを示す。
- 母の顔は表情の拡大よりも三角巾・湯気・頭と肩の輪郭を優先。`face-regions.json` に `mother: {x:76, y:12, size:352}` を追加し、完成立ち絵から正方形で切り出した。48pxでも影の輪郭と湯気が見える範囲を採用した。

背景PNGは生成結果の1536×1024を保存し、WebPは品質85・method=6。母の生成結果887×1774をLANCZOSで512×1024へ縮小。顔は範囲を切り出してLANCZOSで256×256へ変換。立ち絵・顔のWebPはlossless=True、method=6、exact=Trueでアルファを保持。再作成は新しい8ファイルだけを対象にする:

```powershell
python artifacts/source-art/prologue-opening/prepare.py
python artifacts/source-art/verify-story-assets.py --require-complete
python artifacts/source-art/prologue-opening/review.py
```

### 検証と保存範囲

`--require-complete` は終了コード0、素材85/85・顔77/77。寸法・形式・透過・顔の切り出し画素一致・顔WebPのRGBA一致、生成台帳85件の対応、一覧の641リンクと322画像参照の存在を確認した。背景375×480の中央トリミング、母の48/58/76px表示、白／暗色／実家／門前の背景上での輪郭を[確認シート](prologue-opening/visual-review.jpg)で目視確認した。

[前回納品記録](prologue-opening/previous-delivery-verification.json)の既存316画像すべてが前回SHA256と一致することを検証器の必須条件に追加。[作業前ハッシュ](prologue-opening/before-sha256.json)と[保存範囲の検証](prologue-opening/preservation-check.json)でも、既存画像462ファイルの不変を確認した。本作業による既存ファイルの更新は、依頼された一覧・顔範囲・検証器・納品記録と、検証器が再生成する最終結果JSONのみ。最終監査中に本作業外の`src/core/story.ts`と`src/data/story.json`の変更を検出したため、`src/`全体の前後一致は主張しない。これらや並行更新された文書・テストの差分は保持し、本作業では編集していない。

今回の一覧のブラウザー表示はローカル接続制限で確認できなかったため、リンクの存在検査と配布WebPから作った確認シートで検証した。ゲーム組み込み・実ゲーム再生は未実施。`src/`、`src/data/*.json` は変更していない。
