# マップ専用の顔アイコン

`tina-v1.png` は2026-10-20に組み込み image_gen で生成。
`public/art/faces/tina/neutral.webp` を人物の参照にして、頭全体の独立したアイコンとして描き起こした。
既存の会話用の顔・立ち絵は変更していない。本体の探索観察用として、固有5人・汎用12外見の専用の頭アイコンを用意した。

| ファイル | 内容 |
| --- | --- |
| tina-v1.png | ティナ |
| unique-heads-v2.png | 左上セラ、右上ヴィオラ、左下ルゥ、右下フィーネ |
| adventurer-heads-a-v1.png | 左上勇敢女性、右上勇敢男性、左下慎重女性、右下慎重男性 |
| adventurer-heads-b-v1.png | 左上強欲女性、右上強欲男性、左下仲間思い女性、右下仲間思い男性 |
| adventurer-heads-c-v1.png | 左上臆病女性、右上臆病男性、左下自信家女性、右下自信家男性 |

すべて組み込み `image_gen` を使用。画像自体は加工せず透過PNGを保存し、`src/ui/mapFaceData.ts` に頭全体と余白を含む表示領域を定義した。`unique-heads-v1.png` は余白調整前の初版で、本体は参照しない。見た目の一覧は開発サーバーの `/docs/previews/map-face-gallery.html`。

生成プロンプト:

> Dedicated transparent RPG map leader HEAD ICON. Preserve Tina's red hair, longer side locks,
> amber eyes, cheek bandage and confident cheerful expression from the reference.
> Entire hair silhouette inside the frame; head only, no neck, shoulders, collar, torso, background,
> circular frame, badge or text. Front view with a tiny hint of three-quarter direction.
> Broad readable cel-shaded shapes suitable for 32–48px, crisp dark outline and subtle pale rim,
> opaque head and transparent background. The icon should feel like a character game piece.

追加画像の生成プロンプト（共通）:

> ONE transparent PNG game sprite atlas with EXACTLY FOUR independent head-only chibi icons.
> Image1 is STYLE reference (Tina) not an output character. Images2–5 are identities to redraw.
> Match Tina clean anime chibi large eyes, simple 2tone hair, crisp dark outlines, readable at48px.
> Reconstruct WHOLE hair, complete silhouette; NO neck, shoulders, torso, hands, circles, frames,
> text, grid lines, drop shadows. Preserve identity, hair color, gender and facial hair.
> STRICT ORDER 2columns by2rows. CRITICAL small isolated stickers with VERY WIDE transparent space
> between heads, at least35% cell width empty gap. Icon bounds at most60% each cell.
> Include ALL hair tips. Don't enlarge heads to fill empty space. Exactly four separate heads,
> never touch or intrude into neighboring cell bounding boxes. Square canvas.

人物指定（各行左上、右上、左下、右下の順）。人物の参照は同名の既存 `faces/*/neutral.webp`:

- 固有: Sera (pink bob, side braid), Viola (long navy blue hair, blue eyes), Ruu (dark purple-black messy short hair, golden eyes), Fine (golden long hair, brown eyes).
- A: brave female (short chestnut red hair, warm brown eyes), brave male (brown spiky hair), cautious female (navy bob), cautious male (navy messy short hair).
- B: greedy female (copper wavy ponytail, confident mischievous grin), greedy male (curly brown hair, dark MUSTACHE), caring female (short dark brown hair, warm tan skin, kind eyes), caring male (brown tied hair, short BEARD and mustache, warm tan skin, kind mature face).
- C: timid female (ash brown hair tied behind, loose wisps, worried gray eyes), timid male (very short sandy blond hair, worried blue eyes), proud female (long black hair ponytail, dark eyes, composed), proud male (silver long hair, gray eyes, composed).

固有v2の編集指示（参照はv1のみ）:

> Preserve these exact FOUR head-only anime icons, their identities, colors, expressions and 2x2 order.
> ONLY change layout/spacing: shrink all heads to roughly60% of their present size and CENTER each in its
> square quadrant, leaving a VERY WIDE clear transparent cross-shaped gap between rows and columns
> (at least20% of entire canvas width). Keep full hair silhouettes, no clipping.
> All FOUR heads separated with no overlap of bounding boxes. Real transparent background.
> No extra icons, no text, no necks/shoulders, no grids, no frames. Equal-size square canvas.
