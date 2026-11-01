"""Pumpkins: one procedural generator for the decorative pumpkins and for the character.

The body is a grid in (u, phi) — u from the bottom pole to the top, phi around — shaped as a squashed sphere whose
radius is modulated into rounded lobes with sharp grooves, with dimples at both poles. Each vertex stores 'groove'
(0 on a lobe, 1 in a groove) for the skin shader. The stem is a ridged, tapering, curving tube.

The character is a hierarchy of empties (the rig): root (walks the floor) → body (bob, tilt, squash) → eyes, lids,
arms; root → legs. Eyes look along their local -Y and are aimed with a Damped Track at the 'look' target.
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
    'hero': ((0.66, 0.17, 0.01), (0.36, 0.075, 0.008), (0.9, 0.48, 0.12)),       # the character: a touch brighter
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


def skin_mat(name, variety='orange'):
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
    sp = map_range(nt, vor.outputs['Distance'], 0.0, 0.12, 0.55, 0.0)
    col = mix_rgb(nt, col, speck_c, sp)
    nt.links.new(col, bsdf.inputs['Base Color'])
    # waxy: moderate roughness, a soft coat, a little subsurface
    nt.links.new(map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0.32, 0.48), bsdf.inputs['Roughness'])
    bsdf.inputs['Coat Weight'].default_value = 0.35
    bsdf.inputs['Coat Roughness'].default_value = 0.28
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
    bp.inputs['Strength'].default_value = 0.12
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


# ---------------------------------------------------------------- the character

HERO_R = 0.12
HERO_SQUASH = 0.8
LEG = 0.072                      # hip height above the floor at rest


def eye_mat(name='eye'):
    """Sclera, iris and pupil in one shader, laid out around the eye's local -Y axis (its gaze). Two values drive the
    expression: 'pupil' (radius as a fraction of the iris) and 'glow' (warm light inside the iris)."""
    m, nt, bsdf, out = node_mat(name)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    # d = distance from the gaze axis in the XZ plane (object space, the eye mesh is a unit sphere scaled)
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(sep.outputs['X'], comb.inputs['X'])
    nt.links.new(sep.outputs['Z'], comb.inputs['Y'])
    ln = nt.nodes.new('ShaderNodeVectorMath')
    ln.operation = 'LENGTH'
    nt.links.new(comb.outputs[0], ln.inputs[0])
    front = map_range(nt, sep.outputs['Y'], -0.05, -0.35, 0.0, 1.0)       # only the front hemisphere
    pupil_v = nt.nodes.new('ShaderNodeValue')
    pupil_v.name = 'pupil'
    pupil_v.outputs[0].default_value = 0.42
    glow_v = nt.nodes.new('ShaderNodeValue')
    glow_v.name = 'glow'
    glow_v.outputs[0].default_value = 0.0
    IRIS = 0.68
    iris = map_range(nt, ln.outputs['Value'], IRIS - 0.015, IRIS + 0.015, 1.0, 0.0)
    pr = nt.nodes.new('ShaderNodeMath')
    pr.operation = 'MULTIPLY'
    pr.inputs[1].default_value = IRIS
    nt.links.new(pupil_v.outputs[0], pr.inputs[0])
    psub = nt.nodes.new('ShaderNodeMath')
    psub.operation = 'SUBTRACT'
    nt.links.new(ln.outputs['Value'], psub.inputs[0])
    nt.links.new(pr.outputs[0], psub.inputs[1])
    pupil = map_range(nt, psub.outputs[0], -0.012, 0.012, 1.0, 0.0)
    # iris pattern: radial fibres (noise on angle) and a darker limbal ring
    rad = map_range(nt, ln.outputs['Value'], 0.0, IRIS, 0.0, 1.0)
    fib = nt.nodes.new('ShaderNodeTexNoise')
    fib.inputs['Scale'].default_value = 40
    fib.inputs['Detail'].default_value = 3
    nt.links.new(comb.outputs[0], fib.inputs['Vector'])
    iris_col = mix_rgb(nt, (0.22, 0.10, 0.03), (0.62, 0.36, 0.10), map_range(nt, fib.outputs['Fac'], 0.35, 0.65, 0, 1))
    iris_col = mix_rgb(nt, iris_col, (0.05, 0.025, 0.01), map_range(nt, rad, 0.75, 1.0, 0, 1))
    m_front = nt.nodes.new('ShaderNodeMath')
    m_front.operation = 'MULTIPLY'
    nt.links.new(iris, m_front.inputs[0])
    nt.links.new(front, m_front.inputs[1])
    col = mix_rgb(nt, (0.80, 0.76, 0.70), iris_col, m_front.outputs[0])
    m_pf = nt.nodes.new('ShaderNodeMath')
    m_pf.operation = 'MULTIPLY'
    nt.links.new(pupil, m_pf.inputs[0])
    nt.links.new(front, m_pf.inputs[1])
    col = mix_rgb(nt, col, (0.004, 0.003, 0.003), m_pf.outputs[0])
    nt.links.new(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.35
    bsdf.inputs['Coat Weight'].default_value = 1.0
    bsdf.inputs['Coat Roughness'].default_value = 0.015
    bsdf.inputs['Coat IOR'].default_value = 1.38
    bsdf.inputs['Subsurface Weight'].default_value = 0.2
    bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.5, 0.4)
    bsdf.inputs['Subsurface Scale'].default_value = 0.005
    # glow: warm light inside the iris (not the pupil), strength = glow
    ig = nt.nodes.new('ShaderNodeMath')
    ig.operation = 'SUBTRACT'
    nt.links.new(m_front.outputs[0], ig.inputs[0])
    nt.links.new(m_pf.outputs[0], ig.inputs[1])
    gs = nt.nodes.new('ShaderNodeMath')
    gs.operation = 'MULTIPLY'
    nt.links.new(ig.outputs[0], gs.inputs[0])
    nt.links.new(glow_v.outputs[0], gs.inputs[1])
    bsdf.inputs['Emission Color'].default_value = (1.0, 0.55, 0.18, 1)
    nt.links.new(gs.outputs[0], bsdf.inputs['Emission Strength'])
    return m


def sphere(name, r, mat, c, segs=32, rings=16, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    return mesh_obj(name, bm, c, mat)


def lid_mesh(name, r, mat, c):
    """Upper eyelid: a shell slightly larger than the eye covering its top; rotating it about X opens/closes it."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=r)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -r * 0.05], context='VERTS')
    ob = mesh_obj(name, bm, c, mat)
    sol = ob.modifiers.new('thick', 'SOLIDIFY')
    sol.thickness = r * 0.12
    subsurf(ob, 1)
    return ob


