# 見えちゃうギルドマスター 作業方針

ギルド経営×ダンジョン探索のターン制シミュレーション。リポジトリ名は `MiechauGuildMaster`。GuildQuest(第一部)の設計を踏襲した新規プロジェクト。
設計の正本は `docs/DESIGN.md`、仕分けは `docs/reference/TRIAGE.md`、流用元の一覧は `docs/CARRY-OVER.md`、実装順は `docs/ROADMAP.md`。

## 言語

返答・コミットメッセージ・設計書・コメントは日本語。識別子は英語。

## 構成

- `src/core/` DOM非依存の純ロジック。ここに `document` や `window` を書かない
- `src/data/` JSON定義(職業・性格・特性・敵・ダンジョンマップ・施設・依頼・台詞)。数値はコードに埋めずここへ
- `src/ui/` 画面。素のDOMと `dom.ts` のヘルパのみ。フレームワークは入れない
- `scripts/` 計測(`sim.ts`, `playstyles.ts`)、ブラウザ検証、PWAプラグイン
- `tests/` Vitest。`npm test` で全部回る
- `docs/` 設計・検証記録。`docs/VERIFICATION.md` に日付付きで追記
- `public/art/` 配布画像(WebP)、`artifacts/source-art/` 元画像(PNG)。`artifacts/` のそれ以外は無視対象

## 守ること

- **決定論**: 乱数はすべて `rng.ts` の `hash(seed, タグ, カウンタ)` から派生させる。同seed・同入力・同結果。`Math.random` 禁止
- **出発時確定**: 派遣・移動・探索・戦闘の結果は出発時に全部シミュレートし、帰還日に開示する。日送り中に乱数を引き直さない
- **死なない**: 冒険者は死亡しない。全滅は負傷・救助費用・素材喪失で表す。ゲームオーバーも作らない
- **期限は依頼単位**: ゲーム全体の日数制限を入れない
- **数値調整は計測で**: バランスを変えるときは `npm run sim` / `sim:styles` の前後比較を `docs/VERIFICATION.md` に残す。体感だけで変えない
- **隠さない**: 施設シナジー、探索率、忠誠の変動ルールはゲーム内で見える形にする
- **セーブ互換**: `GameState` に項目を足すときは読み込み時の既定値を書く。版番号を上げたら移行処理を書く

## 実装方針

- **書き分け**: コードには How、テストコードには What、コミットログには Why、コードコメントには Why not(なぜ別の方法を取らなかったか)。コメントで How を繰り返さない
- **TDD(t-wada 方式)**: 先にテストリストを書き、1つ選んで Red → Green → Refactor。Green は仮実装でよく、三角測量で一般化してから明白な実装へ。1サイクルは小さく、Green ごとにコミットしてよい
- **テストプレイで調整**: テストプレイを何度も行い、違和感を見つけたら sim で裏を取ってから数値を変える。テストプレイの記録(seed・日数・気になった点・変えた値)も `docs/VERIFICATION.md` に残す

## 検証

```sh
npm test
npm run build
npm run sim -- 100
npm run sim:styles
```

ブラウザ検証はインストール済み Chrome を Playwright で使う(`npm run test:browser`)。通常のブラウザセーブには触れない。

## 委譲

- 調査・仕様確認は `sonnet-explore`、手順の決まった実装は `sonnet-impl`。設計判断・バランス調整・難バグは本体で行う
- 委譲した結果はテストを本体で再実行し、`git diff` を読んでから取り込む。コミットは本体が行う
