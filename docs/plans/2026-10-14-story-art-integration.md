# 物語の画像素材の仕様変更と、組み込みに必要な対応(2026-10-14)

Codex が素材生成の過程で変えた仕様(汎用キャラの男女化、カイの衣装、ガルドのコートなし版、竜の四足・1024×1024、序章スチルの背景化、顔切り出しの個別化)を最新として、既存の設計書・エンジンとの食い違いと、組み込みの作業を整理する。

素材の正本: `docs/art/STORY-ASSETS.md`(先頭の決定事項の表が最新。末尾の履歴節は経緯)。現行素材の一覧は `artifacts/source-art/story-assets-verification.json`(80枚)、汎用キャラの対応表は `artifacts/source-art/generic-character-assets.json`。

## 1. Codex が設計書・台本に加えた未コミットの変更(レビュー)

| 変更 | 判定 |
|---|---|
| `gard.md`→`gald.md`、`luu.md`→`ruu.md` に改名(中身は同じ)。素材 id と揃えた | 採用 |
| 第四章の解放条件を「依頼5件」→「累計依頼10件」に(PLOT・STORY・CHARACTERS・fine.md・ch4 文章版) | 採用。ただし CHARACTERS は「案」から「決定」扱いに変わっているので、ユーザーの確認が要る |
| カイの呼称に「加入後の仲間には名前呼び捨て・『お前』『お前ら』も使う」を追加(RULES・kai.md・CHARACTERS) | **決定の変更**。第五章の「おい、お前ら」を正当化するための追記。許容するなら採用、しないなら第五章を直す |
| 第五章の指示を「ヴィオラたちタンクは」「攻撃役と斥候は」と役割一般に書き換え | 採用。出撃メンバーがプレイヤー次第である点と整合する |
| セラの一人称「私」→「セラ」(CHARACTERS・sera.md)、ノエル「私」→「わたし」(PLOT・noel.md・ch1) | 採用。前回の指摘の取りこぼし |
| 第二章シーン3・第三章の背景を `bg_guild_office_sunset` に | 採用 |
| 第二章の立ち絵に「斥候服」「鎧」の注記、文章版の「兜」→「肩当て」 | 採用(素材は兜なし) |
| 終章の素材名に「脱皮の抜け殻」を足す、「カイ様」→「カイさま」 | 採用 |
| **第二章文章版「帰還したその日」**(前は「数日後」) | **差し戻し**。拠点↔山村は片道1日で日帰りできない |
| **終章文章版「討伐隊が無事に帰還した昼下がり」「さきほどの戦士たち」** | **要修正**。竜の寝床から拠点は2日以上。アウレリアの来訪を帰還と同時にするなら「帰還した日の昼下がり」「先日の戦士たち」程度に |

## 2. 新しい素材仕様と既存の文書・エンジンの食い違い

### 2-1. 文書

| 箇所 | 食い違い | 対応 |
|---|---|---|
| `docs/art/PLACEHOLDER.md` | 立ち絵は一律 512×1024、顔は同じ絵の上部を切り出す、と書いてある | 竜の 1024×1024 の例外、顔は別ファイルで持つ方式、ヴィオラの `scout_*` ポーズ、汎用の `adv_<性格>_<性別>` を追記 |
| `STORY-ASSETS.md` §1「手元にあるもの」「一枚絵 0」 | 初期状態の記述が残り、§3 の「生成済み」と矛盾 | 「現行仕様」と「履歴」に節を分けるか、履歴を `STORY-ASSETS-DELIVERY.md` へ移す |
| RULES 3-4「汎用キャラは性格タイプ別の台詞テーブル」 | 台詞は性格別、絵は性格×性別、表情は neutral のみ | RULES に「汎用は表情差分を持たない。台詞の感情は文で出す」と明記 |
| 終章台本 44・45・53・54 行「汎用冒険者 (中央 / 喜び)」 | 汎用に `happy` は無い(予備で登録しない) | `通常` に直す |
| 終章台本のガルド「通常 / 喜び」 | 終章の時点でコートはアイリスが羽織っている | 目覚めはコートなし版で始め、アイリスがコートを返す行からコートあり版に切り替える(§4-3)。アイリスは返した後コートなし版(素材追加) |
| 序章スチル `prologue` | 人物なしの「実家の門と朝の街路」になり、実質は背景 | 序章シーン1(門前)の背景としても登録する(`bg_street_gate` など)。既存の `bg_street_morning` はシーン2(大通り)に使う。扉絵としては `stills.prologue` のまま使える |
| `docs/CHARACTERS.md` の採用画像リンク | `artifacts/characters/` は gitignore 対象でリンク切れ | **済**。リンクを `artifacts/source-art/characters/<id>/design-*.png`(採用画の元ファイル。写しと SHA256 一致)に書き換え、三面図13枚を同フォルダへ複製。写しは手元だけ(§4-5) |

