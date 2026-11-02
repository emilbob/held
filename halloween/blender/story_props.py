"""The film's story props: the laptop that shows the Held checkout, and the wrapped package the ghost delivers.

Laptop rig: root (on the floor, heading) → base (keyboard, trackpad) → lid (hinge, rotation x = opening) → one screen
plane per page in ui/png, shown with set_screen(). Package rig: root → box, lid (lifts off), twine + bow (slide off).
"""
import bpy, bmesh, math, os
from mathutils import Vector
from lib import box, empty, mesh_obj, node_mat, noise, map_range, mix_rgb, simple, tube, img, rng, subsurf, ROOT

UI = os.path.join(ROOT, 'ui', 'png')
PAGES = ['shop', 'checkout', 'held', 'released']

LW, LD = 0.31, 0.215             # laptop width and depth
BASE_T, LID_T = 0.011, 0.0055    # base and lid thickness


def aluminium():
    return simple('laptop_alu', (0.11, 0.11, 0.12), 0.32, metal=0.9, rough_var=0.06, var_scale=200)


def screen_mat(page):
    """The display: black glass with the page as emission (an LCD in a dark room glows, and reflects a little)."""
    m, nt, bsdf, out = node_mat('screen_' + page)
    tx = nt.nodes.new('ShaderNodeTexImage')
    tx.image = img(os.path.join(UI, page + '.png'))
    tx.interpolation = 'Cubic'
    bsdf.inputs['Base Color'].default_value = (0.005, 0.005, 0.006, 1)
    bsdf.inputs['Roughness'].default_value = 0.08
    nt.links.new(tx.outputs['Color'], bsdf.inputs['Emission Color'])
    st = nt.nodes.new('ShaderNodeValue')
    st.name = 'brightness'
    st.outputs[0].default_value = 0.5 if page == 'shop' else 1.1        # the shop page is white: dimmer, or it blazes
    nt.links.new(st.outputs[0], bsdf.inputs['Emission Strength'])
    return m


