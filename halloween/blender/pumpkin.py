"""Pumpkins: one procedural generator for the decorative pumpkins and for the character.

The body is a grid in (u, phi) — u from the bottom pole to the top, phi around — shaped as a squashed sphere whose
radius is modulated into rounded lobes with sharp grooves, with dimples at both poles. Each vertex stores 'groove'
(0 on a lobe, 1 in a groove) for the skin shader. The stem is a ridged, tapering, curving tube.

The character is a carved jack-o'-lantern: the body made hollow (solidify), its face and lid cut with boolean cutters,
the result baked into one mesh, a candle inside. The rig: root (travels the floor) → body (hop, tilt, roll).
"""
import bpy, bmesh, math
from mathutils import Vector, Matrix
from lib import mesh_obj, tube, empty, node_mat, noise, map_range, mix_rgb, rng, subsurf, link

VARIETIES = {
    # lobe colour, groove colour, speckle colour
    'orange': ((0.78, 0.24, 0.025), (0.42, 0.12, 0.02), (0.95, 0.55, 0.15)),
    'deep': ((0.55, 0.12, 0.02), (0.28, 0.06, 0.015), (0.8, 0.35, 0.1)),
    'white': ((0.72, 0.68, 0.58), (0.42, 0.44, 0.34), (0.85, 0.8, 0.7)),
    'jarrah': ((0.30, 0.36, 0.34), (0.18, 0.22, 0.21), (0.45, 0.5, 0.46)),    # blue-grey heirloom
    'hero': ((0.56, 0.15, 0.012), (0.27, 0.06, 0.008), (0.75, 0.40, 0.11)),      # the character: deep, aged orange
}


def body_mesh(name, R=0.12, squash=0.78, ribs=10, depth=0.09, dip=0.35, seed=0, rows=40, per_rib=10, lean=0.0, c='Pumpkins'):
    Rg = rng(seed)
    cols = ribs * per_rib
    rib_amp = [1.0 + Rg.uniform(-0.25, 0.25) for _ in range(ribs)]         # lobes differ slightly
    rib_w = [1.0 + Rg.uniform(-0.12, 0.12) for _ in range(ribs)]
    # cumulative widths → uneven lobe spacing
    tot = sum(rib_w)
    edges = [0.0]
    for w in rib_w:
        edges.append(edges[-1] + w / tot * 2 * math.pi)

    def lobe(phi):
        for i in range(ribs):
            if edges[i] <= phi < edges[i + 1]:
                t = (phi - edges[i]) / (edges[i + 1] - edges[i])
                s = math.sin(math.pi * t) ** 0.42                            # rounded lobe, sharp groove
                return s * (0.85 + 0.15 * rib_amp[i]), 1 - s
        return 0.0, 1.0
    bm = bmesh.new()
    gl = bm.verts.layers.float.new('groove')
    grid = []
    for j in range(1, rows):
        u = j / rows
        th = math.pi * u
        rad = math.sin(th) ** 0.7
        z = -math.cos(th)
        row = []
        for k in range(cols):
            phi = 2 * math.pi * k / cols + 0.06 * math.sin(3 * th + seed)    # a slight twist
            phi %= 2 * math.pi
            l, g = lobe(phi)
            fade = math.sin(th) ** 0.6                                        # grooves soften towards the poles
            r = R * rad * (1 - depth * fade + depth * fade * l)
            zz = R * squash * z
            # pole dimples: pull the surface near each pole inwards (the stem sits in the top hollow)
            pull = math.exp(-((rad / 0.32) ** 2))
            zz -= math.copysign(R * squash * dip * pull, z)
            zz += lean * R * rad * math.cos(phi)
            v = bm.verts.new((r * math.cos(phi), r * math.sin(phi), zz))
            v[gl] = g * fade + (1 - fade) * 0.3
            row.append(v)
        grid.append(row)
    bot = bm.verts.new((0, 0, -R * squash * (1 - dip) + 0.002))
    top = bm.verts.new((0, 0, R * squash * (1 - dip) - 0.002))
    bot[gl] = top[gl] = 0.6
    for a, b in zip(grid, grid[1:]):
        for k in range(cols):
            bm.faces.new((a[k], a[(k + 1) % cols], b[(k + 1) % cols], b[k]))
    for k in range(cols):
        bm.faces.new((grid[0][(k + 1) % cols], grid[0][k], bot))
        bm.faces.new((grid[-1][k], grid[-1][(k + 1) % cols], top))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(name, bm, c)
    subsurf(ob, 1, 2)
    top_z = R * squash * (1 - dip)
    return ob, top_z