### 2-2. エンジン・データ

| 箇所 | 現状 | 必要な対応 |
|---|---|---|
| `src/data/cast.json` | 仮の3人(master / clerk / unique) | kai, tina, iris, noel, sera, viola, ruu, fine, aurelia, gald を登録。`poses` は素材どおり(viola は `scout_*` 4つを含む10、gald は4、aurelia は人型5+`dragon`)。声だけの「母」と、終章27の「全員」も話し手なので cast に要る(絵は null)。`tests/story.test.ts` が話し手名と cast の一致を検査する |
| `src/data/art.json` | 旧キー + 新背景の一部。`founding` が残る | 全人物・全ポーズの枠と `public/art/characters/<id>/<pose>.webp` のパス、新背景4枚、`bg_guild_hall`→`guild-reception-v1.webp` の流用、`stills.prologue` / `stills.dragon`。`founding` と旧キー(guild / town / night / tavern / office)は story.json を書き換えたら削除 |
| `src/core/presentation.ts` の `MOTIONS` | spin-out / hit / tremble が無い | RULES 3-2 の追加予定どおり3つ足し、`storyPlayer.css` にアニメーションを書く。効果音 `slash` / `blow` / `roar` / `flame` も `SOUND_CUES` と `storyAudio.ts` に追加 |
| `storyPlayer.css` の立ち絵表示(`height: 280%`、上端基準) | 全人物に同じ倍率。竜(1024×1024)は横長に見えるべきなのに縦長の枠に合わされる | 人物ごとの表示設定(`data-character` で倍率・基準位置を上書き)。竜は専用の倍率と位置 |
| `storyPlayer.css` の顔(`height: 650%`、上端中央) | ティナのポニーテール、ヴィオラの鎧で顔が切れる(Codex の一覧で確認済み) | **顔は別ファイルにする**。`public/art/faces/<id>/<pose>.webp`(256×256、48/58/76px で目と口が収まることを確認済み。**納品済**)を使い、`art.json` の各ポーズを `{ "image": …, "face": … }` の形にするか `faces` の表を別に持つ。`storyPlayer.ts` の顔表示を切り出しから単純な画像表示に変える。`tests/story.test.ts` の art.json 検査も更新 |
| `Adventurer` 型(`src/core/types.ts`) | 性別・外見IDが無い | `gender: 'male' \| 'female'` と `appearance: string`(`adv_<性格>_<性別>`)を足す。`generateAdventurer` で `rng` から決めて保存。転職・装備・再読み込みで変えない(表示時に職業から引かない) |
| `src/core/save.ts` | `SAVE_VERSION = 1` | 2 に上げ、読み込み時に `gender` / `appearance` が無い冒険者へ `hash(seed, 'appearance', adv.id)` から一度だけ補完して保存(決定論の方針どおり `Math.random` は使わない) |
| ユニーク冒険者 | `uniques.json` は仮の1人 | 10人分を書くとき `appearance` を人物 id(tina など)にする。汎用の抽選対象から外す |
| 汎用冒険者の台詞(終章の意気込み・勝利) | 話し手は実際の冒険者名(アルド等)で、cast.json に静的に書けない | ボス戦の紙芝居は章の台本とは別の仕組み(戦闘ログ→台詞表)。話し手名と絵(`appearance`)を実行時に組む拡張が要る。章の台本の検査ルールをそのまま当てない |
| 名簿・候補・派遣画面 | 顔の表示が無い | 顔ファイルができたら、名簿カード・候補一覧に `appearance` の顔を出す(任意。物語の組み込みとは分けてよい) |

