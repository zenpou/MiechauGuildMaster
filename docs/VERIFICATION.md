# 検証記録

> 日付・変更・計測値・実行したコマンド・未確認事項を上から新しい順に追記する。

## 2026-10-10 フェーズ0: 土台

### 変更

- 設計: DESIGN.md 第6節(役割5・下級5→上級5の五角形・性格の探索挙動・忠誠0〜255・メール10種・ユニーク6人)と第7節(街=拠点+街2+村1・依頼のテンプレート生成+解放依頼・締め切り倍率・実績30)を確定
- 土台: `package.json` / `tsconfig.json` / `vite.config.ts`(PWAプラグインはフェーズ7で)/ `.gitignore` を前作から流用
- 持ち込み: `src/core/rng.ts`(そのまま)、`src/ui/dom.ts`(そのまま)
- 新規: `src/core/types.ts`(新作の型一式)、`src/core/state.ts`(空の初期状態)、`src/core/save.ts`(Storage 風の口を渡す保存・読み込み・移行)、`src/core/data.ts`、`src/data/jobs.json`(10職)、`src/data/personalities.json`(6性格+探索係数の初期値)
- 入口: `index.html` + `src/ui/main.ts`(職業表と性格表を出すだけの確認画面)

### 計測

| 項目 | 値 |
|---|---|
| `npm test` | 13件 / 1ファイル すべて通過 |
| `tsc --noEmit` | エラー0 |
| `vite build` | 12 modules、JS 8.74 kB (gzip 3.67 kB) |

### 実行したコマンド

```sh
npm install
npm test
npm run build
```

### 未確認

- `npm run sim` / `sim:styles` はスクリプト未作成(フェーズ1で `scripts/sim.ts` を書く)
- `jobs.json` の statMult と `personalities.json` の探索係数は仮の値。フェーズ1〜2の sim で調整する
- ブラウザ表示: `npm run dev`(port 5173)で職業10行・性格6行の表が出て、コンソールエラーなしを確認。Playwright のブラウザ検証はフェーズ7で持ち込む
