# 物語の画像素材の発注一覧(2026-10-14 確定)

台本(`docs/story/scripts/*_script.md`)が要求する絵と、いま手元にある絵の差分。画像生成の発注書として使う。
寸法・形式・置き場所の詳細は [PLACEHOLDER.md](PLACEHOLDER.md)。絵柄の基準は `artifacts/source-art/characters/tina/design-approved-v1.png`(全員この絵柄で描き直した採用版がある)。

## 0. 決定事項(2026-10-14)

### 2026-10-21 アウレリアの地図用顔を追加

終章後に実際の冒険者となるため、`public/art/map-faces/aurelia-v1.png` を追加した。1254×1254・RGBA PNG。内蔵画像生成ツールを使用し、アウレリアの既存立ち絵を人物参照、ティナの地図アイコンを画風参照とした。通常の42×42表示をPC・スマートフォン幅の派遣画面で確認済み。証跡は `artifacts/previews/story-fixes/aurelia-map-*.png`。

生成プロンプト:

> Create exactly one square transparent PNG game map head icon of Aurelia, matching the existing icon style. Reference image 1 is Aurelia's character identity: young adult ancient dragon in human form, charcoal-black hair with vivid burnt-orange inner streaks and tips, gold amber eyes, calm expression, no horns or wings. Reference image 2 is the required chibi floating-head icon rendering style only (do NOT copy red hair, bandage or her identity). Draw only Aurelia's complete head and stylized hair silhouette, no body, neck, shoulders, badge, background or text. Near frontal three-quarter view, quiet confident neutral expression, large expressive amber eyes, clean bold anime outlines and cel shading, subtle warm cream keyline like reference 2. Simplify her long hair into a compact head silhouette with orange tips that stays legible at 48x48 pixels. Entire hair silhouette inside canvas with 5% transparent padding; head occupies about90% of square. True transparent alpha background.

### 当初の共通仕様

| 項目 | 決定 |
|---|---|
| 立ち絵の寸法 | **全身 512×1024、背景透過**(現行エンジンのまま)。頭を上端近くに置く。エンジンは上端基準で胸から上を見せる(倍率は `cast.json` の `display` / `poseDisplay` で人物・ポーズ別に上書きでき、竜の姿はこれで枠に収める)。台詞枠の顔は別ファイル `public/art/faces/<id>/<pose>.webp`(256×256)。2026-10-14 組み込み済み |
| ヴィオラの衣装 | **2衣装**。斥候服(第二章の登録場面だけ)と、金属鎧+大盾(第二章の坑道以降ずっと) |
| ロビー/廊下 | 既存の受付背景 `guild-reception-v1.webp` を**流用**。新規は描かない |
| 汎用冒険者 | **男女それぞれ性格別6種＝12人分**(勇敢・慎重・強欲・仲間思い・自信家・臆病)。各1枚（neutralのみ）、計12枚。表情差分は不要。外見は職業と独立し、転職しても変えない |
| アウレリアの竜の姿 | **透過キャラクター素材**(1024×1024)。自然な四足姿勢。人間のような直立はさせない。一枚絵にはしない |

## 1. 手元にあるもの

| 種類 | 枚数 | 状態 |
|---|---|---|
| 背景 | 5 | `public/art/backgrounds/` に 1536×1024 WebP。執務室(昼・夜)、受付、酒場、朝の街 |
| 人物の全身デザイン画 | 11 | `artifacts/source-art/characters/<id>/design-*.png`(採用版は CHARACTERS.md の表。941×1672、象牙色の背景と足元の影つき)。10人+アイリスのコート有無。**透過も表情差分もまだ無い**ので、そのままゲームには載らない |
| 三面図 | 13 | `artifacts/source-art/characters/<id>/*-turnaround-v*.png`。表情差分を描くときの参照用 |
| 一枚絵 | 0 | `art.json` に `founding` と `dragon` の枠だけ |

## 2. 背景(発注 4 枚)

既存5枚と同じ 1536×1024、WebP(品質85目安)。人物は入れない。要素は中央に寄せる(375px 幅のスマートフォンでは左右が大きく切れる)。

