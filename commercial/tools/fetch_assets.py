"""Download the commercial's CC0 assets into commercial/assets/ and write assets/CREDITS.md.

Poly Haven (polyhaven.com, CC0): glTF models, PBR textures, HDRIs. ambientCG (ambientcg.com, CC0): cardboard.
Only data formats are fetched (glTF/bin, JPG, HDR), never .blend files, so nothing in them can execute.
Run: commercial/.venv/bin/python -I commercial/tools/fetch_assets.py
"""
import hashlib, json, os, sys, urllib.request, zipfile, io

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
UA = {'User-Agent': 'held-commercial-asset-fetch/1.0'}

MODELS = ['potted_plant_02', 'stationery_supplies', 'modern_arm_chair_01', 'standing_picture_frame_02']
TEXTURES = {'oak_veneer_01': '4k', 'plastered_wall': '2k', 'wood_floor': '2k', 'poly_wool_herringbone': '2k', 'rough_linen': '2k'}
TEX_MAPS = ['Diffuse', 'nor_gl', 'Rough', 'Displacement']
HDRIS = {'hansaplatz': '4k', 'konigsallee': '4k'}
AMBIENTCG = ['Cardboard002']


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


credits = []
for a in MODELS:
    print('model', a)
    files = ph_files(a)
    if 'gltf' not in files:
        print('   no glTF, skipped')
        continue
    g = files['gltf']['2k']['gltf']
    base = os.path.join(ROOT, 'models', a)
    save(g['url'], os.path.join(base, os.path.basename(g['url'])), g['md5'])
    for rel, f in g['include'].items():
        save(f['url'], os.path.join(base, rel), f['md5'])
    credits.append((a, 'model', 'https://polyhaven.com/a/' + a))
for a, res in TEXTURES.items():
    print('texture', a)
    files = ph_files(a)
    for m in TEX_MAPS:
        f = files[m][res]['jpg' if m != 'Displacement' else 'png']
        save(f['url'], os.path.join(ROOT, 'textures', a, os.path.basename(f['url'])), f['md5'])
    credits.append((a, 'texture', 'https://polyhaven.com/a/' + a))
for a, res in HDRIS.items():
    print('hdri', a)
    f = ph_files(a)['hdri'][res]['hdr']
    save(f['url'], os.path.join(ROOT, 'hdri', os.path.basename(f['url'])), f['md5'])
    credits.append((a, 'HDRI', 'https://polyhaven.com/a/' + a))
for a in AMBIENTCG:
    print('ambientCG', a)
    d = os.path.join(ROOT, 'textures', a)
    if not os.path.isdir(d):
        z = zipfile.ZipFile(io.BytesIO(get(f'https://ambientcg.com/get?file={a}_2K-JPG.zip')))
        for n in z.namelist():
            if n.lower().endswith(('.jpg', '.png')) and '/' not in n and '..' not in n:
                os.makedirs(d, exist_ok=True)
                with open(os.path.join(d, n), 'wb') as f:
                    f.write(z.read(n))
    credits.append((a, 'texture', 'https://ambientcg.com/view?id=' + a))

with open(os.path.join(ROOT, 'CREDITS.md'), 'w') as f:
    f.write('# Asset credits\n\nAll third-party assets are CC0 (public domain). Attribution is not required; listed for provenance.\n\n')
    f.write('| Asset | Type | Source |\n|---|---|---|\n')
    for a, t, u in credits:
        f.write(f'| {a} | {t} | {"Poly Haven" if "polyhaven" in u else "ambientCG"}: {u} |\n')
print('done')
