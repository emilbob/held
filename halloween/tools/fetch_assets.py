"""Download the Halloween film's CC0 assets into halloween/assets/ and write assets/CREDITS.md.

Poly Haven (polyhaven.com) publishes everything under CC0: free for commercial use, no attribution required.
Only data formats are fetched (glTF/bin, JPG/PNG, HDR), never .blend files, so nothing in them can execute.
Run: halloween/.venv/bin/python -I halloween/tools/fetch_assets.py
"""
import hashlib, json, os, sys, urllib.request, urllib.error

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
UA = {'User-Agent': 'held-halloween-asset-fetch/1.0'}

MODELS = ['ArmChair_01', 'mantel_clock_01', 'brass_candleholders', 'wooden_candlestick', 'book_encyclopedia_set_01',
          'ceramic_vase_01', 'antique_ceramic_vase_01', 'dry_branches_medium_01', 'dead_quiver_branch_01',
          'side_table_01', 'wicker_basket_01', 'fancy_picture_frame_01']
TEXTURES = {'old_wood_floor': '2k', 'painted_plaster_wall': '2k', 'castle_brick_02_red': '2k', 'wood_table_worn': '2k',
            'quatrefoil_jacquard_fabric': '2k', 'velour_velvet': '2k', 'bark_brown_02': '2k', 'dark_wood': '2k'}
TEX_MAPS = ['Diffuse', 'nor_gl', 'Rough', 'Displacement']
HDRIS = {'moonlit_golf': '2k'}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def save(url, path, md5=None):
    if os.path.exists(path) and (md5 is None or hashlib.md5(open(path, 'rb').read()).hexdigest() == md5):
        return
    data = get(url)
    if md5 and hashlib.md5(data).hexdigest() != md5:
        sys.exit('md5 mismatch: ' + url)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)
    print('  ', os.path.relpath(path, ROOT), len(data) // 1024, 'KB')


def ph_files(asset):
    return json.loads(get('https://api.polyhaven.com/files/' + asset))


def safe(rel):
    return '..' not in rel.split('/') and not rel.startswith('/')


credits = []
for a in MODELS:
    print('model', a)
    g = ph_files(a)['gltf']['2k']['gltf']
    base = os.path.join(ROOT, 'models', a)
    save(g['url'], os.path.join(base, os.path.basename(g['url'])), g['md5'])
    for rel, f in g['include'].items():
        if safe(rel):
            save(f['url'], os.path.join(base, rel), f['md5'])
    credits.append((a, 'model', 'https://polyhaven.com/a/' + a))
for a, res in TEXTURES.items():
    print('texture', a)
    try:
        files = ph_files(a)
    except urllib.error.HTTPError:
        print('   not found, skipped')
        continue
    for m in TEX_MAPS:
        if m not in files:
            continue
        f = files[m][res]['jpg' if m != 'Displacement' else 'png']
        save(f['url'], os.path.join(ROOT, 'textures', a, os.path.basename(f['url'])), f['md5'])
    credits.append((a, 'texture', 'https://polyhaven.com/a/' + a))
for a, res in HDRIS.items():
    print('hdri', a)
    f = ph_files(a)['hdri'][res]['hdr']
    save(f['url'], os.path.join(ROOT, 'hdri', os.path.basename(f['url'])), f['md5'])
    credits.append((a, 'HDRI', 'https://polyhaven.com/a/' + a))

with open(os.path.join(ROOT, 'CREDITS.md'), 'w') as f:
    f.write('# Asset credits\n\nAll third-party assets are CC0 (public domain, commercial use allowed). Attribution is not '
            'required; listed for provenance.\n\n| Asset | Type | Source |\n|---|---|---|\n')
    for a, t, u in credits:
        f.write(f'| {a} | {t} | Poly Haven: {u} |\n')
print('done')