| 背景ID | 場面 | 使う章 | 状態 |
|---|---|---|---|
| `bg_office_past` | 前世のオフィス・深夜。書類の山、モニターの光、エナドリの空き缶。彩度を落とす | 序章(独白 No.1〜3) | あり(2026-10-20 組み込み) |
| `bg_home_morning` | 実家の中・朝。板の間の寝床、朝日、玄関の木扉 | 序章(No.4〜9) | あり(2026-10-20 組み込み) |
| `bg_street_morning` | 朝の街・大通り | 序章 | あり(`street-morning-v1`) |
| `bg_guild_office` | 執務室・昼。書類が山積み、窓際にソファ | 全章 | あり(`guild-office-day-v1`)。ソファが描かれていなければ描き足す |
| `bg_guild_office_night` | 執務室・夜。ランプの灯り | 第五章 | あり(`guild-office-night-v1`) |
| `bg_guild_hall` | ロビー兼廊下 | 第三章・第四章 | **流用**(`guild-reception-v1`)。art.json で同じファイルを指す |
| `bg_guild_office_sunset` | 執務室・夕暮れ。窓から橙色の光が差し、影が長い | 第二章・第三章・終章 | **発注**。`guild-office-day-v1` と同じ構図・同じ家具配置で、時刻だけ夕方に |
| `bg_dungeon_mine` | 古い坑道・廃坑。松明の灯り、木の支柱、崩れた坑道、湿った岩 | 第二章 | **発注** |
| `bg_dungeon_crystal` | 古い坑道の奥。崩落で開いた水晶鉱脈。淡い青と紫に自ら光る巨大な水晶が天井と床に群生し、洞窟全体が青碧に染まる | 第二章 | **発注** |
| `bg_dungeon_dragon` | 竜の寝床・火口の祭壇。赤黒い岩肌、隙間から吹き出すマグマ、太古の石の祭壇、熱で揺らぐ空気 | 終章 | **発注**。竜は描かない(立ち絵で出す) |

既存の `tavern`(酒場)は新しい台本では使わない。

## 3. 立ち絵(主要人物・竜・汎用の計76枚、生成済み。母の追加1枚は末尾参照)

### 3-1. 共通仕様

- 512×1024、背景透過(アルファ付き PNG で納品、配布時に WebP 化)。
- 全身。頭を上端近くに置き、足元まで入れる。立ち位置・頭の高さ・体の向きは同じ人物の全表情で揃える(表情だけ差し替えて使うため)。
- 顔・髪・衣装・配色は `artifacts/source-art/characters/<id>/design-*.png`(採用版は CHARACTERS.md の表) のデザイン画を厳守。三面図 `artifacts/source-art/characters/<id>/*-turnaround-v*.png` も参照。
- 表情の標準は RULES 3-3「共通5種(通常・喜び・怒り・驚き・照れ)+固有1種」。下表の全量を発注する。
- 台詞枠の顔は顔専用の画像(`faces/<id>/<pose>.webp`、256×256)を別に納める。立ち絵の表情も顔で分かる大きさにする。

### 3-2. 主要人物(10人、63枚。ガルド・アイリスのコートなし各2枚を含む)