def stem_mesh(name, R, seed, mat, c='Pumpkins', length=None, curl=1.0):
    """A ridged, fibrous stem rising from the top hollow and curving over."""
    Rg = rng(seed + 100)
    L = length or R * Rg.uniform(0.35, 0.55)
    n = 8
    ang = Rg.uniform(0, 2 * math.pi)
    bend = Rg.uniform(0.4, 0.9) * curl
    pts, radii = [], []
    for i in range(n):
        t = i / (n - 1)
        x = math.sin(t * bend) * L * 0.6 * t
        pts.append((x * math.cos(ang), x * math.sin(ang), t * L))
        radii.append(R * (0.16 - 0.06 * t + 0.1 * (1 - t) ** 6))          # flared base
    ob = tube(name, pts, radii, mat, segs=12, c=c)
    # ridges: pull every other vertex of each ring towards the axis
    me = ob.data
    segs = 12
    for ri in range(n):
        centre = Vector(pts[ri])
        for k in range(segs):
            v = me.vertices[ri * segs + k]
            if k % 2:
                v.co = centre + (v.co - centre) * 0.8
    subsurf(ob, 1)
    return ob


def skin_mat(name, variety='orange', aged=False):
    """aged=True (the character, seen close): pale vertical striations along the lobes, dark bruised blemishes, a
    duller, rougher surface."""
    lobe_c, groove_c, speck_c = VARIETIES[variety]
    m, nt, bsdf, out = node_mat(name)
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = 'groove'
    g = map_range(nt, attr.outputs['Fac'], 0.25, 0.95, 0.0, 1.0)
    # low-frequency mottling along the lobes (vertically stretched noise)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (14, 14, 3.5)
    nt.links.new(tc.outputs['Object'], mp.inputs[0])
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 2.0
    nz.inputs['Detail'].default_value = 8
    nt.links.new(mp.outputs[0], nz.inputs['Vector'])
    mott = map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0.0, 1.0)
    lobe_dark = tuple(c * 0.78 for c in lobe_c)
    col = mix_rgb(nt, lobe_dark, lobe_c, mott)
    col = mix_rgb(nt, col, groove_c, g)
    # fine pale speckles (lenticels)
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 90
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    sp = map_range(nt, vor.outputs['Distance'], 0.0, 0.12, 0.1 if aged else 0.55, 0.0)
    col = mix_rgb(nt, col, speck_c, sp)
    if aged:
        # fine vertical striations, paler and yellower, strongest on the lobes
        stz = nt.nodes.new('ShaderNodeTexNoise')
        mps = nt.nodes.new('ShaderNodeMapping')
        mps.inputs['Scale'].default_value = (70, 70, 4)
        nt.links.new(tc.outputs['Object'], mps.inputs[0])
        nt.links.new(mps.outputs[0], stz.inputs['Vector'])
        stz.inputs['Detail'].default_value = 6
        stripe = map_range(nt, stz.outputs['Fac'], 0.52, 0.68, 0.0, 0.45)
        col = mix_rgb(nt, col, tuple(min(1, c * 1.5 + 0.05) for c in lobe_c), stripe)
        # bruises and scars: sparse dark brown patches
        bl = nt.nodes.new('ShaderNodeTexNoise')
        bl.inputs['Scale'].default_value = 26
        bl.inputs['Detail'].default_value = 10
        bl.inputs['Roughness'].default_value = 0.65
        nt.links.new(tc.outputs['Object'], bl.inputs['Vector'])
        bruise = map_range(nt, bl.outputs['Fac'], 0.66, 0.76, 0.0, 0.85)
        col = mix_rgb(nt, col, (0.10, 0.035, 0.01), bruise)
    nt.links.new(col, bsdf.inputs['Base Color'])
    # waxy: moderate roughness, a soft coat, a little subsurface
    nt.links.new(map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0.32, 0.48), bsdf.inputs['Roughness'])
    bsdf.inputs['Coat Weight'].default_value = 0.12 if aged else 0.35
    bsdf.inputs['Coat Roughness'].default_value = 0.4 if aged else 0.28
    bsdf.inputs['Subsurface Weight'].default_value = 0.15
    bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.4, 0.1)
    bsdf.inputs['Subsurface Scale'].default_value = 0.01
    # bump: fine vertical streaks and pitting
    streak = nt.nodes.new('ShaderNodeTexNoise')
    mp2 = nt.nodes.new('ShaderNodeMapping')
    mp2.inputs['Scale'].default_value = (160, 160, 12)
    nt.links.new(tc.outputs['Object'], mp2.inputs[0])
    nt.links.new(mp2.outputs[0], streak.inputs['Vector'])
    streak.inputs['Detail'].default_value = 4
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.3 if aged else 0.12
    bp.inputs['Distance'].default_value = 0.0008
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    nt.links.new(streak.outputs['Fac'], add.inputs[0])
    nt.links.new(sp, add.inputs[1])
    nt.links.new(add.outputs[0], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Coat Normal'])
    return m


def stem_mat(name='stem'):
    m, nt, bsdf, out = node_mat(name)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (300, 300, 20)
    nt.links.new(tc.outputs['Object'], mp.inputs[0])
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Detail'].default_value = 6
    nt.links.new(mp.outputs[0], nz.inputs['Vector'])
    f = map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0, 1)
    nt.links.new(mix_rgb(nt, (0.10, 0.09, 0.04), (0.32, 0.30, 0.17), f), bsdf.inputs['Base Color'])
    nt.links.new(map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0.55, 0.85), bsdf.inputs['Roughness'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.5
    bp.inputs['Distance'].default_value = 0.001
    nt.links.new(nz.outputs['Fac'], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    return m


def decor(M, name, loc, R=0.1, variety='orange', squash=0.75, ribs=10, seed=0, rz=0.0, c='Pumpkins'):
    """A decorative pumpkin resting on a surface at loc (its bottom touches loc's z)."""
    key = 'skin_' + variety
    if key not in M:
        M[key] = skin_mat(key, variety)
    if 'stem' not in M:
        M['stem'] = stem_mat()
    root = empty(name, c=c)
    body, top_z = body_mesh(name + '_body', R, squash, ribs, seed=seed, c=c)
    body.data.materials.append(M[key])
    body.parent = root
    bottom = R * squash * (1 - 0.35)
    body.location = (0, 0, bottom)
    st = stem_mesh(name + '_stem', R, seed, M['stem'], c=c)
    st.parent = root
    st.location = (0, 0, bottom + top_z - R * 0.04)
    root.location = loc
    root.rotation_euler = (0, 0, math.radians(rz))
    return root


def sphere(name, r, mat, c, segs=32, rings=16, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    return mesh_obj(name, bm, c, mat)


# ---------------------------------------------------------------- the character: a carved jack-o'-lantern

HERO_R = 0.13
HERO_SQUASH = 0.84
WALL = 0.014                     # the pumpkin's wall thickness

# The carved faces, in units of HERO_R on the front (-Y) of the pumpkin, as seen from the front (x right, z up). Each
# face is a list of closed polygons. Like a stop-motion puppet, the character swaps whole faces to change expression.

def ellipse(cx, cz, rx, rz, rot=0.0, n=28):
    c, s_ = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    return [(cx + rx * math.cos(a) * c - rz * math.sin(a) * s_, cz + rx * math.cos(a) * s_ + rz * math.sin(a) * c)
            for a in (2 * math.pi * k / n for k in range(n))]


def arc_band(cx, cz, w, h_out, h_in, n=16):
    """A crescent band between two parabolas through the same end points: h > 0 bulges up (∩, closed happy eyes),
    h < 0 sags down (∪, a smile). |h_out| > |h_in|; the band tapers to points at x = cx ± w."""
    xs = [cx - w + 2 * w * k / n for k in range(n + 1)]
    outer = [(x, cz + h_out * (1 - ((x - cx) / w) ** 2)) for x in xs]
    inner = [(x, cz + h_in * (1 - ((x - cx) / w) ** 2)) for x in reversed(xs[1:-1])]
    return outer + inner


def mirror(poly):
    return [(-x, z) for x, z in reversed(poly)]


NOSE = [(-0.075, -0.06), (0.075, -0.06), (0.0, 0.07)]
_stern_eye = [(-0.60, 0.33), (-0.17, 0.17), (-0.29, 0.03), (-0.53, 0.10)]
_hope_eye = ellipse(-0.31, 0.18, 0.14, 0.12, rot=14)       # inner corner (towards +x) raised
FACES = {
    # the first jack-o'-lantern: frowning eyes, jagged grimace (approved look, kept for reference)
    'stern': [_stern_eye, mirror(_stern_eye), NOSE,
              [(-0.62, -0.13), (-0.40, -0.24), (-0.30, -0.25), (-0.25, -0.37), (-0.19, -0.26),
               (0.11, -0.27), (0.17, -0.38), (0.22, -0.26), (0.40, -0.24), (0.62, -0.13),
               (0.47, -0.33), (0.26, -0.44), (0.05, -0.47), (0.01, -0.36), (-0.04, -0.47),
               (-0.26, -0.45), (-0.46, -0.34)]],
    # round eyes, the left a touch larger; a small closed mouth, slightly lopsided
    'curious': [ellipse(-0.31, 0.19, 0.14, 0.16), ellipse(0.31, 0.18, 0.125, 0.145), NOSE,
                arc_band(0.04, -0.30, 0.17, -0.07, -0.025)],
    # big round eyes, a small round "o"
    'wonder': [ellipse(-0.31, 0.20, 0.16, 0.19), ellipse(0.31, 0.20, 0.16, 0.19), NOSE, ellipse(0.0, -0.32, 0.07, 0.08)],
    # soft eyes tilted up at the inner corners, a gentle smile
    'hopeful': [_hope_eye, mirror(_hope_eye), NOSE, arc_band(0.0, -0.24, 0.30, -0.15, -0.07)],
    # tall eyes, a big "O"
    'surprised': [ellipse(-0.31, 0.22, 0.12, 0.21), ellipse(0.31, 0.22, 0.12, 0.21), NOSE,
                  ellipse(0.0, -0.34, 0.12, 0.15)],
    # closed, smiling crescent eyes and a wide open smile
    'delighted': [arc_band(-0.31, 0.12, 0.17, 0.17, 0.08), arc_band(0.31, 0.12, 0.17, 0.17, 0.08), NOSE,
                  arc_band(0.0, -0.17, 0.46, -0.30, -0.08)],
}
FACE_ORDER = ['curious', 'wonder', 'hopeful', 'surprised', 'delighted', 'stern']


def flesh_mat(name='flesh'):
    """The carved flesh: pale, fibrous, translucent. 'glow' (a Value node) adds the candle's warmth from within."""
    m, nt, bsdf, out = node_mat(name)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (60, 60, 8)
    nt.links.new(tc.outputs['Object'], mp.inputs[0])
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Detail'].default_value = 8
    nt.links.new(mp.outputs[0], nz.inputs['Vector'])
    f = map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0, 1)
    col = mix_rgb(nt, (0.42, 0.13, 0.015), (0.78, 0.34, 0.05), f)
    nt.links.new(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.5
    bsdf.inputs['Subsurface Weight'].default_value = 0.4
    bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.5, 0.15)
    bsdf.inputs['Subsurface Scale'].default_value = 0.01
    glow = nt.nodes.new('ShaderNodeValue')
    glow.name = 'glow'
    glow.outputs[0].default_value = 0.15
    bsdf.inputs['Emission Color'].default_value = (1.0, 0.42, 0.07, 1)
    gm = nt.nodes.new('ShaderNodeMath')
    gm.operation = 'MULTIPLY'
    nt.links.new(glow.outputs[0], gm.inputs[0])
    nt.links.new(map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0.6, 1.2), gm.inputs[1])
    nt.links.new(gm.outputs[0], bsdf.inputs['Emission Strength'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.4
    bp.inputs['Distance'].default_value = 0.0015
    nt.links.new(nz.outputs['Fac'], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    return m


def radial_prism(name, loops, mat, c, near=0.5, far=1.6):
    """A solid cutter: each closed loop of points (mesh space) is extruded along rays from the pumpkin's centre, from
    near× to far× its distance, so the cut walls point at the centre the way a knife does. One loop → a solid prism;
    two loops (outer, inner, same length) → a thin annular wall (the lid's kerf)."""
    bm = bmesh.new()
    rings = [[bm.verts.new(Vector(p) * s) for p in lp] for lp in loops for s in (near, far)]
    n = len(loops[0])

    def band(a, b):
        for k in range(n):
            bm.faces.new((a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]))
    if len(loops) == 1:
        bm.faces.new(rings[0])
        bm.faces.new(rings[1])
        band(rings[0], rings[1])
    else:
        band(rings[0], rings[1])          # outer wall
        band(rings[2], rings[3])          # inner wall
        band(rings[0], rings[2])          # near cap
        band(rings[1], rings[3])          # far cap
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(name, bm, c, mat, smooth_shade=False)
    for p in ob.data.polygons:
        p.material_index = len(ob.data.materials) - 1
    ob.hide_render = True
    return ob


def carved_body(M, c, face='curious'):
    """The hollow, carved pumpkin as one baked mesh: skin outside (slot 0), flesh inside and on every cut (slot 1).
    Every face is the same pumpkin (same seed, same lid) with a different carving."""
    R, SQ = HERO_R, HERO_SQUASH
    ob, top_z = body_mesh('hero_face_' + face, R, SQ, ribs=10, depth=0.11, dip=0.3, seed=42, rows=48, per_rib=12, c=c)
    ob.modifiers['sub'].levels = ob.modifiers['sub'].render_levels = 1
    ob.data.materials.append(M['skin_hero'])
    ob.data.materials.append(M['flesh'])
    sol =ob.modifiers.new('wall', 'SOLIDIFY')
    sol.thickness = WALL
    sol.offset = -1
    sol.use_even_offset = True
    sol.material_offset = 1
    sol.material_offset_rim = 1
    cutters = []
    for i, poly in enumerate(FACES[face]):
        lp = [(x * FACE_SCALE * R, -R, z * FACE_SCALE * R * SQ + R * 0.03) for x, z in poly]
        cutters.append(radial_prism(f'cut_{face}_{i}', [lp], [M['skin_hero'], M['flesh']], c))
    # the lid: an irregular ring around the stem with a key notch at the back, cut as a thin kerf
    Rg = rng(7)
    h0, rho, kerf = R * SQ * 0.88, R * 0.36, 0.0013
    outer, inner = [], []
    N = 40
    for k in range(N):
        a = 2 * math.pi * k / N
        r = rho * (1 + 0.06 * math.sin(5 * a + 1.0) + Rg.uniform(-0.015, 0.015))
        if abs(((a - math.pi / 2 + math.pi) % (2 * math.pi)) - math.pi) < 0.18:
            r += R * 0.05                                                       # the notch, at the back (+Y)
        outer.append(((r + kerf) * math.cos(a), (r + kerf) * math.sin(a), h0))
        inner.append(((r - kerf) * math.cos(a), (r - kerf) * math.sin(a), h0))
    cutters.append(radial_prism('cut_lid', [outer, inner], [M['skin_hero'], M['flesh']], c, near=0.6, far=1.4))
    for ct in cutters:
        b = ob.modifiers.new(ct.name, 'BOOLEAN')
        b.operation = 'DIFFERENCE'
        b.solver = 'EXACT'
        b.object = ct
        b.material_mode = 'INDEX'           # the cutters' faces use slot 1 (flesh), so every cut wall is flesh
    # bake the modifier stack into the mesh (it never changes, and booleans are slow to re-evaluate per frame)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    # deeper grooves make the inner wall fold through itself and the exact boolean then returns almost nothing
    assert len(me.polygons) > 30000, f'carving failed: {len(me.polygons)} faces'
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    for ct in cutters:
        bpy.data.objects.remove(ct)
    assert [m.name for m in me.materials[:2]] == ['skin_hero', 'flesh'], list(me.materials)   # (clearing them resets indices)
    for p in me.polygons:
        p.material_index = min(p.material_index, 1)
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(35))
    return ob, top_z


def vine_mat(name='vine'):
    """Living-but-tough vine: olive to brown along fine lengthwise fibres, rough, with a faint fuzz (sheen)."""
    m, nt, bsdf, out = node_mat(name)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 140
    nz.inputs['Detail'].default_value = 6
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    blot = nt.nodes.new('ShaderNodeTexNoise')
    blot.inputs['Scale'].default_value = 18
    nt.links.new(tc.outputs['Object'], blot.inputs['Vector'])
    col = mix_rgb(nt, (0.07, 0.08, 0.025), (0.17, 0.17, 0.06), map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0, 1))
    col = mix_rgb(nt, col, (0.16, 0.10, 0.04), map_range(nt, blot.outputs['Fac'], 0.5, 0.7, 0, 0.8))
    nt.links.new(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.62
    bsdf.inputs['Sheen Weight'].default_value = 0.35
    bsdf.inputs['Sheen Roughness'].default_value = 0.4
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.5
    bp.inputs['Distance'].default_value = 0.0008
    nt.links.new(nz.outputs['Fac'], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    return m


def vine(name, a, b, r0, r1, mat, c, seed, bend=0.15):
    """A gnarled vine segment from a to b (local coords): a slight bow, a twist of thickness and small bumps."""
    Rg = rng(seed)
    a, b = Vector(a), Vector(b)
    d = b - a
    side = d.orthogonal().normalized()
    side.rotate(__import__('mathutils').Quaternion(d.normalized(), Rg.uniform(0, 6.28)))
    n = 9
    pts, radii = [], []
    for i in range(n):
        t = i / (n - 1)
        pts.append(a + d * t + side * math.sin(math.pi * t) * d.length * bend)
        radii.append((r0 + (r1 - r0) * t) * (1 + 0.12 * math.sin(t * 9 + seed) + Rg.uniform(-0.05, 0.05)))
    ob = tube(name, pts, radii, mat, segs=10, c=c)
    subsurf(ob, 1)
    return ob


def knot(name, r, mat, c, seed):
    """A vine knot covering a joint: a lumpy, slightly flattened sphere."""
    Rg = rng(seed + 50)
    ob = sphere(name, r, mat, c, segs=16, rings=10, scale=(1 + Rg.uniform(-0.1, 0.15), 1 + Rg.uniform(-0.1, 0.15), 0.85))
    subsurf(ob, 1)
    return ob


def tendrils(name, base, dirs, length, r, mat, c, seed, curl=1.0):
    """Three tendril fingers (or root toes) from a point, each curling at its tip; one object per tendril."""
    obs = []
    for k, dv in enumerate(dirs):
        dv = Vector(dv).normalized()
        down = dv.cross(Vector((0, 0, 1))).normalized() if abs(dv.z) < 0.9 else Vector((1, 0, 0))
        curlv = dv.cross(down).normalized()
        pts, radii = [Vector(base)], [r]
        p, n = Vector(base), 8
        for i in range(1, n):
            t = i / (n - 1)
            ang = t * t * 2.2 * curl                     # the tip curls more than the base
            p = p + (dv * math.cos(ang) + curlv * math.sin(ang)) * (length / (n - 1))
            pts.append(p.copy())
            radii.append(r * (1 - 0.65 * t))
        obs.append(tube(f'{name}{k}', pts, radii, mat, segs=8, c=c))
    return obs


LEG = 0.075                      # hip height above the floor at rest: the body stands on its legs
UPPER, LOWER = 0.042, 0.042      # thigh and shin
ARM_U, ARM_L = 0.056, 0.05       # upper arm and forearm
FACE_SCALE = 1.15               # all carvings, about the face's centre


def build_hero(M, c='Hero'):
    """The character: a carved jack-o'-lantern with a candle burning inside, on thin gnarled vine arms and legs.

    Rig (empties; rotate them to pose):
      root (travels the floor, heading = rotation z)
        body (bob, lean, roll; pivot at the base of the pumpkin) → faces (one visible), stem, candle,
          shoulder_L/R → elbow → wrist (+ three tendril fingers)
        hip_L/R → knee → ankle (+ a root-like foot)
    Faces: rig['faces'][name] — show one with set_face(rig, name, frame)."""
    from fire import candle
    R, SQ = HERO_R, HERO_SQUASH
    M['skin_hero'] = skin_mat('skin_hero', 'hero', aged=True)
    M.setdefault('stem', stem_mat())
    M['flesh'] = flesh_mat()
    M['vine'] = vine_mat()
    V = M['vine']
    rig = {}
    root = rig['root'] = empty('hero_root', c=c)
    body = rig['body'] = empty('hero_body', (0, 0, LEG), c, root)
    bottom = R * SQ * (1 - 0.3)
    rig['faces'] = {}
    for fc in FACE_ORDER:
        mesh, top_z = carved_body(M, c, fc)
        mesh.parent = body
        mesh.location = (0, 0, bottom)
        rig['faces'][fc] = mesh
    st = stem_mesh('hero_stem', R * 1.05, 5, M['stem'], c=c, length=R * 0.42, curl=1.3)
    st.parent = body
    st.location = (0, 0, bottom + top_z - R * 0.05)
    cr, lt = candle('hero_candle', (0, 0.01, WALL + 0.004), h=0.045, r=0.017, M=M, power=2.5, seed=31, c=c)
    cr.parent = body
    rig['candle_light'] = lt
    rig['flame'] = bpy.data.objects['hero_candle_flame']
    rig['centre_z'] = LEG + bottom
    # --- arms: from the sides a little below the equator; at rest they hang down and slightly out
    rig['arm'] = {}
    for side, nm in ((-1, 'R'), (1, 'L')):          # the character's own left is +X (it faces -Y)
        sh = empty(f'hero_shoulder_{nm}', (side * R * 0.93, -0.02, bottom - R * 0.02), c, body)
        up = vine(f'hero_upperarm_{nm}', (0, 0, 0), (0, 0, -ARM_U), 0.0095, 0.0078, V, c, seed=10 + side)
        up.parent = sh
        knot(f'hero_shoulderknot_{nm}', 0.012, V, c, 3 + side).parent = sh
        el = empty(f'hero_elbow_{nm}', (0, 0, -ARM_U), c, sh)
        lo = vine(f'hero_forearm_{nm}', (0, 0, 0), (0, 0, -ARM_L), 0.0078, 0.0064, V, c, seed=20 + side)
        lo.parent = el
        knot(f'hero_elbowknot_{nm}', 0.0095, V, c, 5 + side).parent = el
        wr = empty(f'hero_wrist_{nm}', (0, 0, -ARM_L), c, el)
        knot(f'hero_wristknot_{nm}', 0.0078, V, c, 7 + side).parent = wr
        for t in tendrils(f'hero_finger_{nm}', (0, 0, 0), [(side * 0.5, -0.5, -1), (0, -0.35, -1), (-side * 0.45, -0.1, -1)],
                          0.036, 0.0045, V, c, seed=30 + side):
            t.parent = wr
        sh.rotation_euler = (math.radians(4), side * math.radians(-18), 0)        # out from the body
        el.rotation_euler = (math.radians(-22), 0, 0)                            # forearm a little forward
        rig['arm'][nm] = (sh, el, wr)
    # --- legs: under the body, a little apart; knees slightly bent; feet like small splayed roots
    rig['leg'] = {}
    for side, nm in ((-1, 'R'), (1, 'L')):
        hp_ = empty(f'hero_hip_{nm}', (side * 0.04, 0.0, LEG + 0.01), c, root)
        th = vine(f'hero_thigh_{nm}', (0, 0, 0.012), (0, 0, -UPPER), 0.0085, 0.007, V, c, seed=40 + side, bend=0.08)
        th.parent = hp_
        kn = empty(f'hero_knee_{nm}', (0, 0, -UPPER), c, hp_)
        sn = vine(f'hero_shin_{nm}', (0, 0, 0), (0, 0, -LOWER), 0.007, 0.0058, V, c, seed=50 + side, bend=0.08)
        sn.parent = kn
        knot(f'hero_kneeknot_{nm}', 0.0085, V, c, 9 + side).parent = kn
        an = empty(f'hero_ankle_{nm}', (0, 0, -LOWER), c, kn)
        knot(f'hero_ankleknot_{nm}', 0.0075, V, c, 11 + side).parent = an
        for t in tendrils(f'hero_toe_{nm}', (0, 0, -0.004), [(side * 0.6, -1, -0.15), (0, -1, -0.12), (-side * 0.5, -0.9, -0.1)],
                          0.038, 0.005, V, c, seed=60 + side, curl=-0.5):
            t.parent = an
        hp_.rotation_euler = (math.radians(-6), 0, 0)
        kn.rotation_euler = (math.radians(12), 0, 0)
        an.rotation_euler = (math.radians(-6), 0, 0)
        rig['leg'][nm] = (hp_, kn, an)
    set_face(rig, 'curious')
    return rig


def set_face(rig, name, frame=None):
    """Show one carved face and hide the others; with frame, key it (constant: faces swap on the frame)."""
    for fc, ob in rig['faces'].items():
        hide = fc != name
        ob.hide_render = ob.hide_viewport = hide
        if frame is not None:
            ob.keyframe_insert('hide_render', frame=frame)
            ob.keyframe_insert('hide_viewport', frame=frame)
