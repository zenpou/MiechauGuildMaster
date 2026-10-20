"""Render prologue delivery proofs and audit the preserved pre-task files."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).resolve().parent
ART = ROOT / 'public/art'

sheet = Image.new('RGB', (1200, 1250), '#e4e7eb')
draw = ImageDraw.Draw(sheet)
for index, name in enumerate(('bg_office_past', 'bg_home_morning')):
    scene = Image.open(ART / 'backgrounds' / f'{name}.webp').convert('RGB')
    x = index * 600
    draw.text((x + 12, 12), name + ' / full frame', fill='#172030')
    sheet.paste(scene.resize((576, 384), Image.Resampling.LANCZOS), (x + 12, 34))
    draw.text((x + 12, 432), '375 x 480 / center cover crop', fill='#172030')
    sheet.paste(ImageOps.fit(scene, (375, 480), Image.Resampling.LANCZOS), (x + 12, 456))

face = Image.open(ART / 'faces/mother/neutral.webp').convert('RGBA')
for index, bg in enumerate(('#ffffff', '#343b48')):
    x = 12 + index * 270
    draw.rectangle((x, 955, x + 250, 1090), fill=bg)
    color = '#172030' if index == 0 else '#ffffff'
    draw.text((x + 4, 960), 'mother / 48, 58, 76 px', fill=color)
    cursor = x + 8
    for size in (48, 58, 76):
        thumb = face.resize((size, size), Image.Resampling.LANCZOS)
        sheet.paste(thumb, (cursor, 992), thumb)
        cursor += size + 12
for index, path in enumerate(('backgrounds/bg_home_morning.webp', 'stills/prologue.webp')):
    scene = Image.open(ART / path).convert('RGB')
    panel = ImageOps.fit(scene, (280, 240), Image.Resampling.LANCZOS)
    for size, x in ((128, 12), (48, 200)):
        thumb = face.resize((size, size), Image.Resampling.LANCZOS)
        panel.paste(thumb, (x, 60), thumb)
    sheet.paste(panel, (600 + index * 290, 960))
draw.text((12, 1120), 'Source PNG -> region crop -> LANCZOS 256 -> lossless WebP', fill='#172030')
draw.text((12, 1145), 'Asset proof only; no runtime registration or live game check.', fill='#172030')
sheet.save(OUT / 'visual-review.jpg', quality=95)

before = json.loads((OUT / 'before-sha256.json').read_text(encoding='utf-8'))
allowed = {
    'artifacts/source-art/verify-story-assets.py',
    'artifacts/source-art/faces/face-regions.json',
    'artifacts/source-art/story-assets-verification.json',
    'artifacts/source-art/story-assets-review.html',
    'artifacts/source-art/story-assets-final-check.json',
    'artifacts/source-art/STORY-ASSETS-DELIVERY.md',
}
changed, unchanged = [], []
for name, digest in before.items():
    path = ROOT / name
    (unchanged if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == digest else changed).append(name)
# Source work may continue in another session while asset delivery runs. Report
# that drift separately; this script only writes inside prologue-opening/.
source_drift = sorted(p for p in changed if p.startswith('src/'))
unexpected = sorted(set(changed) - allowed - set(source_drift))
report = {
    'baseline_files': len(before), 'unchanged_files': len(unchanged),
    'unchanged_image_files': sum(Path(p).suffix.lower() in {'.png', '.webp', '.jpg', '.jpeg'} for p in unchanged),
    'unchanged_src_files': sum(p.startswith('src/') for p in unchanged),
    'changed_allowed_metadata': sorted(set(changed) & allowed),
    'outside_delivery_src_changes_observed': source_drift,
    'unexpected_asset_changes': unexpected,
    'runtime_checked': False,
}
(OUT / 'preservation-check.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
assert not unexpected, f'Unexpected existing-file changes: {unexpected}'