| 人物 | id | 表情(ファイル名) | 固有表情の描き方 | 参照画像・注意 |
|---|---|---|---|---|
| カイ | `kai` | neutral / happy / angry / surprised / shy / **sleep** | sleep: 目を閉じ口が半開き。立ったまま寝ている | 顔・髪は `kai.png` を継承。衣装は新しい村人風（生成りの紐付きチュニック、革ベルトと腰袋、布ズボン、柔らかい革靴）。新衣装の基準は `artifacts/source-art/characters/kai/neutral.png`。neutral は気だるげな半目 |
| ティナ | `tina` | neutral / happy / angry / surprised / shy / **sulky** | sulky: 頬を膨らませ横目で拗ねる | `tina.png`。頬の絆創膏を忘れない |
| アイリス | `iris` | neutral / happy / angry / surprised / shy / **dizzy** / coatless_neutral / coatless_happy | dizzy: 目を細め、頬が赤く、額に手を当てふらつく。coatless_happy: 父にコートを返した後の笑顔 | **`iris-coat.png`(コート版)**。終章で父に返すまでは父のコートを肩に羽織る。返却後は**本を持たないコートなし版**(`coatless_neutral` / `coatless_happy`)を使用し、終章No.31・35は `coatless_happy`。angry は極めて稀なので控えめに |
| ノエル | `noel` | neutral / happy / angry / surprised / shy / **worried** | worried: 眉を下げて心配そう。surprised は眼鏡が跳ねてずれる | `noel.png`。帳簿を抱えている |
| セラ | `sera` | neutral / happy / angry / surprised / shy / **teary** | teary: 大粒の涙、小刻みに震える。angry はほぼ出ないので弱く | `sera.png` |
| ヴィオラ(鎧) | `viola` | neutral / happy / angry / surprised / shy / **flustered** | flustered: クール気取りの顔が崩れ、素の慌てた顔が出る | `viola.png` の顔・髪で、**衣装は重い金属鎧(プレートメイル)+身の丈ほどの大盾**。兜は無し(髪を見せる) |
| ヴィオラ(斥候服) | `viola` | scout_neutral / scout_happy / scout_angry / scout_flustered | 鎧版と同じ表情 | `viola.png` の衣装そのまま(斥候風の軽装、腰に短剣)。**肩が窮屈で突っ張り、ベルトが余っている**サイズ違いの服。第二章の登録場面だけで使う4表情 |
| ルゥ | `ruu` | neutral / happy / angry / surprised / shy / **bluff** | bluff: 余裕の笑みを保とうとして目が泳ぎ、口角だけ上がる。shy は耳まで真っ赤 | `ruu.png`。neutral は余裕のある小悪魔の笑み |
| フィーネ | `fine` | neutral / happy / angry / surprised / shy / **sparkle** | sparkle: 素材を見つけて目が怪しく光り、前のめり。angry はほぼ出ないので「笑顔のまま圧」 | `fine.png`。大きな背負い籠を背負う。surprised は「あらぁ」と目を丸くする程度 |
| アウレリア(人型) | `aurelia` | neutral / happy / angry / surprised / shy | 全部ほぼ無表情。happy は口角がわずかに上がる、angry は静かな眼光の圧、surprised は顔が動かない、shy は耳と首筋が赤い | `aurelia.png`。固有は竜の姿(次節) |
| ガルド | `gald` | neutral / happy / coatless_neutral / coatless_happy | happy は豪快な笑い。終章の目覚めだけ | `gald.png`。コートありを保持し、アイリスが父のコートを着る場面用に黒いシャツのコートなし版も追加。寝込む姿は不要 |

### 3-3. 竜と汎用冒険者(13 枚、生成済み)

| 絵 | id / ファイル名 | 仕様 |
|---|---|---|
| アウレリア・竜の姿 | `aurelia` / **dragon** | 1024×1024 の透過火竜。紅蓮と黒の鱗、黄金の竜眼、横向きの胴体を四足で支え、翼は背に畳む自然な姿。二足直立はさせない。人型版の髪色(黒から炎色)と目の色を鱗と瞳に引き継ぐ。表示サイズと顔切り出しは組み込み時に竜用の調整を行う |
| 汎用冒険者・勇敢（男／女） | `adv_brave_male` / `adv_brave_female`、各 neutral の1枚のみ | 前向きな目線と堂々とした姿勢。武器の種類で表現しない |
| 汎用冒険者・慎重（男／女） | `adv_cautious_male` / `adv_cautious_female`、各 neutral の1枚のみ | 周囲を確かめる目線と落ち着いた姿勢 |
| 汎用冒険者・強欲（男／女） | `adv_greedy_male` / `adv_greedy_female`、各 neutral の1枚のみ | 小さな財布を気にする仕草と期待する表情 |
| 汎用冒険者・仲間思い（男／女） | `adv_caring_male` / `adv_caring_female`、各 neutral の1枚のみ | 相手を気遣う目線と柔らかな表情。回復職専用の服や道具にしない |
| 汎用冒険者・自信家（男／女） | `adv_proud_male` / `adv_proud_female`、各 neutral の1枚のみ | 胸を張り、口角を上げる |
| 汎用冒険者・臆病（男／女） | `adv_timid_male` / `adv_timid_female`、各 neutral の1枚のみ | 肩をすぼめて周囲を警戒 |