def quad(name, w, h, mat, c):
    """A w × h plane in local XZ facing -Y, UVs 0..1 (for the screen pages)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    vs = [bm.verts.new((x, 0, z)) for x, z in ((-w / 2, 0), (w / 2, 0), (w / 2, h), (-w / 2, h))]
    f = bm.faces.new(vs)
    for l, co in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        l[uv].uv = co
    ob = mesh_obj(name, bm, c, mat, smooth_shade=False)
    if ob.data.polygons[0].normal.y > 0:
        ob.data.flip_normals()
    return ob


def build_laptop(M, loc, rz=0.0, open_deg=108, c='Laptop'):
    alu = M.setdefault('laptop_alu', aluminium())
    keys = M.setdefault('laptop_keys', simple('laptop_keys', (0.012, 0.012, 0.013), 0.55, rough_var=0.1, var_scale=300))
    glass = M.setdefault('laptop_bezel', simple('laptop_bezel', (0.004, 0.004, 0.005), 0.05, spec=0.6))
    pad = M.setdefault('laptop_pad', simple('laptop_pad', (0.09, 0.09, 0.1), 0.22, metal=0.6))
    L = {}
    root = L['root'] = empty('laptop_root', loc, c)
    root.rotation_euler = (0, 0, rz)
    base = L['base'] = box('laptop_base', LW, LD, BASE_T, (0, 0, 0), bevel=0.004, mat=alu, c=c, origin='bottom', segs=4)
    base.parent = root
    # keys: 5 rows of 13 (the bottom row with a space bar), set into the top surface towards the hinge (+Y)
    kz = BASE_T - 0.0006
    kw, gap = 0.0175, 0.0028
    y0 = LD / 2 - 0.028
    for r in range(5):
        y = y0 - r * (kw + gap)
        if r == 4:
            row = [(-0.115, 0.03), (-0.085, 0.022), (0.0, 0.09), (0.085, 0.022), (0.115, 0.03)]
        else:
            row = [(-0.12 + k * (kw + gap) + kw / 2, kw) for k in range(13)]
        for k, (x, w) in enumerate(row):
            b = box(f'laptop_key_{r}_{k}', w, kw, 0.0016, (x, y, kz), bevel=0.0012, mat=keys, c=c, origin='bottom', segs=2)
            b.parent = root
    tp = box('laptop_trackpad', 0.115, 0.072, 0.0004, (0, -LD / 2 + 0.05, BASE_T - 0.0002), bevel=0.003, mat=pad, c=c,
             origin='bottom')
    tp.parent = root
    L['trackpad'] = tp
    # lid: hinged at the back edge; rotation x opens it (0 = closed flat on the base)
    hinge = L['lid'] = empty('laptop_hinge', (0, LD / 2 - 0.004, BASE_T + 0.001), c, root)
    lid = box('laptop_lid', LW, LID_T, LD - 0.006, (0, 0, 0), bevel=0.0035, mat=alu, c=c, segs=4)
    lid.parent = hinge
    lid.location = (0, LID_T / 2, (LD - 0.006) / 2)
    bez = box('laptop_bezel', LW - 0.006, 0.0008, LD - 0.012, (0, -0.0003, (LD - 0.006) / 2), bevel=0.003, mat=glass, c=c)
    bez.parent = hinge
    # the display: 16:10, one plane per page just in front of the bezel
    dw = LW - 0.022
    dh = dw / 1.6
    L['screens'] = {}
    for i, page in enumerate(PAGES):
        q = quad('laptop_screen_' + page, dw, dh, M.setdefault('screen_' + page, screen_mat(page)), c)
        q.parent = hinge
        q.location = (0, -0.0011 - i * 0.00002, 0.012)
        L['screens'][page] = q
    hinge.rotation_euler = (-math.radians(open_deg - 90), 0, 0)    # past upright = leaning back (a +x rotation tips it forward)
    set_screen(L, 'shop')
    return L


def set_screen(L, page, frame=None):
    for p, ob in L['screens'].items():
        ob.hide_render = ob.hide_viewport = p != page
        if frame is not None:
            ob.keyframe_insert('hide_render', frame=frame)
            ob.keyframe_insert('hide_viewport', frame=frame)


# ---------------------------------------------------------------- the package

PW, PD, PH = 0.25, 0.25, 0.42    # the box: tall enough for the lantern (37 cm with its ring) standing inside
LID_H = 0.045
WALL = 0.005


def kraft_mat(name='kraft'):
    """Brown wrapping paper: warm, matte, a little blotchy, finely crinkled."""
    m, nt, bsdf, out = node_mat(name)
    nz = noise(nt, 14, 6)
    col = mix_rgb(nt, (0.20, 0.10, 0.035), (0.34, 0.19, 0.075), map_range(nt, nz.outputs['Fac'], 0.35, 0.65, 0, 1))
    nt.links.new(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.78
    bsdf.inputs['Sheen Weight'].default_value = 0.2
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 70
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    fine = nt.nodes.new('ShaderNodeTexNoise')
    fine.inputs['Scale'].default_value = 400
    nt.links.new(tc.outputs['Object'], fine.inputs['Vector'])
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    nt.links.new(map_range(nt, vor.outputs['Distance'], 0.0, 0.03, 0.0, 0.35), add.inputs[0])
    nt.links.new(fine.outputs['Fac'], add.inputs[1])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.2
    bp.inputs['Distance'].default_value = 0.0005
    nt.links.new(add.outputs[0], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    return m


def twine_mat(name='twine'):
    """Jute twine: pale straw, fibrous, twisted (diagonal bands)."""
    m, nt, bsdf, out = node_mat(name)
    nz = noise(nt, 300, 4)
    nt.links.new(mix_rgb(nt, (0.36, 0.28, 0.16), (0.55, 0.45, 0.28), map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0, 1)),
                 bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    bsdf.inputs['Sheen Weight'].default_value = 0.6
    tc = nt.nodes.new('ShaderNodeTexCoord')
    wv = nt.nodes.new('ShaderNodeTexWave')
    wv.bands_direction = 'DIAGONAL'
    wv.inputs['Scale'].default_value = 900
    nt.links.new(tc.outputs['Object'], wv.inputs['Vector'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.5
    bp.inputs['Distance'].default_value = 0.0004
    nt.links.new(wv.outputs['Fac'], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    return m


def _band(name, axis, mat, c, r=0.0016):
    """One loop of twine around the box along an axis ('x' or 'y'): over the lid, down the lid's rim, in under it to
    the box's side, down, and under the base."""
    half = (PW if axis == 'x' else PD) / 2
    lid_o = half + 0.002 + r                      # outside the lid's rim
    box_o = half + r                              # against the box's side
    top, lid_b, bot = PH + 0.0035 + r, PH - LID_H, -r
    right = [(lid_o, top - 0.002), (lid_o, lid_b + 0.002), (box_o, lid_b - 0.004), (box_o, 0.004), (box_o - 0.003, bot)]
    pts = [(-lid_o + 0.004, top), (0, top + 0.001), (lid_o - 0.004, top)] + right + [(0, bot)] + \
          [(-x, z) for x, z in reversed(right)] + [(-lid_o + 0.004, top)]
    P = [(x, 0.0, z) if axis == 'x' else (0.0, x, z) for x, z in pts]
    return tube(name, P, [r] * len(P), mat, segs=8, c=c)


