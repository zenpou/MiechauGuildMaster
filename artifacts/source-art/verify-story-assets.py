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
    'iris': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'dizzy',
             'coatless_neutral', 'coatless_happy'],
    'noel': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'worried'],
    'sera': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'teary'],
    'viola': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'flustered',
              'scout_neutral', 'scout_happy', 'scout_angry', 'scout_flustered'],
    'ruu': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'bluff'],
    'fine': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'sparkle'],
    'aurelia': ['neutral', 'happy', 'angry', 'surprised', 'shy', 'dragon'],
    'gald': ['neutral', 'happy', 'coatless_neutral', 'coatless_happy'],
    'mother': ['neutral'],
    **{f'adv_{name}_{gender}': ['neutral'] for name in
       ['brave', 'cautious', 'greedy', 'caring', 'proud', 'timid'] for gender in ['male', 'female']},
}
expected = [('backgrounds', name) for name in [
    'bg_guild_office_sunset', 'bg_dungeon_mine', 'bg_dungeon_crystal', 'bg_dungeon_dragon',
    'bg_office_past', 'bg_home_morning']]
expected += [('stills', name) for name in ['prologue', 'dragon']]
expected += [('characters', f'{name}/{pose}') for name, poses in CHARACTERS.items() for pose in poses]
assert len(expected) == 85
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

face_expected = [name for category, name in expected if category == 'characters']
assert len(face_expected) == 77
face_expected_set = set(face_expected)
face_persons = set(CHARACTERS)
face_source_root = OUT / 'faces'
face_public_root = ROOT / 'public/art/faces'