def vine_mat(name='vine'):
    m, nt, bsdf, out = node_mat(name)
    nz = noise(nt, 120, 4)
    nt.links.new(mix_rgb(nt, (0.10, 0.14, 0.04), (0.20, 0.26, 0.08), map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0, 1)),
                 bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.5
    bsdf.inputs['Sheen Weight'].default_value = 0.4
    bsdf.inputs['Subsurface Weight'].default_value = 0.2
    bsdf.inputs['Subsurface Radius'].default_value = (0.4, 1.0, 0.2)
    bsdf.inputs['Subsurface Scale'].default_value = 0.004
    return m


def build_hero(M, c='Hero'):
    """The pumpkin character. Returns the rig: dict of empties and the eye material."""
    R, SQ = HERO_R, HERO_SQUASH
    M['skin_hero'] = skin_mat('skin_hero', 'hero')
    M.setdefault('stem', stem_mat())
    M['eye'] = eye_mat()
    M['vine'] = vine_mat()
    rig = {}
    root = rig['root'] = empty('hero_root', c=c)
    # body pivot at the bottom of the body (so squash keeps it on its legs)
    bottom = R * SQ * (1 - 0.3)
    body = rig['body'] = empty('hero_body', (0, 0, LEG), c, root)
    mesh, top_z = body_mesh('hero_mesh', R, SQ, ribs=10, depth=0.13, dip=0.3, seed=42, c=c)
    mesh.data.materials.append(M['skin_hero'])
    mesh.parent = body
    mesh.location = (0, 0, bottom)
    centre_z = bottom
    st = stem_mesh('hero_stem', R * 0.8, 5, M['stem'], c=c, length=R * 0.62, curl=1.8)
    st.parent = body
    st.location = (0, 0, bottom + top_z - R * 0.05)
    # a curly tendril from the stem base
    pts = []
    for i in range(22):
        t = i / 21
        a = t * 4.5 * math.pi
        rr = 0.012 * (1 - 0.6 * t)
        pts.append((0.02 + rr * math.cos(a) + t * 0.035, rr * math.sin(a) + 0.01, 0.006 + t * 0.03))
    td = tube('hero_tendril', pts, [0.0022 * (1 - 0.6 * i / 21) for i in range(22)], M['vine'], segs=6, c=c)
    td.parent = body
    td.location = (0, 0, bottom + top_z - R * 0.06)
    # eyes: on the front (-Y), a little above the equator, set into the skin
    er = 0.031
    rig['eyes'] = []
    rig['lids'] = []
    for side in (-1, 1):
        a = math.radians(20) * side
        ex = math.sin(a) * R * 0.8
        ey = -math.cos(a) * R * 0.8
        piv = empty(f'hero_eye_piv_{"L" if side > 0 else "R"}', (ex, ey, centre_z + R * 0.22), c, body)
        eye = sphere(f'hero_eye_{"L" if side > 0 else "R"}', 1.0, M['eye'], c)
        eye.parent = piv
        eye.scale = (er, er * 0.78, er * 1.1)          # unit sphere scaled: the shader's object coords stay normalised
        rig['eyes'].append(piv)
        lid = lid_mesh(f'hero_lid_{"L" if side > 0 else "R"}', er * 1.06, M['skin_hero'], c)
        lid.parent = piv
        lid.scale = (1, 0.9, 1.1)
        lid.rotation_euler = (math.radians(-8), 0, 0)           # rest: lids cover the top of the eye a little
        rig['lids'].append(lid)
    # a small, simple mouth: a soft dark crease, slightly smiling
    pts = []
    for i in range(9):
        t = (i / 8) * 2 - 1
        a = t * math.radians(13)
        pts.append((math.sin(a) * R * 0.97, -math.cos(a) * R * 0.97, centre_z - R * 0.08 + 0.008 * (t * t)))
    mouth = tube('hero_mouth', pts, [0.0025 + 0.0015 * (1 - abs((i / 8) * 2 - 1)) for i in range(9)],
                 M.setdefault('mouth', simple_dark()), segs=8, c=c)
    mouth.parent = body
    # arms: short vine limbs from the sides, mitten hands
    rig['arms'] = []
    for side in (-1, 1):
        sh = empty(f'hero_shoulder_{"L" if side > 0 else "R"}', (side * R * 0.93, -0.01, centre_z + 0.005), c, body)
        a = tube(f'hero_arm_{"L" if side > 0 else "R"}', [(0, 0, 0), (side * 0.022, -0.004, -0.018), (side * 0.032, -0.008, -0.045)],
                 [0.0115, 0.0095, 0.0085], M['vine'], segs=10, c=c)
        a.parent = sh
        subsurf(a, 1)
        h = sphere(f'hero_hand_{"L" if side > 0 else "R"}', 0.0145, M['vine'], c, scale=(0.85, 0.7, 1.15))
        h.parent = sh
        h.location = (side * 0.034, -0.009, -0.052)
        rig['arms'].append(sh)
    # legs: stubby, with rounded feet; pivot at the hip
    rig['legs'] = []
    for side in (-1, 1):
        hip = empty(f'hero_hip_{"L" if side > 0 else "R"}', (side * 0.042, 0.0, LEG + 0.012), c, root)
        lg = tube(f'hero_leg_{"L" if side > 0 else "R"}', [(0, 0, 0.01), (0, 0, -0.02), (0, -0.002, -LEG + 0.008)],
                  [0.0125, 0.0115, 0.0105], M['vine'], segs=10, c=c)
        lg.parent = hip
        subsurf(lg, 1)
        ft = sphere(f'hero_foot_{"L" if side > 0 else "R"}', 0.019, M['vine'], c, scale=(1.0, 1.4, 0.6))
        ft.parent = hip
        ft.location = (0, -0.009, -LEG - 0.012 + 0.0115)
        rig['legs'].append(hip)
    # gaze target
    rig['look'] = empty('hero_look', (0, -1.0, LEG + centre_z + R * 0.2), c)
    for piv in rig['eyes']:
        con = piv.constraints.new('DAMPED_TRACK')
        con.target = rig['look']
        con.track_axis = 'TRACK_NEGATIVE_Y'
    rig['centre_z'] = LEG + centre_z
    return rig


def simple_dark():
    m, nt, bsdf, out = node_mat('mouth')
    bsdf.inputs['Base Color'].default_value = (0.06, 0.015, 0.005, 1)
    bsdf.inputs['Roughness'].default_value = 0.6
    return m
