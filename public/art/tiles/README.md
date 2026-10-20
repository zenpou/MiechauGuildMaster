# 探索用マップチップ

`dungeon-terrain-v1.png` は2026-10-20に組み込みの image_gen で新規生成した原画。
1024×1536、4列×6テーマ。既存画像を上書きしていない。

行は森の洞窟、古い坑道、廃れた塔、凍てつく谷、沈んだ遺跡、竜の寝床。
各行の列は床A、床B、壁A、壁B。生成画像の区画は完全な等間隔ではないため、
`src/ui/dungeonArt.ts` で各区画内の224px四方を指定して表示する。原画の加工・切り分けはしていない。
顔チップは `public/art/faces/` の既存の人物別・汎用12種を使用する。

生成プロンプト:

> Production 2D top-down dungeon tile texture atlas for a Japanese fantasy guild management game.
> One portrait 1024x1536 image, four columns by six rows, no labels, text, characters, or UI.
> Each row has simple floor A, varied floor B, solid wall A, solid wall B.
> Rows: moss and roots in forest cave; gravel, wooden sleepers and copper ore in old mine;
> cracked gray masonry in ruined tower; snow and blue ice in frozen valley;
> teal wet masonry and aquatic moss in sunken ruins; dark basalt and dim orange ember seams in dragon lair.
> Consistent overhead light from upper-left, restrained detail, readable at 24–40px.
> Floors lighter and simpler than walls. No margins or watermark.

色と素材は場所の目印。地形の通行可否・資源・敵・戦利品のルールは `src/data/dungeons.json` に従う。