汎用冒険者は男女それぞれ6性格を用意する。主要人物および他の汎用人物と顔・髪・輪郭が区別できる普通の冒険者として描く。服装は布服・革ベルト・小さな荷物などの職業を限定しない旅装。特定職の制服・武器・回復道具を性格の識別手段にせず、性格は表情と姿勢で示す。性格の id は `src/data/personalities.json` の `brave / cautious / greedy / caring / proud / timid` と一致させる。既存の性別なし `adv_*` 素材12枚は旧候補として保存し、男女版のneutral各1枚を現行素材一覧に採用し、生成済みのhappyは予備として保存する（旧ファイルは削除しない）。

## 4. 一枚絵(発注 2 枚)

1536×1024、WebP。舞台に `contain` で全体が見える。

| スチルID | 場面 | 使う所 |
|---|---|---|
| `dragon` | 竜へのとどめ。火口の祭壇で討伐隊が火竜に最後の一撃を入れる瞬間。隊の人数は4人程度で顔は小さく(誰を連れて行くかはプレイヤー次第なので、特定のヒロインが目立たない構図に) | 終章の決着、終章の扉絵 |
| `prologue` | 実家の門と朝の街路の人物なし背景。人物・回転軌跡・砂煙は描き込まない。カイの回転・移動とティナの表示は既存の立ち絵を使う演出として別途実装する | 序章・記録タブの章一覧の小窓（今回は背景素材の差し替えまで） |

旧 `founding`(ギルドの看板)は新しい序章では使わないので削除する。他の章の扉絵は任意(今回は発注しない)。

## 5. 発注枚数のまとめ

| 種類 | 枚数 |
|---|---|
| 背景 | 4 |
| 立ち絵・主要人物 | 63（ヴィオラ2衣装、ガルド・アイリスのコートあり・なしを含む） |
| 立ち絵・竜の姿 | 1 |
| 立ち絵・汎用冒険者 | 12（男女×6性格×各1枚、neutralのみ採用） |
| 一枚絵 | 2 |
| **本表の合計** | **82（序章冒頭の追加3件は末尾参照。現行全体は85。旧汎用素材と未使用のhappyは別途保存）** |

## 6. 納品の形

- 元画像は PNG で `artifacts/source-art/backgrounds/`、`artifacts/source-art/characters/<id>/<表情>.png`、`artifacts/source-art/stills/`。
- 配布は WebP で `public/art/backgrounds/<背景ID>.webp`、`public/art/characters/<id>/<表情>.webp`、`public/art/stills/<スチルID>.webp`。
- 組み込み側の作業(発注とは別): `cast.json` に上記 id と `poses` を登録し、`art.json` に全枠を足してパスを書く。ヴィオラの斥候服は同じ id の `scout_*` ポーズとして持つ。食い違いは `npm test` が見つける。

## 追加素材（2026-10-14）

ガルドのコートなし版を2枚追加: `gald/coatless_neutral`（通常）、`gald/coatless_happy`（豪快な笑い）。既存の `neutral` / `happy` はコートありのまま保持する。512×1024、透過PNG・WebP。初回の明細78枚に追加して素材総数80枚。今回の範囲は素材作成までで、ゲームへの衣装切り替え登録は別工程。

## アイリスのコート返却後の差分（2026-10-21 登録確認）

`iris/coatless_neutral`（通常）と `iris/coatless_happy`（喜び）は、本もコートも持たない衣装差分。`cast.json` の `iris.poses` と `art.json` の `characters.iris` に登録済みで、立ち絵・顔アイコンとも配布ファイルが存在する。終章No.30で父にコートを返し、No.31・35で `coatless_happy` を使う。従来のコートあり差分は返却前に使うため保持する。追加2枚を上表に含め、序章冒頭の追加3件を含む現行全体は85枚。

## 竜と仲間思いの冒険者の修正（2026-10-14）

- `aurelia/dragon`: 二足直立を廃止。横向きの胴体・四足・背中の翼を持つ自然な姿勢。竜のみ1024×1024の透過素材とし、人物用512×1024仕様の例外。ゲームへの表示サイズ・顔切り出し調整は別工程。
- `adv_caring/neutral` / `happy`: ノエルとの類似を解消。黒い短髪、褐色肌、緑のシャツ、ベージュのベスト、橙のスカーフ、葉印の救急鞄に変更。ノエルは変更しない。

