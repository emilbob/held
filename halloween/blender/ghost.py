"""The ghost: a small floating sheet of old ivory linen with nothing inside it but darkness.

Grounded, not cartoonish (to match the carved pumpkin): a draped cloth shape with folds that deepen towards a frayed
hem, slightly translucent linen, and two eye holes cut through the cloth. Behind the holes is a black void, so the eyes
read as dark openings. No mouth; it acts with its whole body. No cloth simulation: the hem ripples with a Wave modifier.

The mesh's origin is the centre of the head; the hem hangs GHOST_HEM below it.
"""
import bpy, bmesh, math
from mathutils import Vector, noise
from lib import mesh_obj, node_mat, map_range, mix_rgb, rng, subsurf, empty
from pumpkin import radial_prism, sphere

HEAD_R = 0.075
GHOST_HEM = 0.265                # from the head's centre down to the hem (before folds and drag)
GHOST_FLOAT = 0.025              # the lowest point of the hem floats this high above the floor
# the profile of the drape (radius, height) from the crown down to the hem
PROFILE = [(0.0, 0.075), (0.04, 0.065), (0.066, 0.04), (0.077, 0.0), (0.079, -0.04), (0.086, -0.10), (0.10, -0.17),
           (0.13, -0.225), (0.152, -0.265)]


def _profile(t):
    """Catmull-Rom through PROFILE, t in [0, 1] from crown to hem."""
    n = len(PROFILE) - 1
    x = min(t * n, n - 1e-6)
    i = int(x)
    f = x - i
    p = [Vector(PROFILE[max(0, min(n, k))]) for k in (i - 1, i, i + 1, i + 2)]
    return 0.5 * ((2 * p[1]) + (-p[0] + p[2]) * f + (2 * p[0] - 5 * p[1] + 4 * p[2] - p[3]) * f * f
                  + (-p[0] + 3 * p[1] - 3 * p[2] + p[3]) * f ** 3)