def snapshot(path):
    if not path.exists():
        return None, None, f'missing {path.relative_to(ROOT).as_posix()}'
    try:
        with Image.open(path) as opened:
            opened.load()
            info = {'path': path.relative_to(ROOT).as_posix(), 'format': opened.format,
                    'size': list(opened.size), 'mode': opened.mode,
                    'bytes': path.stat().st_size,
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
            return opened.copy(), info, None
    except OSError as error:
        return None, None, f'unreadable or being written: {path.relative_to(ROOT).as_posix()}: {error}'

def pixels(image):
    return image.convert('RGBA').tobytes()

def face_keys(root, suffix):
    if not root.exists():
        return set()
    return {path.relative_to(root).with_suffix('').as_posix()
            for path in root.rglob(f'*{suffix}') if path.suffix.lower() == suffix}

face_source_keys = face_keys(face_source_root, '.png')
face_public_keys = face_keys(face_public_root, '.webp')
face_collection_issues = []
if face_source_keys != face_expected_set:
    face_collection_issues.append(
        f"source face set mismatch: missing={sorted(face_expected_set-face_source_keys)}, "
        f"extra={sorted(face_source_keys-face_expected_set)}")
if face_public_keys != face_expected_set:
    face_collection_issues.append(
        f"public face set mismatch: missing={sorted(face_expected_set-face_public_keys)}, "
        f"extra={sorted(face_public_keys-face_expected_set)}")

regions_path = face_source_root / 'face-regions.json'
regions = None
region_issues = []
if not regions_path.exists():
    region_issues.append(f'missing {regions_path.relative_to(ROOT).as_posix()}')
else:
    try:
        regions = json.loads(regions_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as error:
        region_issues.append(f'unreadable face-regions.json: {error}')
if regions is not None and not isinstance(regions, dict):
    region_issues.append('face-regions.json top level must be an object')
    regions = None

base_regions, pose_regions = {}, {}
base_region_issues, pose_region_issues = {}, {}
def parse_region(value, label):
    if not isinstance(value, dict):
        return None, [f'{label} must be an object']
    issues = []
    unknown = set(value) - {'x', 'y', 'size', 'poses'}
    if unknown:
        issues.append(f'{label} has unknown fields: {sorted(unknown)}')
    for field in ('x', 'y', 'size'):
        if isinstance(value.get(field), bool) or not isinstance(value.get(field), int):
            issues.append(f'{label}.{field} must be an integer')
    if isinstance(value.get('size'), int) and value['size'] <= 0:
        issues.append(f'{label}.size must be positive')
    return (None, issues) if issues else ({field: value[field] for field in ('x', 'y', 'size')}, [])

if regions is not None:
    missing = sorted(face_persons-set(regions))
    extra = sorted(set(regions)-face_persons)
    if missing:
        region_issues.append(f'missing persons: {missing}')
    if extra:
        region_issues.append(f'extra persons: {extra}')
    for person in sorted(face_persons):
        config = regions.get(person)
        base, issues = parse_region(config, person)
        if issues:
            base_region_issues[person] = issues
        else:
            base_regions[person] = base
        if isinstance(config, dict) and 'poses' in config:
            poses = config['poses']
            if not isinstance(poses, dict):
                base_region_issues.setdefault(person, []).append(f'{person}.poses must be an object')
            elif not poses:
                base_region_issues.setdefault(person, []).append(f'{person}.poses must be omitted when empty')
            else:
                for pose, override in poses.items():
                    if pose not in CHARACTERS.get(person, []):
                        pose_region_issues[(person, pose)] = [f'unknown pose override: {person}/{pose}']
                        continue
                    parsed, pose_errors = parse_region(override, f'{person}.poses.{pose}')
                    if isinstance(override, dict) and 'poses' in override:
                        pose_errors.append(f'{person}.poses.{pose} must not contain nested poses')
                    if pose_errors:
                        pose_region_issues[(person, pose)] = pose_errors
                    else:
                        pose_regions[(person, pose)] = parsed

region_issues.extend(error for errors in base_region_issues.values() for error in errors)
region_issues.extend(error for errors in pose_region_issues.values() for error in errors)

face_records = []
for name in face_expected:
    person, pose = name.split('/', 1)
    face = {'category': 'faces', 'id': name, 'issues': [], 'files': {}}
    standing, _, standing_error = snapshot(OUT / 'characters' / f'{name}.png')
    source, source_info, source_error = snapshot(face_source_root / f'{name}.png')
    webp, webp_info, webp_error = snapshot(face_public_root / f'{name}.webp')
    if standing_error:
        face['issues'].append(f'standing {standing_error}')
    if source_error:
        face['issues'].append(f'source {source_error}')
    else:
        face['files']['source'] = source_info
        if source_info['format'] != 'PNG':
            face['issues'].append(f"source invalid format {source_info['format']}")
        if source.size != (256, 256):
            face['issues'].append(f'source size {source.size}')
        if 'A' not in source.getbands():
            face['issues'].append('source no alpha')
        else:
            face['files']['source']['alpha_extrema'] = list(source.getchannel('A').getextrema())
    if webp_error:
        face['issues'].append(f'webp {webp_error}')
    else:
        face['files']['webp'] = webp_info
        if webp_info['format'] != 'WEBP':
            face['issues'].append(f"webp invalid format {webp_info['format']}")
        if webp.size != (256, 256):
            face['issues'].append(f'webp size {webp.size}')
        if 'A' not in webp.getbands():
            face['issues'].append('webp no alpha')
        else:
            face['files']['webp']['alpha_extrema'] = list(webp.getchannel('A').getextrema())
    region = pose_regions.get((person, pose), base_regions.get(person))
    face['region'] = region
    face['region_source'] = 'poses' if (person, pose) in pose_regions else 'base'
    errors = base_region_issues.get(person, []) + pose_region_issues.get((person, pose), [])
    region_in_bounds = (region is not None and standing is not None and region['x'] >= 0 and region['y'] >= 0
                        and region['x'] + region['size'] <= standing.width
                        and region['y'] + region['size'] <= standing.height)
    if errors:
        face['issues'].extend(f'region {error}' for error in errors)
    elif not region_in_bounds:
        face['issues'].append(f'region outside standing image {standing.size if standing else None}')
    if source is not None and standing is not None and not errors and region_in_bounds:
        expected_face = standing.convert('RGBA').crop((region['x'], region['y'], region['x']+region['size'], region['y']+region['size'])).resize((256, 256), Image.Resampling.LANCZOS)
        if pixels(source) != pixels(expected_face):
            face['issues'].append('source does not equal region crop resized with LANCZOS')
    if source is not None and webp is not None and source.size == webp.size == (256, 256) and pixels(source) != pixels(webp):
        face['issues'].append('webp RGBA pixels differ from source PNG')
    face_records.append(face)
assert len(face_records) == len(face_expected)
face_complete = sum(not face['issues'] for face in face_records)
faces = {
    'expected': len(face_expected), 'complete': face_complete,
    'remaining': len(face_expected)-face_complete,
    'files': {'source_expected': len(face_expected), 'source_found': len(face_source_keys),
              'webp_expected': len(face_expected), 'webp_found': len(face_public_keys)},
    'collection_issues': face_collection_issues,
    'regions': {'path': regions_path.relative_to(ROOT).as_posix(),
                'persons_expected': len(face_persons),
                'persons_found': len(regions) if isinstance(regions, dict) else 0,
                'issues': region_issues},
    'assets': face_records,
}
complete = sum(not r['issues'] for r in records)
assert len(records) == len(expected)
report = {'expected': len(expected), 'complete': complete, 'remaining': len(expected)-complete,
          'scope': 'asset delivery only; game integration and live playback not included',
          'assets': records, 'faces': faces}
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
        if category == 'characters':
            face_source = f'faces/{name}.png'
            face_webp = f'../../public/art/faces/{name}.webp'
            media += (f'<div class="face-strip" aria-label="顔48px・58px・76px">'
                      f'<a href="{face_source}" target="_blank"><img loading="lazy" width="48" height="48" style="width:48px;height:48px" src="{face_webp}" alt="{label} 顔48px"><span>48px</span></a>'
                      f'<a href="{face_source}" target="_blank"><img loading="lazy" width="58" height="58" style="width:58px;height:58px" src="{face_webp}" alt="{label} 顔58px"><span>58px</span></a>'
                      f'<a href="{face_source}" target="_blank"><img loading="lazy" width="76" height="76" style="width:76px;height:76px" src="{face_webp}" alt="{label} 顔76px"><span>76px</span></a></div>')
        elif category == 'backgrounds':
            media += f'<details><summary>375×480相当の中央トリミング</summary><div style="aspect-ratio:375/480"><img loading="lazy" src="{preview}" alt="{label} 中央トリミング" style="height:100%;object-fit:cover;object-position:center"></div></details>'
    else:
        media = '<div class="missing">未生成</div>'
    state = html.escape(', '.join(r['issues'])) if r['issues'] else 'PNG / WebP 検証済み'
    links = f'<a href="{source}">PNG</a> · <a href="{webp}">WebP</a>' if not r['issues'] else ''
    if category == 'characters':
        links += f' · <a href="faces/{name}.png">顔PNG</a> · <a href="../../public/art/faces/{name}.webp">顔WebP</a>'
    cards.append(f'<article class="{category}" data-id="{label}"><div class="art">{media}</div><b>{label}</b><p>{state}</p>{links}</article>')
page = '''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>物語素材一覧</title><style>
*{box-sizing:border-box}body{margin:0;background:#151923;color:#e8edf3;font:14px/1.6 system-ui,sans-serif}header{padding:28px;position:sticky;top:0;background:#151923ee;z-index:2;backdrop-filter:blur(10px)}h1{margin:0;font-size:26px}p{margin:6px 0}a{color:#9ed9ff}input,button{padding:8px 12px;border-radius:6px;border:1px solid #657083;background:#242d3d;color:white;margin:8px 5px 0 0}main{padding:20px;display:grid;grid-template-columns:repeat(auto-fill,minmax(235px,1fr));gap:20px}article{padding:12px;background:#232b39;border-radius:10px;overflow:hidden}article b{display:block;margin-top:10px;overflow-wrap:anywhere}.art{background:repeating-conic-gradient(#d8dbe1 0% 25%,#f6f7fa 0% 50%) 0 0/20px 20px;border-radius:6px;position:relative;overflow:hidden}.art>a{display:block}.art img{display:block;width:100%;height:auto}.characters .art>a>img{height:420px;object-fit:contain}.face-strip{position:absolute;right:6px;bottom:6px;display:flex;align-items:flex-end;gap:3px;padding:3px;background:#dce2e7dd;border:2px solid #647488;border-radius:5px}.face-strip a{display:block;line-height:0;color:#172030;text-align:center}.face-strip span{display:block;font-size:10px;line-height:16px}.dark .face-strip a{color:#fff}.face-strip img{width:auto;height:auto;object-fit:cover}.face-links{font-size:12px;margin-top:4px}.missing{height:220px;display:grid;place-items:center;color:#59616c}details{background:#232b39;color:#e8edf3}summary{padding:5px;cursor:pointer;font-size:12px}.dark .art,.dark .face-strip{background:#343b48}.light .art,.light .face-strip{background:#fff}[hidden]{display:none}
</style><header><h1>物語素材一覧</h1><p>__COUNT__ / __TOTAL__ 素材 · 汎用冒険者は男女×6性格の各1枚（旧素材・笑顔差分は予備として保存）</p><p>生成・素材納品の確認用。ゲーム組み込み・実機表示は別工程。人物立ち絵右下は顔専用WebPを48/58/76pxで表示。</p><input id="filter" placeholder="人物名・背景IDで絞り込み" aria-label="素材フィルター"><button onclick="document.body.className=''">透過背景</button><button onclick="document.body.className='dark'">暗い背景</button><button onclick="document.body.className='light'">白い背景</button> <a href="story-assets-verification.json">検証結果</a></header><main>__CARDS__</main><script>document.querySelector('#filter').addEventListener('input',e=>document.querySelectorAll('article').forEach(a=>a.hidden=!a.dataset.id.includes(e.target.value.trim().toLowerCase())))</script></html>'''
(OUT / 'story-assets-review.html').write_text(page.replace('__COUNT__', str(complete)).replace('__TOTAL__', str(len(expected))).replace('__CARDS__', ''.join(cards)), encoding='utf-8')
print(json.dumps({'expected':len(expected),'complete':complete,'remaining':len(expected)-complete}, ensure_ascii=False))
if '--require-complete' in sys.argv and complete != len(expected):
    sys.exit(1)

# Audit active manifest coverage; archived generic candidates are deliberately excluded.
if '--require-complete' in sys.argv:
    assert len(records) == len(expected), 'Asset record count mismatch'
    assert len(face_records) == len(face_expected), 'Face record count mismatch'
    assert not face_collection_issues, f'Face file set mismatch: {face_collection_issues}'
    assert not region_issues and face_complete == len(face_expected), 'Face asset verification incomplete'
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
            self.sources = []
        def handle_starttag(self, tag, attrs):
            attributes = dict(attrs)
            if tag == 'a' and 'href' in attributes:
                self.links.append(attributes['href'])
            if tag == 'img' and 'src' in attributes:
                self.sources.append(attributes['src'])
    links = LinkAudit()
    links.feed((OUT / 'story-assets-review.html').read_text(encoding='utf-8'))
    assert all((OUT / path).exists() for path in links.links + links.sources), 'Broken gallery link or image source'
    face_baseline = face_source_root / 'previous-delivery-verification.json'
    previous = json.loads(face_baseline.read_text(encoding='utf-8'))
    face_baseline_count = 0
    assert len(previous['assets']) == 80, 'Previous delivery baseline must contain 80 assets'
    for asset in previous['assets']:
        for file in asset['files'].values():
            path = ROOT / file['path']
            assert path.exists(), f'Face delivery baseline file missing: {file["path"]}'
            assert hashlib.sha256(path.read_bytes()).hexdigest() == file['sha256'], f'Existing file changed: {file["path"]}'
            face_baseline_count += 1
    assert face_baseline_count == 160, 'Previous delivery baseline must contain 160 files'
    # The prologue adds files only: all 316 previously delivered images must stay exact.
    prologue_baseline = json.loads((OUT / 'prologue-opening/previous-delivery-verification.json').read_text(encoding='utf-8'))
    prologue_baseline_count = 0
    assert len(prologue_baseline['assets']) == 82
    assert len(prologue_baseline['faces']['assets']) == 76
    for asset in prologue_baseline['assets'] + prologue_baseline['faces']['assets']:
        for file in asset['files'].values():
            path = ROOT / file['path']
            assert path.exists(), f'Prologue baseline file missing: {file["path"]}'
            assert hashlib.sha256(path.read_bytes()).hexdigest() == file['sha256'], f'Existing file changed: {file["path"]}'
            prologue_baseline_count += 1
    assert prologue_baseline_count == 316
    final = {
        'assets': len(expected), 'files': len(expected) * 2,
        'faces': len(face_expected), 'face_files': len(face_expected) * 2,
        'faces_complete': face_complete, 'faces_regions_valid': not region_issues,
        'manifest_records': len(registered), 'valid_gallery_links': len(links.links),
        'valid_gallery_image_sources': len(links.sources),
        'source_bytes': sum(r['files']['source']['bytes'] for r in records),
        'webp_bytes': sum(r['files']['webp']['bytes'] for r in records),
        'latest_revision': 'Prologue office, home morning, and mother silhouette with face crop added',
        'scope': 'Asset files and face crops delivered; game integration and live playback not included',
        'faces_baseline_files_unchanged': face_baseline_count,
        'prologue_baseline_files_unchanged': prologue_baseline_count,
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