## カイの衣装変更（2026-10-14）

現代風の短いジャケット・ボタンシャツ・革靴を廃止し、素朴な村人風の服装へ変更。生成りの麻チュニック（襟元は紐留め、袖まくり）、革ベルトと小さな腰袋、茶系の布ズボン、柔らかい革ブーツ。通常・喜び・怒り・驚き・照れ・居眠りの6表情を同じ衣装で統一。旧デザイン画 `artifacts/source-art/characters/kai/design-tina-redraw-v1.png` と三面図は顔・髪の参考としてのみ使用し、衣装は新しい `artifacts/source-art/characters/kai/neutral.png` を優先する。

## 汎用冒険者の外見と職業の分離（2026-10-14、実装は別工程）

- 男女それぞれ6性格、各neutralの1枚のみ、計12枚。汎用キャラの表情差分は使用しない。
- キャラクター生成時に性別と性格から外見IDを決め、そのIDをセーブに保持する。表示時に現在の職業から画像を引かない。
- 転職・装備変更で外見IDを再抽選・変更しない。職業は名称・アイコン・能力表示で伝える。
- 現在のAdventurerには性別・外見IDが未導入。実装時には既存セーブにも一度だけ安定した値を補完して保存し、再読み込みで外見が変わらないようにする。
- 検証条件: 同じ人物が転職前後と保存・再読み込み後で同じ外見IDを使う。男女6性格の全12組を解決できる。
- 既存の性別なし素材は候補として保持。男女版はneutralのみ現行採用（12枚）。生成済みhappyは予備として保持。ゲームへの登録は未実施。

## 顔アイコンの最終工程（対応予定）

素材が固まった後、キャラ・衣装単位の顔範囲を保存し、必要な表情のみ個別補正する。その範囲から顔専用WebPを出力し、素材一覧とゲームで共通利用する。固定の上端650%切り出しを廃止し、48・58・76pxで目と口が収まることを確認する。現在は未実装。

## 男女別汎用素材の初回納品（2026-10-14、後に各1枚へ整理）

`adv_<性格>_male` / `adv_<性格>_female` の各neutral/happy、計24枚を生成済み。職業専用の武器・盾・薬道具を持たせず、旅装と表情・姿勢で性格を表現。全枚512×1024、透過PNG・WebP。12人分の対応表は `artifacts/source-art/generic-character-assets.json`、実行プロンプトは `story-batch-generic-male.json` と `story-batch-generic-female.json`。この時点の一覧は全92枚。その後、汎用happyを除外し現行80枚へ整理。旧汎用12枚は比較用に保存。顔の切り出し調整とゲーム組み込みは後工程。

## 汎用キャラを各1枚へ整理（2026-10-14）

汎用キャラは男女×6性格の12人、各neutralの1枚で十分とし、表情差分を現行仕様から除外。既存happy画像は削除せず予備として保持する。強欲な男性は顔の目・鼻・口・顎の間隔と成人としての比率を修正。強欲な女性は標準的な体格と胸元の開きを抑えたゆったりしたチュニックへ修正。修正版はneutralに反映し、予備のhappyは旧デザインのまま使用対象外。現行素材全80枚。

## 序章の冒頭の素材(2026-10-17、発注)

序章の展開改修(母との問答を追加)に合わせて3件。依頼書は `docs/plans/2026-10-17-codex-request-prologue-backgrounds.md`。

| 絵 | id / ファイル名 | 仕様 |
|---|---|---|
| 前世のオフィス | `bg_office_past` | 1536×1024。深夜の事務所、空の席、書類の山と点いたままのモニター。記憶に見えるよう他の背景より彩度を落とす。独白 No.1〜3 だけで使う |
| 実家の中 | `bg_home_morning` | 1536×1024。村人の家の居間、板の間に敷いたままの寝床、朝日、奥に玄関の木扉(ここから蹴り出される) |
| 母のシルエット | `mother` / `neutral` | 立ち絵 512×1024 と顔 256×256。顔の造作を描かない濃い墨色の影。三角巾・エプロン・腰に手、頭の周りに怒りの湯気。舞台には出さず、台詞枠の顔だけに使う |

2026-10-20 に納品・組み込み済み(`art.json` にパスを書いた)。素材総数 85、顔 77。
