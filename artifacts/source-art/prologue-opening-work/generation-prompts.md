# 序章冒頭素材 生成記録

Built-in `image_gen` を使用。参照画像は `guild-office-day-v1.png`（背景の線・塗り）、`tina/design-approved-v1.png`（人物のセル影・輪郭）、`kai/neutral.png`（生活水準・衣装）を目視確認した。

## bg_office_past（最終）

Use case: illustration-story / Asset type: game background, 1536x1024 landscape.
Modern Japanese office cubicle island late at night, empty of people; foreground desk with paper stack, cold blue-white monitor, unbranded energy drink can, stomach-medicine box, crooked keyboard, empty chair; night city lights through windows; blurred wall clock just after midnight; partly switched-off fluorescent lights. Hand-painted anime visual-novel background matching guild-office-day-v1, fine contours and restrained painterly shading. Central composition for 375px crop, low-detail edges, desaturated gray-blue memory mood, no readable text/logos/watermark.

修正プロンプト: 候補の全要素を維持し、壁時計の針だけ短針を12付近・長針を2付近（約00:10）へ変更。文字盤は無数字でぼかす。

## bg_home_morning（最終）

Use case: illustration-story / Asset type: game background, 1536x1024 landscape.
Modest tidy rural village home, empty; wooden/packed-earth floor, beams, plaster, shelves with farming tools and cooking pots, hanging herbs; morning diagonal light; partly open wooden entrance door at center-right; foreground straw futon and blanket with discarded jacket directly on the floor. Hand-painted anime visual-novel background matching guild-office-day-v1, warm textured wood/plaster, central framing for 375px crop, open right foreground for character, no text/logos/watermark.

修正プロンプト: 候補の全要素を維持し、左手前の木製ベッド枠・脚・ヘッドボードを除去。藁布団と毛布、脱ぎ捨てた上着を板床へ直接敷く。

## mother / neutral（最終）

Use case: illustration-story / Asset type: transparent game character sprite, 512x1024 portrait.
Full-body short stocky angry village mother on true transparent background; featureless near-black charcoal silhouette with subtle warm-gray rim highlight; hair tied under triangular headscarf, apron, rolled sleeves, both hands on hips, two or three small steam puffs/sparks; clean anime contours and restrained cel shading matching Tina; head near top and feet visible; no scenery/text/logo/watermark. Must remain readable at 48px.

修正プロンプト: 候補のシルエット・頭巾・エプロン・湯気・透過・配置を維持し、画面左の上げた腕だけ腰へ下ろし、両手を腰に当てる。

## 最終候補

- `bg_office_past-final.png`
- `bg_home_morning-final.png`
- `mother-neutral-final.png`
