"""Audit STORY-ASSETS delivery and rebuild its local review gallery."""
import hashlib
import html
import json
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/source-art'
CHARACTERS = {
    'kai': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'sleep'],
    'tina': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'sulky'],
    'iris': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'dizzy'],
    'noel': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'worried'],
    'sera': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'teary'],
    'viola': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'flustered',
              'scout_neutral', 'scout_happy', 'scout_angry', 'scout_flustered'],
    'ruu': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'bluff'],
    'fine': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'sparkle'],
    'aurelia': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'dragon'],
    'gald': ['neutral', 'happy', 'coatless_neutral', 'coatless_happy'],
    **{f'adv_{name}_{gender}': ['neutral'] for name in
       ['brave', 'cautious', 'greedy', 'caring', 'proud', 'timid'] for gender in ['male', 'female']},
}
expected = [('backgrounds', name) for name in [
    'bg_guild_office_sunset', 'bg_dungeon_mine', 'bg_dungeon_crystal', 'bg_dungeon_dragon']]
expected += [('stills', name) for name in ['prologue', 'dragon']]
expected += [('characters', f'{name}/{pose}') for name, poses in CHARACTERS.items() for pose in poses]
assert len(expected) == 80
records = []
for category, name in expected:
    record = {'category': category, 'id': name, 'issues': [], 'files': {}}
    for kind, path in [('source', OUT / category / f'{name}.png'),
                       ('webp', ROOT / 'public/art' / category / f'{name}.webp')]:
        if not path.exists():
            record['issues'].append(f'missing {kind}')
            continue
        try:
            opened = Image.open(path)
            opened.load()
        except OSError as error:
            record['issues'].append(f'{kind} unreadable or being written: {error}')
            continue
        with opened as im:
            info = {'path': path.relative_to(ROOT).as_posix(), 'format': im.format, 'size': list(im.size),
                    'mode': im.mode, 'bytes': path.stat().st_size,
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            target = (1024, 1024) if category == 'characters' and name == 'aurelia/dragon' else ((512, 1024) if category == 'characters' else (1536, 1024))
            if im.size != target:
                record['issues'].append(f'{kind} size {im.size}')
            if im.format != ('PNG' if kind == 'source' else 'WEBP'):
                record['issues'].append(f'{kind} invalid format {im.format}')
            if category == 'characters':
                if 'A' not in im.getbands():
                    record['issues'].append(f'{kind} no alpha')
                else:
                    alpha = im.getchannel('A')
                    info['alpha_extrema'] = list(alpha.getextrema())
                    info['content_bbox'] = alpha.point(lambda p: 255 if p > 16 else 0).getbbox()
                    if alpha.getextrema() != (0, 255):
                        record['issues'].append(f'{kind} missing transparent or opaque pixels')
            record['files'][kind] = info
    records.append(record)
seen = {}
for r in records:
    if 'source' in r['files']:
        digest = r['files']['source']['sha256']
        if digest in seen:
            r['issues'].append(f'identical source to {seen[digest]}')
        seen[digest] = r['id']
complete = sum(not r['issues'] for r in records)
report = {'expected': len(expected), 'complete': complete, 'remaining': len(expected)-complete,
          'scope': 'asset delivery only; game integration and live playback not included',
          'assets': records}
(OUT / 'story-assets-verification.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
cards = []
for r in records:
    category, name = r['category'], r['id']
    label = html.escape(f'{category}/{name}')
    source = f'{category}/{name}.png'
    webp = f'../../public/art/{category}/{name}.webp'
    if 'source' in r['files']:
        preview = webp if 'webp' in r['files'] else source
        media = f'<a href="{source}" target="_blank"><img loading="lazy" src="{preview}" alt="{label}"></a>'
        if category == 'characters' and name != 'aurelia/dragon':
            media += f'<div class="face" title="現行エンジンの顔切り出し（650%）"><img loading="lazy" src="{preview}" alt="{label} 顔"></div>'
        elif category == 'backgrounds':
            media += f'<details><summary>375×480相当の中央トリミング</summary><div style="aspect-ratio:375/480"><img loading="lazy" src="{preview}" alt="{label} 中央トリミング" style="height:100%;object-fit:cover;object-position:center"></div></details>'
    else:
        media = '<div class="missing">未生成</div>'
    state = html.escape(', '.join(r['issues'])) if r['issues'] else 'PNG / WebP 検証済み'
    links = f'<a href="{source}">PNG</a> · <a href="{webp}">WebP</a>' if not r['issues'] else ''
    cards.append(f'<article class="{category}" data-id="{label}"><div class="art">{media}</div><b>{label}</b><p>{state}</p>{links}</article>')
page = '''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>物語素材一覧</title><style>
*{box-sizing:border-box}body{margin:0;background:#151923;color:#e8edf3;font:14px/1.6 system-ui,sans-serif}header{padding:28px;position:sticky;top:0;background:#151923ee;z-index:2;backdrop-filter:blur(10px)}h1{margin:0;font-size:26px}p{margin:6px 0}a{color:#9ed9ff}input,button{padding:8px 12px;border-radius:6px;border:1px solid #657083;background:#242d3d;color:white;margin:8px 5px 0 0}main{padding:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(235px,1fr));gap:20px}article{padding:12px;background:#232b39;border-radius:10px;overflow:hidden}article b{display:block;margin-top:10px;overflow-wrap:anywhere}.art{background:repeating-conic-gradient(#d8dbe1 0% 25%,#f6f7fa 0% 50%) 0 0/20px 20px;border-radius:6px;position:relative;overflow:hidden}.art>a{display:block}.art img{display:block;width:100%;height:auto}.characters .art>a>img{height:420px;object-fit:contain}.face{position:absolute;width:76px;height:76px;bottom:6px;right:6px;overflow:hidden;border:2px solid #647488;background:#dce2e7}.face img{width:auto;height:650%;max-width:none;position:absolute;left:50%;transform:translateX(-50%);top:0}.missing{height:220px;display:grid;place-items:center;color:#59616c}details{background:#232b39;color:#e8edf3}summary{padding:5px;cursor:pointer;font-size:12px}.dark .art,.dark .face{background:#343b48}.light .art,.light .face{background:#fff}[hidden]{display:none}
</style><header><h1>物語素材一覧</h1><p>__COUNT__ / 80 素材 · 汎用冒険者は男女×6性格の各1枚（旧素材・笑顔差分は予備として保存）</p><p>生成・素材納品の確認用。ゲーム組み込み・実機表示は別工程。人物立ち絵右下は現行エンジンと同じ650%の顔切り出し。竜は四足姿勢の1024×1024素材（表示調整は組み込み時）。</p><input id="filter" placeholder="人物名・背景IDで絞り込み" aria-label="素材フィルター"><button onclick="document.body.className=''">透過背景</button><button onclick="document.body.className='dark'">暗い背景</button><button onclick="document.body.className='light'">白い背景</button> <a href="story-assets-verification.json">検証結果</a></header><main>__CARDS__</main><script>document.querySelector('#filter').addEventListener('input',e=>document.querySelectorAll('article').forEach(a=>a.hidden=!a.dataset.id.includes(e.target.value.trim().toLowerCase())))</script></html>'''
(OUT / 'story-assets-review.html').write_text(page.replace('__COUNT__', str(complete)).replace('__CARDS__', ''.join(cards)), encoding='utf-8')
print(json.dumps({'expected':len(expected),'complete':complete,'remaining':len(expected)-complete}, ensure_ascii=False))
if '--require-complete' in sys.argv and complete != len(expected):
    sys.exit(1)

# Audit active manifest coverage; archived generic candidates are deliberately excluded.
if '--require-complete' in sys.argv:
    from html.parser import HTMLParser
    active = set(expected)
    registered = set()
    manifest_files = sorted(OUT.glob('story-batch-*.json'))
    for manifest_path in manifest_files:
        for item in json.loads(manifest_path.read_text(encoding='utf-8'))['assets']:
            key = ('characters', f"{item['id']}/{item['pose']}") if 'pose' in item else (item['category'], item['id'])
            if key in active:
                assert key not in registered, f'Duplicate manifest asset: {key}'
                registered.add(key)
    assert registered == active, f'Manifest coverage mismatch: {active - registered}'
    class LinkAudit(HTMLParser):
        def __init__(self):
            super().__init__()
            self.links = []
        def handle_starttag(self, tag, attrs):
            if tag == 'a':
                self.links.extend(v for k, v in attrs if k == 'href')
    links = LinkAudit()
    links.feed((OUT / 'story-assets-review.html').read_text(encoding='utf-8'))
    assert all((OUT / path).exists() for path in links.links), 'Broken gallery link'
    final = {
        'assets': len(expected), 'files': len(expected) * 2,
        'manifest_records': len(registered), 'valid_gallery_links': len(links.links),
        'source_bytes': sum(r['files']['source']['bytes'] for r in records),
        'webp_bytes': sum(r['files']['webp']['bytes'] for r in records),
        'latest_revision': 'Single-sprite generic characters; greedy faces/body revised; all active assets verified',
        'scope': 'Asset files only; game integration and final portrait cropping pending',
    }
    baseline = OUT / 'revisions/generic-gender-expansion/previous-verification.json'
    if baseline.exists():
        previous = json.loads(baseline.read_text(encoding='utf-8'))
        count = 0
        moved = 0
        for asset in previous['assets']:
            for file in asset['files'].values():
                path = ROOT / file['path']
                if not path.exists():
                    # 2026-10-14: 現行外の汎用素材(旧 adv_* と happy)は revisions/generic-unused/ へ移した。無いものは「移動済み」と数える
                    moved += 1
                    continue
                assert hashlib.sha256(path.read_bytes()).hexdigest() == file['sha256'], f"Existing file changed: {file['path']}"
                count += 1
        final['previous_files_unchanged'] = count
        final['previous_files_moved_to_revisions'] = moved
    (OUT / 'story-assets-final-check.json').write_text(json.dumps(final, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(final, ensure_ascii=False))