### 2-3. 配布フォルダの中身

- `public/art/` は 31MB。うち現行外(性別なしの旧 `adv_*` 12枚と、男女版の `happy` 12枚)が 24ファイル 6.2MB。配布に含めない方針なら `artifacts/source-art/revisions/` へ移す。
- `artifacts/source-art/` は 168MB で、gitignore の例外なのでそのままコミット対象。`revisions/`(15MB)と `tina-design-ideas*`(11MB)は履歴なので、リポジトリに入れるかどうか判断する。

## 3. 組み込みの順序(案)

1. **文書の整え**: §1 の差し戻し2件、§2-1 の表を反映。`STORY-ASSETS.md` を現行仕様と履歴に分ける。
2. **顔ファイルの切り出し**(Codex): 全ポーズの顔範囲を決めて `public/art/faces/` に出力。竜も含む。これが無いと台詞枠が崩れる。
3. **エンジン拡張**: 演出3種+効果音4種、人物別の表示倍率、顔を別ファイルで読む、`art.json` の形の変更とテスト更新。
4. **cast.json / art.json / story.json**: 7章を書き起こす。解放条件は PLOT の `all` 形式。旧キーと `founding` を消す。
5. **冒険者の性別・外見ID**: 型・生成・セーブ移行・名簿表示。物語とは独立に進められる。
6. **ボス戦の紙芝居**: 戦闘ログ→台詞表→実行時キャスト。第一部完の見せ場なので最後。
7. `npm test`、`npm run build`、`npm run test:browser`、実機(スマートフォン幅)で立ち絵と顔の収まりを確認。

## 4. 決定(2026-10-14)

1. **カイの呼称**: 「お前」「お前ら」は第五章(竜に挑む段取り)以降だけ。第四章までは仲間にも「あんた」。RULES・kai.md・CHARACTERS に反映済み。
2. **第四章の解放条件**: 第三章読了 + 累計依頼10件で決定。sim 30 seed で紋章の時点の最小が10件(VERIFICATION 2026-10-14)。依頼を受けない遊び方で止まるならテストプレイ後に7〜8件へ。
3. **ガルドのコート**: 終章の目覚めはコートなし版(`coatless_*`)で始め、アイリスが「お父様、これ……」とコートを返す一拍を台本に足し、その行からガルドをコートあり版(`neutral` / `happy`)に、アイリスをコートなし版に切り替える。
   - 台本の追記は Antigravity。終章シーン3のガルド登場〜称賛の間に2〜3行。
   - **済**: 台本の追記(終章30〜31行目)、アイリスの `coatless_neutral` / `coatless_happy`、顔専用 WebP 76枚(`public/art/faces/<id>/<pose>.webp`、256×256 透過、範囲は `artifacts/source-art/faces/face-regions.json`)。現行素材は82枚。
   - `cast.json` の iris の poses に `coatless_neutral` / `coatless_happy` を足す。

4. **配布フォルダと履歴**: `public/art/` は現行素材だけ。現行外の汎用24ファイル(旧 `adv_*`、男女版の `happy`)は配布WebP・元PNGとも `artifacts/source-art/revisions/generic-unused/` へ移動。`revisions/` と `tina-design-ideas*` は `.gitignore` に足し、手元だけに置く。`verify-story-assets.py` は移動済みファイルを「moved」と数える。
5. **採用デザイン画**: `artifacts/characters/` は `source-art` の元ファイルの写し(SHA256 一致)なので管理しない。CHARACTERS.md などのリンクを元ファイルへ書き換え、三面図13枚(元が写し側にしか無かった)を `artifacts/source-art/characters/<id>/` へ複製してコミット対象にした。

## 5. ユーザーに確認したいこと(残り)

(なし。5件とも決定済み)

