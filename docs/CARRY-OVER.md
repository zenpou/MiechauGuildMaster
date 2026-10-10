# GuildQuest から新リポジトリへ持ち込むもの

> 仕分けで「残す」と判定したコードと手順。パスは GuildQuest リポジトリ基準。
> 持ち込みは「コピーして新ルールに合わせて書き直す」が基本。そのまま動くことは期待しない。

## そのまま持ち込めるもの

| ファイル | 内容 | 注意 |
|---|---|---|
| `src/core/rng.ts` | mulberry32、`hash(seed, タグ, カウンタ)` 派生、`rngFor` | 変更不要(2026-10-10 持ち込み済み) |
| `src/core/save.ts` + `src/ui/shared.ts` の load/save | 前作の `save.ts` は移行関数のみで、保存処理は `ui/shared.ts` にあった。新作は `core/save.ts` に Storage 風の口を渡す形でまとめ、DOM非依存にした(2026-10-10 持ち込み済み) | — |
| `src/core/relations.ts` | 2人ごとの関係値、性格の相性から初期値、ラベル | 性格IDを新作のものに |
| `src/ui/dom.ts` | `h()` / `div()` の小さなDOMヘルパ | 変更不要(2026-10-10 持ち込み済み) |
| `src/ui/storyPlayer.ts`, `storyPlayer.css`, `storyAudio.ts` | 紙芝居プレイヤー(背景・立ち絵・ポーズ・位置・SFX・タイプライター・履歴・スキップ・reduced-motion) | 台本JSONの形式(`campaign-story.json` の行構造)も踏襲する |
| `src/ui/pwa.ts`, `scripts/pwa-plugin.ts`, `public/manifest.webmanifest` | Service Worker 生成、更新ボタン、オフライン | アプリ名とアイコンを差し替え |
| `scripts/browser-check.cjs`, `scripts/ui-review-check.cjs` | Playwright で PC/スマホ幅・保存・offline・PWA更新を検証する手順 | シナリオは書き直し。骨組みと起動方法だけ流用 |
| `scripts/export-story.cjs` | 台本JSONから通読用 Markdown/HTML を再生成 | 台本形式を踏襲すれば流用可 |
| `tsconfig.json`, `vite.config.ts`, `package.json` の scripts | 設定 | `story.html` の入口は不要なら外す |
| `.gitignore` | `artifacts/*` を無視し `source-art` だけ管理する方針 | そのまま |

## 骨を使って書き直すもの

| ファイル | 流用する考え方 | 書き直す点 |
|---|---|---|
| `src/core/combat.ts` | 速度順ターン制、命中=速度差、会心8%、スキルCT、かばう、回復薬の自動使用、敵AI 3種、撤退・全滅 | 装備の能力加算、属性耐性、ボスの復活、シンボルモンスター |
| `src/core/adventurer.ts` | 8能力、適性係数 0.65〜1.35、疲労係数、日給式、生成(本来職と40%のミスマッチ)、経験値 40×Lv | 下級→上級の転職、スキル、装備枠、趣味・好き嫌いの生成、忠誠の見える式 |
| `src/core/expedition.ts` | 出発時に全行程を決定論的に確定、帰還日に開示。撤退しきい値=方針+隊長の性格×0.6+疲労。帰還時の負傷・経験値・特性判明・関係値 | 「1日3ステップのイベント抽選」を「マス移動」に置き換える。踏んだマスの種類でイベントが決まる |
| `src/core/game.ts` | `advanceDay` の順序(給与→支援金→赤字→日送り→帰還→回復→辞職→候補入替→評判節目→個人イベント→勘違い)、台帳、通知 | 工房の進行、建設の進行、依頼の締め切り判定、受信箱、ワールド移動 |
| `src/core/scenes.ts`, `src/data/misunderstandings.json` | 行動タグ→抽選→噂→評判+主人公の本音 | 台詞は全部新規 |
| `src/core/readiness.ts` | 同条件で80回試算して成功率と負傷を出す見込み表示 | 未踏部分は「不明」と出す |
| `src/core/autoplay.ts`, `scripts/sim.ts`, `scripts/playstyles.ts` | bot で N seed × N日を回し、クリア率・所持金・初挑戦日を比べる | 新ルールの判断を書く。遊び方の軸は「隊の数」「施設の有無」「探索率を上げるか」 |
| `src/data/personalities.json`, `traits.json`, `policies.json` | 性格6・特性11・方針6の定義 | 性格に探索挙動の係数を足す。特性は増やす |
| `tests/*.test.ts` | 回帰の書き方(決定論性、境界、一定seed群のクリア率) | 全部新規 |

## 持ち込まないもの

- `src/data/characters.json`, `campaign-story.json`, `story-prologue.json`, `charevents.json`, `dialogue.json`, `outcome-dialogue.json`, `story.json`(未使用の旧稿)
- `public/art/**`, `artifacts/source-art/**`(新キャストで作り直す)
- `src/ui/variants/**`(旧UI案 hall/pocket)
- `src/core/campaign.ts`(6日間の段階解放。新作のチュートリアルは別に設計)
- `docs/characters/**`, `docs/STORY-*.md`

## 手順として流用するもの

- 画像生成の2段階(設定資料 → 3ポーズのアトラス → Sharp で機械的に分割)と、`reference.webp` を以後の正本にする運用。プロンプトの書式は `docs/art/CAST-PROMPTS.md`, `BACKGROUND-PROMPTS.md`, `docs/ART-PROMPTS.md` を見本にする
- 検証記録 `docs/VERIFICATION.md` の書き方(日付、変更、計測値、実行したコマンド、未確認事項)
- GitHub Pages への自動配置 `.github/workflows/deploy-pages.yml`