def linen_mat(name='linen'):
    m, nt, bsdf, out = node_mat(name)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    # age: faint yellowed stains and a greyer, dustier hem
    st = nt.nodes.new('ShaderNodeTexNoise')
    st.inputs['Scale'].default_value = 9
    st.inputs['Detail'].default_value = 6
    nt.links.new(tc.outputs['Object'], st.inputs['Vector'])
    col = mix_rgb(nt, (0.50, 0.47, 0.40), (0.62, 0.59, 0.51), map_range(nt, st.outputs['Fac'], 0.35, 0.65, 0, 1))
    col = mix_rgb(nt, col, (0.40, 0.33, 0.22), map_range(nt, st.outputs['Fac'], 0.6, 0.75, 0, 0.7))
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    col = mix_rgb(nt, col, (0.28, 0.26, 0.23), map_range(nt, sep.outputs['Z'], -0.17, -0.29, 0, 0.7))
    nt.links.new(col, bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.85
    bsdf.inputs['Sheen Weight'].default_value = 0.35
    bsdf.inputs['Sheen Roughness'].default_value = 0.35
    bsdf.inputs['Subsurface Weight'].default_value = 0.15
    bsdf.inputs['Subsurface Radius'].default_value = (1.0, 0.9, 0.7)
    bsdf.inputs['Subsurface Scale'].default_value = 0.004
    # weave: two fine wave textures crossing
    bump_h = None
    for axis in ('X', 'Y'):
        w = nt.nodes.new('ShaderNodeTexWave')
        w.bands_direction = axis
        w.inputs['Scale'].default_value = 420
        w.inputs['Distortion'].default_value = 2.0
        w.inputs['Detail'].default_value = 2
        nt.links.new(tc.outputs['Object'], w.inputs['Vector'])
        if bump_h is None:
            bump_h = w.outputs['Fac']
        else:
            add = nt.nodes.new('ShaderNodeMath')
            add.operation = 'ADD'
            nt.links.new(bump_h, add.inputs[0])
            nt.links.new(w.outputs['Fac'], add.inputs[1])
            bump_h = add.outputs[0]
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.25
    bp.inputs['Distance'].default_value = 0.0003
    nt.links.new(bump_h, bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    # thin cloth: some light comes through
    tr = nt.nodes.new('ShaderNodeBsdfTranslucent')
    nt.links.new(col, tr.inputs['Color'])
    mix = nt.nodes.new('ShaderNodeMixShader')
    mix.inputs['Fac'].default_value = 0.1
    nt.links.new(bsdf.outputs[0], mix.inputs[1])
    nt.links.new(tr.outputs[0], mix.inputs[2])
    # dissolve: 'dissolve' 0 = whole, 1 = gone; the cloth goes from the hem upwards, in a ragged, smoky edge
    d = nt.nodes.new('ShaderNodeValue')
    d.name = 'dissolve'
    d.outputs[0].default_value = 0.0
    h = map_range(nt, sep.outputs['Z'], -0.30, 0.08, 0.0, 1.0)              # 0 at the hem, 1 at the crown
    rag = nt.nodes.new('ShaderNodeTexNoise')
    rag.inputs['Scale'].default_value = 30
    rag.inputs['Detail'].default_value = 5
    nt.links.new(tc.outputs['Object'], rag.inputs['Vector'])
    edge = nt.nodes.new('ShaderNodeMath')
    edge.operation = 'MULTIPLY_ADD'                                         # h * 0.75 + noise * 0.25
    nt.links.new(h, edge.inputs[0])
    edge.inputs[1].default_value = 0.75
    rn = nt.nodes.new('ShaderNodeMath')
    rn.operation = 'MULTIPLY'
    nt.links.new(rag.outputs['Fac'], rn.inputs[0])
    rn.inputs[1].default_value = 0.25
    nt.links.new(rn.outputs[0], edge.inputs[2])
    lvl = nt.nodes.new('ShaderNodeMath')
    lvl.operation = 'MULTIPLY'
    nt.links.new(d.outputs[0], lvl.inputs[0])
    lvl.inputs[1].default_value = 1.15
    gone = nt.nodes.new('ShaderNodeMath')
    gone.operation = 'LESS_THAN'
    nt.links.new(edge.outputs[0], gone.inputs[0])
    nt.links.new(lvl.outputs[0], gone.inputs[1])
    tp = nt.nodes.new('ShaderNodeBsdfTransparent')
    mix2 = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(gone.outputs[0], mix2.inputs['Fac'])
    nt.links.new(mix.outputs[0], mix2.inputs[1])
    nt.links.new(tp.outputs[0], mix2.inputs[2])
    nt.links.new(mix2.outputs[0], out.inputs['Surface'])
    m.surface_render_method = 'DITHERED'
    m.use_backface_culling = False
    return m


def smoke_mat(name='ghost_smoke'):
    """A soft, pale, slowly churning wisp: alpha from stretched noise inside a round falloff; 'amount' fades it."""
    m, nt, bsdf, out = node_mat(name)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.name = 'drift'
    mp.inputs['Scale'].default_value = (6, 6, 3)
    nt.links.new(tc.outputs['UV'], mp.inputs[0])
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 3.0
    nz.inputs['Detail'].default_value = 6
    nz.inputs['Distortion'].default_value = 1.2
    nt.links.new(mp.outputs[0], nz.inputs['Vector'])
    # radial falloff around the card's centre (UV 0.5, 0.5)
    sub = nt.nodes.new('ShaderNodeVectorMath')
    sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = (0.5, 0.5, 0)
    nt.links.new(tc.outputs['UV'], sub.inputs[0])
    ln = nt.nodes.new('ShaderNodeVectorMath')
    ln.operation = 'LENGTH'
    nt.links.new(sub.outputs[0], ln.inputs[0])
    fall = map_range(nt, ln.outputs['Value'], 0.15, 0.5, 1.0, 0.0)
    a = nt.nodes.new('ShaderNodeMath')
    a.operation = 'MULTIPLY'
    nt.links.new(map_range(nt, nz.outputs['Fac'], 0.35, 0.68, 0.0, 1.0), a.inputs[0])
    nt.links.new(fall, a.inputs[1])
    amt = nt.nodes.new('ShaderNodeValue')
    amt.name = 'amount'
    amt.outputs[0].default_value = 0.0
    a2 = nt.nodes.new('ShaderNodeMath')
    a2.operation = 'MULTIPLY'
    nt.links.new(a.outputs[0], a2.inputs[0])
    nt.links.new(amt.outputs[0], a2.inputs[1])
    bsdf.inputs['Base Color'].default_value = (0.66, 0.64, 0.6, 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
    nt.links.new(a2.outputs[0], bsdf.inputs['Alpha'])
    m.surface_render_method = 'BLENDED'
    m.use_transparency_overlap = True
    return m


def smoke(M, rig, n=8, c='Ghost'):
    """Wisps around the ghost's hem: vertical cards that face their target (an act points them at its camera)."""
    import bmesh
    M.setdefault('ghost_smoke', smoke_mat())
    Rg = rng(21)
    cards = []
    for i in range(n):
        bm = bmesh.new()
        uv = bm.loops.layers.uv.new('UVMap')
        w = Rg.uniform(0.2, 0.34)
        vs = [bm.verts.new((x, 0, z)) for x, z in ((-w / 2, -w / 2), (w / 2, -w / 2), (w / 2, w / 2), (-w / 2, w / 2))]
        f = bm.faces.new(vs)
        for l, co in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            l[uv].uv = co
        ob = mesh_obj(f'ghost_wisp{i}', bm, c, M['ghost_smoke'], smooth_shade=False)
        ob.parent = rig['root']
        a = 2 * math.pi * i / n + Rg.uniform(-0.4, 0.4)
        ob.location = (0.08 * math.cos(a), 0.08 * math.sin(a), 0.06 + Rg.uniform(0, 0.22))
        ob.visible_shadow = False
        cards.append(ob)
    rig['wisps'] = cards
    return cards


def void_mat(name='ghost_void'):
    m, nt, bsdf, out = node_mat(name)
    bsdf.inputs['Base Color'].default_value = (0.0, 0.0, 0.0, 1)
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
    return m


def sheet_mesh(name, mat, c, seed=3, rows=96, cols=180):
    Rg = rng(seed)
    phase = [Rg.uniform(0, 6.28) for _ in range(4)]
    fray = [Rg.uniform(-1, 1) for _ in range(cols)]
    bm = bmesh.new()
    hem = bm.verts.layers.float.new('hem')
    grid = []
    for j in range(1, rows + 1):
        t = j / rows
        p = _profile(t)
        drape = max(0.0, min(1.0, (-p.y - 0.01) / 0.255))          # 0 on the head, 1 at the hem
        drape_s = drape * drape * (3 - 2 * drape)
        row = []
        for k in range(cols):
            phi = 2 * math.pi * k / cols
            # folds: a few broad, irregular ridges with sharp crests (abs-sine), plus smaller secondary ones
            ridge = 1 - 2 * abs(math.sin(2.5 * phi + phase[0] + 0.8 * math.sin(2 * phi + phase[1])))
            folds = ridge + 0.35 * math.sin(9 * phi + phase[2] + 1.5 * t)
            r = p.x + 0.036 * drape_s * folds
            # the sheet drags at the back (+Y) and hangs unevenly
            back = 0.5 + 0.5 * math.sin(phi)
            z = p.y - drape_s * (0.028 * back - 0.014 * math.sin(3 * phi + phase[3]) - 0.012 * folds)
            if j == rows:
                z += 0.004 * fray[k]                                    # the frayed hem
            # crumpled cloth everywhere (softly on the head), creases deeper in the drape
            q = Vector((r * math.cos(phi), r * math.sin(phi), z))
            r += (0.0025 + 0.009 * drape_s) * noise.noise(q * 16 + Vector(phase[:3])) + 0.0008 * drape_s * noise.noise(q * 45)
            v = bm.verts.new((r * math.cos(phi), r * math.sin(phi), z))
            v[hem] = drape_s
            row.append(v)
        grid.append(row)
    top = bm.verts.new((0, 0, PROFILE[0][1]))
    top[hem] = 0.0
    for k in range(cols):
        bm.faces.new((top, grid[0][(k + 1) % cols], grid[0][k]))
    for a, b in zip(grid, grid[1:]):
        for k in range(cols):
            bm.faces.new((a[k], a[(k + 1) % cols], b[(k + 1) % cols], b[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(name, bm, c, mat)
    # outward normals: the crown's normal must point up
    if ob.data.polygons[0].normal.z < 0:
        ob.data.flip_normals()
    return ob


def ellipse(cx, cz, rx, rz, rot=0.0, n=28):
    c, s_ = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    return [(cx + rx * math.cos(a) * c - rz * math.sin(a) * s_, cz + rx * math.cos(a) * s_ + rz * math.sin(a) * c)
            for a in (2 * math.pi * k / n for k in range(n))]


def torn(poly, seed, amt=0.0006):
    """Roughen a cut-out's outline, as if the hole had been cut by hand and pulled."""
    Rg = rng(seed)
    cx = sum(x for x, _ in poly) / len(poly)
    cz = sum(z for _, z in poly) / len(poly)
    out = []
    wob = [Rg.uniform(-1, 1) for _ in range(5)]
    for i, (x, z) in enumerate(poly):
        d = Vector((x - cx, z - cz))
        a = 2 * math.pi * i / len(poly)
        # a smooth, low-frequency wobble (hand-cut), not jagged noise
        w = sum(wob[k] * math.sin((k + 2) * a + k) for k in range(len(wob))) / len(wob)
        f = 1 + w * amt / max(d.length, 1e-4)
        out.append((cx + d.x * f, cz + d.y * f))
    return out


# two hand-cut holes, not quite matching: the left a little larger and higher, both narrowing at the inner corner
EYES = [torn(ellipse(-0.025, 0.008, 0.0125, 0.0155, rot=-16, n=40), 1),
        torn(ellipse(0.025, 0.003, 0.0105, 0.0145, rot=12, n=40), 2)]


def build(M, loc=(0, 0, 0), rz=0.0, c='Ghost'):
    """Returns the rig: root (travels, heading) → body (float bob, lean, sway) → sheet, void."""
    M.setdefault('linen', linen_mat())
    M.setdefault('ghost_void', void_mat())
    rig = {}
    root = rig['root'] = empty('ghost_root', loc, c)
    root.rotation_euler = (0, 0, rz)
    body = rig['body'] = empty('ghost_body', (0, 0, GHOST_HEM + 0.04), c, root)       # hem floats 4 cm up
    ob = sheet_mesh('ghost_sheet', M['linen'], c)
    sol = ob.modifiers.new('cloth', 'SOLIDIFY')
    sol.thickness = 0.0022
    sol.offset = -1
    cutters = [radial_prism(f'ghost_eye{i}', [[(x, -HEAD_R, z) for x, z in e]], M['linen'], c, near=0.6, far=1.5)
               for i, e in enumerate(EYES)]
    for ct in cutters:
        b = ob.modifiers.new(ct.name, 'BOOLEAN')
        b.operation = 'DIFFERENCE'
        b.solver = 'EXACT'
        b.object = ct
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    assert len(me.polygons) > 30000, f'ghost carving failed: {len(me.polygons)} faces'
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    for ct in cutters:
        bpy.data.objects.remove(ct)
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(50))
    body.location.z = -min(v.co.z for v in me.vertices) + GHOST_FLOAT
    # the hem ripples (only the draped part moves): a slow wave along the normals
    vg = ob.vertex_groups.new(name='hem')
    hem = me.attributes['hem'].data
    for i, v in enumerate(me.vertices):
        vg.add([i], hem[i].value, 'REPLACE')
    wv = ob.modifiers.new('ripple', 'WAVE')
    wv.use_normal = True
    wv.use_x = wv.use_y = True
    wv.height = 0.0035
    wv.width = 0.06
    wv.narrowness = 1.2
    wv.speed = 0.004
    wv.vertex_group = 'hem'
    subsurf(ob, 1)
    ob.parent = body
    rig['sheet'] = ob
    # nothing inside: a black void behind the eyes
    vd = sphere('ghost_void', HEAD_R * 0.86, M['ghost_void'], c, segs=24, rings=12)
    vd.parent = body
    vd.visible_shadow = False
    rig['void'] = vd
    return rig