def _bow(mat, c):
    """A simple bow: two loops and two tails, from the crossing on the lid."""
    obs = []
    z0 = PH + 0.005
    for side in (-1, 1):
        pts = []
        for i in range(17):
            a = 2 * math.pi * i / 16
            pts.append((side * (0.022 * (1 - math.cos(a)) * 0.5 + 0.002), 0.011 * math.sin(a), z0 + 0.008 * (1 - math.cos(a)) * 0.5))
        obs.append(tube(f'package_bowloop_{side}', pts, [0.0016] * len(pts), mat, segs=8, c=c))
        tail = [(0, 0, z0), (side * 0.012, -0.012, z0 - 0.001), (side * 0.02, -0.03, PH + 0.0035), (side * 0.024, -0.045, PH + 0.003)]
        obs.append(tube(f'package_tail_{side}', tail, [0.0016] * 4, mat, segs=8, c=c))
    knot = tube('package_knot', [(-0.003, 0, z0), (0.003, 0, z0)], [0.0032, 0.0032], mat, segs=10, c=c)
    obs.append(knot)
    return obs


def build_package(M, loc, rz=0.0, c='Package'):
    """The delivery: a tall kraft-wrapped box. Its four walls are hinged at the bottom so they can fall open outward
    (P['walls'][side] = hinge empty, rotation 'open' = 90° about its axis); the lid lifts off; the twine slides off.
    The lantern stands inside on the base (the act moves it there)."""
    kraft = M.setdefault('kraft', kraft_mat())
    tw = M.setdefault('twine', twine_mat())
    P = {}
    root = P['root'] = empty('package_root', loc, c)
    root.rotation_euler = (0, 0, rz)
    base = box('package_base', PW, PD, WALL, (0, 0, 0), bevel=0.0015, mat=kraft, c=c, origin='bottom')
    base.parent = root
    h = PH - LID_H + 0.006                         # the walls run up under the lid
    P['walls'] = {}
    # side: (hinge position, wall size (x, y), open rotation axis index, open angle)
    sides = {
        'front': ((0, -PD / 2, 0), (PW, WALL), 0, math.radians(92)),     # falls towards -Y
        'back': ((0, PD / 2, 0), (PW, WALL), 0, math.radians(-92)),
        'left': ((-PW / 2, 0, 0), (WALL, PD - 2 * WALL), 1, math.radians(-92)),
        'right': ((PW / 2, 0, 0), (WALL, PD - 2 * WALL), 1, math.radians(92)),
    }
    for side, (pos, (sx, sy), axis, ang) in sides.items():
        hg = empty(f'package_hinge_{side}', pos, c, root)
        inward = Vector(pos).normalized() * (-WALL / 2)
        w = box(f'package_wall_{side}', sx, sy, h, tuple(inward), bevel=0.0015, mat=kraft, c=c, origin='bottom')
        w.parent = hg
        P['walls'][side] = (hg, axis, ang)
    lid = P['lid'] = empty('package_lid', (0, 0, PH - LID_H), c, root)
    lb = box('package_lidbox', PW + 0.006, PD + 0.006, LID_H, (0, 0, 0), bevel=0.0025, mat=kraft, c=c, origin='bottom')
    lb.parent = lid
    tw_root = P['twine'] = empty('package_twine', (0, 0, 0), c, root)
    for ob in [_band('package_twine_x', 'x', tw, c), _band('package_twine_y', 'y', tw, c)] + _bow(tw, c):
        ob.parent = tw_root
    return P
