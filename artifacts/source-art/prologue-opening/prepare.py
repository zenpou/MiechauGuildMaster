"""Rebuild only the eight prologue-opening deliverables from retained image_gen outputs."""
import json
import shutil
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'artifacts/source-art'
RAW = OUT / 'prologue-opening-work'
for name in ('bg_office_past', 'bg_home_morning'):
    source = OUT / 'backgrounds' / f'{name}.png'
    shutil.copy2(RAW / f'{name}-final.png', source)
    with Image.open(source) as image:
        assert image.size == (1536, 1024)
        image.save(ROOT / 'public/art/backgrounds' / f'{name}.webp', quality=85, method=6)

with Image.open(RAW / 'mother-neutral-final.png') as raw:
    assert raw.mode == 'RGBA'
    standing = raw.resize((512, 1024), Image.Resampling.LANCZOS)
regions = json.loads((OUT / 'faces/face-regions.json').read_text(encoding='utf-8'))
region = regions['mother']
x, y, size = (region[k] for k in ('x', 'y', 'size'))
assert 0 <= x < x + size <= 512 and 0 <= y < y + size <= 1024
face = standing.crop((x, y, x + size, y + size)).resize((256, 256), Image.Resampling.LANCZOS)
for category, image in (('characters', standing), ('faces', face)):
    source = OUT / category / 'mother/neutral.png'
    webp = ROOT / 'public/art' / category / 'mother/neutral.webp'
    for path in (source, webp):
        path.parent.mkdir(parents=True, exist_ok=True)
    image.save(source)
    image.save(webp, lossless=True, method=6, exact=True)
print('Prepared two backgrounds, mother standing art and its face crop (8 PNG/WebP files).')
