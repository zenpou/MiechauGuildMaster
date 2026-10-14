"""Deterministically crop approved standing PNGs; never draw or regenerate faces."""
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/source-art'
baseline = json.loads((OUT / 'faces/previous-delivery-verification.json').read_text(encoding='utf-8'))
names = [r['id'] for r in baseline['assets'] if r['category'] == 'characters']
names += ['iris/coatless_neutral', 'iris/coatless_happy']
assert len(names) == len(set(names)) == 76
regions = json.loads((OUT / 'faces/face-regions.json').read_text(encoding='utf-8'))
for name in names:
    character, pose = name.split('/')
    base = regions[character]
    region = base.get('poses', {}).get(pose, base)
    x, y, size = (region[k] for k in ('x', 'y', 'size'))
    with Image.open(OUT / 'characters' / f'{name}.png') as source:
        assert source.mode == 'RGBA'
        assert x >= 0 and y >= 0 and size > 0 and x + size <= source.width and y + size <= source.height
        face = source.crop((x, y, x + size, y + size)).resize((256, 256), Image.Resampling.LANCZOS)
    png = OUT / 'faces' / f'{name}.png'
    webp = ROOT / 'public/art/faces' / f'{name}.webp'
    png.parent.mkdir(parents=True, exist_ok=True)
    webp.parent.mkdir(parents=True, exist_ok=True)
    face.save(png)
    face.save(webp, lossless=True, method=6, exact=True)

# Actual-size contact sheets: each row contains the 48, 58 and 76 px previews.
review = ROOT / 'artifacts/story-assets-review/faces'
review.mkdir(parents=True, exist_ok=True)
for page in range((len(names) + 19) // 20):
    subset = names[page * 20:(page + 1) * 20]
    sheet = Image.new('RGB', (1100, ((len(subset) + 3) // 4) * 126), '#dce2e7')
    draw = ImageDraw.Draw(sheet)
    for index, name in enumerate(subset):
        left, top = (index % 4) * 275, (index // 4) * 126
        draw.text((left + 4, top + 2), name, fill='#172030')
        face = Image.open(ROOT / 'public/art/faces' / f'{name}.webp').convert('RGBA')
        offset = 4
        for size in (48, 58, 76):
            thumb = face.resize((size, size), Image.Resampling.LANCZOS)
            sheet.paste(thumb, (left + offset, top + 20), thumb)
            draw.text((left + offset, top + 100), str(size) + 'px', fill='#172030')
            offset += size + 14
    sheet.save(review / f'faces-{page + 1}.png')
print(f'Cropped {len(names)} faces, PNG + lossless WebP; review sheets in {review}')
