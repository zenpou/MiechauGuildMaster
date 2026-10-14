"""Copy generated originals and encode delivery WebP; no cropping or retouching."""
import hashlib
import json
import shutil
from pathlib import Path
from PIL import Image

folder = Path(__file__).resolve().parent
root = folder.parents[2]
out = root / 'public/art/backgrounds'
out.mkdir(parents=True, exist_ok=True)
batch = json.loads((folder / 'batch-v1.json').read_text(encoding='utf-8'))
manifest = []
for item in batch['assets']:
    name = item['id'] + '-v1'
    original = folder / (name + '.png')
    if not original.exists():
        shutil.copy2(item['generated'], original)
    target = out / (name + '.webp')
    with Image.open(original) as im:
        assert im.size == (1536, 1024), (name, im.size)
        im.save(target, 'WEBP', quality=85, method=6)
    with Image.open(target) as check:
        check.load()
        assert check.size == (1536, 1024)
    manifest.append({'id': item['id'], 'name': item['name'], 'keys': item['keys'],
        'source': original.name, 'runtime': 'backgrounds/' + target.name,
        'dimensions': [1536, 1024], 'bytes': target.stat().st_size,
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
(folder / 'manifest-v1.json').write_text(json.dumps({'created': '2026-10-13',
    'status': 'generated; visual review complete; user approval not yet recorded',
    'generator': 'built-in image_gen', 'assets': manifest}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(manifest, ensure_ascii=False, indent=2))
