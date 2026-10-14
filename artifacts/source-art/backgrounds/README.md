# 背景素材 v1

2026-10-13。内蔵 image_gen で生成した会話シーン用背景5枚。原画1536×1024 PNG、配布用は同寸法のWebP（品質85）。既存キャラクターの暖色系ファンタジー画風に合わせた背景で、ユーザーによる最終採用確認は未記録。

| 素材 | 既存ゲームID | 新台本用ID |
|---|---|---|
| street-morning-v1 | town | bg_street_morning |
| guild-office-day-v1 | office | bg_guild_office |
| guild-reception-v1 | guild | bg_guild_reception |
| guild-office-night-v1 | night | bg_guild_office_night |
| guild-tavern-v1 | tavern | bg_guild_tavern |

- 配布先: `public/art/backgrounds/`。`src/data/art.json` に登録済み。
- `index.html`: 一覧。`npm run dev` 後、`/artifacts/source-art/backgrounds/index.html` で開くと、本番と同じ会話プレイヤーでも確認できる。PNGへのリンク付き。
- `batch-v1.json`: 生成時のプロンプト、生成元パス、夜差分の参照画像。
- `manifest-v1.json`: 寸法、ファイル容量、SHA-256、対応ID。
- `prepare-v1.py`: PNGの保存とWebPエンコード。クロップ・描画変更なし。Pillowが必要。保存済みPNGがあれば元の生成先への依存なし。

昼夜の執務室は同じ画像を元に照明だけを変更。背景の紋章・小物は装飾であり、正式な世界設定を追加するものではない。背景には人物を描き込まず、既存キャラクター原画は変更していない。

今回の対象外: キャラクター透過立ち絵・表情差分、ダンジョン背景、山村・学院・鍛冶の街、イベントスチル、竜形態。シナリオ本文の実装は既存の仮台本のまま。

## 検証

- `npm test`: 27ファイル・626テスト合格。
- `npm run build`: 合格。
- Chromeの1280×900 / 375×812で、実際の会話プレイヤーへ背景5枚を読み込み（計10場面）、各画像の寸法・読み込み成功を確認。本編の新規開始でも両画面幅で朝の街路を確認。
- `artifacts/backgrounds-review-v1/verification.json` と同フォルダのPNGに証跡を保存。PC執務室とモバイル序章等を目視確認。モバイルはブラウザーの画面幅での確認で、実機確認ではない。
- 再検証用 `verify-v1.cjs` はローカルVite（127.0.0.1:4194）と前作GuildQuestに導入済みのPlaywrightを使用する。このプレビューは開発用で、製品ビルドには含めない。
