# 見えちゃうギルドマスター

冒険者の才能が「見える」ギルドマスターになって、冒険者を集め、隊を組み、各地のダンジョンへ送り出す、ターン制のギルド経営シミュレーション。
派遣の結果は出発した時点で決まり、帰還の日に分かる。冒険者は死なず、ゲームオーバーも無い。最奥の竜を倒すのが第一部の終わり。

TypeScript / Vite / 素のDOM / Vitest / PWA。外部の実行時依存は無い。

## 動かす

```sh
npm install
npm run dev          # http://localhost:5173(スマホから見るときは npm run dev -- --host で、同じ Wi-Fi の http://<PCのアドレス>:5173)
npm test             # 単体テスト(Vitest)
npm run build        # 型検査 + 本番ビルド(dist/。sw.js と manifest も出る)
npm run preview      # ビルドの確認
npm run test:browser # ビルド済みの画面を Playwright + インストール済み Chrome で通す
```

セーブはブラウザの localStorage(キー `miechau-guild-master.save.v1`)。スマホは「ホーム画面に追加」で、オフラインでも遊べる。

## 数値を測る

バランスは体感で変えず、bot で測ってから変える。結果は [docs/VERIFICATION.md](docs/VERIFICATION.md) に日付つきで残す。

```sh
npm run sim -- 20 30                      # 森の洞窟だけを回す(20 seed × 30 日)
npm run sim:styles                        # 依頼・メールの遊び方の違い(締め切り優先・放置・返信など)
npm run sim:boss                          # ボス戦の勝率(基準の隊の Lv × 装備の段)
npm run sim:dragon -- 30 200              # 竜まで攻める bot(30 seed × 最大 200 日)。討伐日の分布と、止まった理由
npm run sim:dragon -- 30 200 --rich       # 同・経済を切り離し、進みの速さだけを測る
npm run sim:dragon -- 30 200 --set tuning.growth.wageSlope=0.2    # 数値をメモリ上で上書きして試す
npm run sim:dragon -- --seed 1 100 --dump artifacts/fixtures/day100.json    # 途中のセーブを書き出す(画面の確認用)
```

調整する数値は `src/data/tuning.json`。コードに数値を埋めない。

## 構成

| 場所 | 中身 |
|---|---|
| `src/core/` | DOM に触れない純ロジック。乱数はすべて `rng.ts` から(同じ seed・入力なら同じ結果) |
| `src/data/` | 職業・性格・敵・ダンジョンの地図・施設・依頼・台詞・台本などの JSON |
| `src/ui/` | 画面。素の DOM。フレームワークは使わない |
| `scripts/` | 計測 bot、ブラウザ検証、PWA プラグイン |
| `tests/` | Vitest |
| `docs/` | 設計・計画・検証記録 |

## ドキュメント

- 設計の正本: [docs/DESIGN.md](docs/DESIGN.md)
- 実装順と進み具合: [docs/ROADMAP.md](docs/ROADMAP.md)
- 検証と計測の記録: [docs/VERIFICATION.md](docs/VERIFICATION.md)
- 前作 GuildQuest からの持ち込み: [docs/CARRY-OVER.md](docs/CARRY-OVER.md)
- 絵の差し替え方: [docs/art/PLACEHOLDER.md](docs/art/PLACEHOLDER.md)
- 作業の方針(AI と一緒に進めるときの約束): [CLAUDE.md](CLAUDE.md)

## 状態

フェーズ0〜6が完了(竜の討伐まで遊べる)。フェーズ7(物語と見た目)は仕組みを先に作り、台本・キャスト・画像はすべて仮で、あとから差し替える。
