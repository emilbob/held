"""The Halloween lantern: hexagonal, wrought iron, amber seeded glass, a frieze of crescent moons cut through its
cap (glowing from inside), a ring handle, a candle within. Its glow is driven by one value, lantern['glow'] (1 = calm,
higher = the bloom when the pumpkin notices it)."""
import bpy, bmesh, math
from mathutils import Vector
from lib import mesh_obj, lathe, tube, empty, light, node_mat, noise, map_range, mix_rgb, flicker, subsurf
import fire

W = 0.075          # circumradius of the hexagon
BODY_H = 0.16      # glass height
BASE_H = 0.03


def hex_prism(name, r, z0, z1, mat, c, r_top=None):
    r_top = r if r_top is None else r_top
    bm = bmesh.new()
    lo = [bm.verts.new((r * math.cos(math.pi / 3 * i), r * math.sin(math.pi / 3 * i), z0)) for i in range(6)]
    hi = [bm.verts.new((r_top * math.cos(math.pi / 3 * i), r_top * math.sin(math.pi / 3 * i), z1)) for i in range(6)]
    for i in range(6):
        bm.faces.new((lo[i], lo[(i + 1) % 6], hi[(i + 1) % 6], hi[i]))
    bm.faces.new(list(reversed(lo)))
    if r_top > 0:
        bm.faces.new(hi)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(name, bm, c, mat, smooth_shade=False)
    bv = ob.modifiers.new('bevel', 'BEVEL')
    bv.width = 0.0025
    bv.segments = 2
    return ob


def seeded_glass():
    """Amber glass with seeds (tiny bubbles) and gentle waviness, faintly self-lit by the candle's scatter."""
    # see-through amber (transparent tint) + a glossy skin (fresnel) + the glow as emission: the candle reads through
    # it, and the glass never turns into a white sheet the way rough refraction of a point light does in Eevee
    m, nt, bsdf, out = node_mat('lantern_glass')
    nt.nodes.remove(bsdf)
    bsdf = nt.nodes.new('ShaderNodeBsdfGlossy')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    tr.inputs['Color'].default_value = (0.95, 0.52, 0.18, 1)
    fr = nt.nodes.new('ShaderNodeFresnel')
    fr.inputs['IOR'].default_value = 1.5
    mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(fr.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(bsdf.outputs[0], mx.inputs[2])
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (1.0, 0.55, 0.18, 1)
    add_sh = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(mx.outputs[0], add_sh.inputs[0])
    nt.links.new(em.outputs[0], add_sh.inputs[1])
    nt.links.new(add_sh.outputs[0], out.inputs[0])
    nz = noise(nt, 18, 3)
    nt.links.new(map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0.03, 0.12), bsdf.inputs['Roughness'])
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 160
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    seeds = map_range(nt, vor.outputs['Distance'], 0.0, 0.08, 1.0, 0.0)
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'MULTIPLY_ADD'
    add.inputs[1].default_value = 0.4
    nt.links.new(nz.outputs['Fac'], add.inputs[0])
    nt.links.new(seeds, add.inputs[2])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.25
    bp.inputs['Distance'].default_value = 0.0004
    nt.links.new(add.outputs[0], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    g = nt.nodes.new('ShaderNodeValue')
    g.name = 'glow'
    g.outputs[0].default_value = 0.06
    nt.links.new(g.outputs[0], em.inputs['Strength'])
    m.surface_render_method = 'BLENDED'
    m.use_transparent_shadow = True
    return m


def moon_frieze_mat():
    """The cap's frieze band: iron, with crescent moons cut through it — where the cut is, it glows."""
    m, nt, bsdf, out = node_mat('lantern_frieze')
    bsdf.inputs['Base Color'].default_value = (0.03, 0.028, 0.026, 1)
    bsdf.inputs['Metallic'].default_value = 0.85
    bsdf.inputs['Roughness'].default_value = 0.5
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['UV'], sep.inputs[0])
    # UV: u runs once around per face (6 tiles), v up the band. Crescent = disc minus offset disc.
    fr = nt.nodes.new('ShaderNodeMath')
    fr.operation = 'FRACT'
    nt.links.new(sep.outputs['X'], fr.inputs[0])

    def disc(cx, cy, r):
        c = nt.nodes.new('ShaderNodeCombineXYZ')
        nt.links.new(fr.outputs[0], c.inputs['X'])
        nt.links.new(sep.outputs['Y'], c.inputs['Y'])
        d = nt.nodes.new('ShaderNodeVectorMath')
        d.operation = 'DISTANCE'
        d.inputs[1].default_value = (cx, cy, 0)
        nt.links.new(c.outputs[0], d.inputs[0])
        return map_range(nt, d.outputs['Value'], r - 0.01, r + 0.01, 1.0, 0.0)
    a = disc(0.5, 0.5, 0.3)
    b = disc(0.62, 0.58, 0.27)
    cres = nt.nodes.new('ShaderNodeMath')
    cres.operation = 'SUBTRACT'
    cres.use_clamp = True
    nt.links.new(a, cres.inputs[0])
    nt.links.new(b, cres.inputs[1])
    g = nt.nodes.new('ShaderNodeValue')
    g.name = 'glow'
    g.outputs[0].default_value = 2.5
    st = nt.nodes.new('ShaderNodeMath')
    st.operation = 'MULTIPLY'
    nt.links.new(cres.outputs[0], st.inputs[0])
    nt.links.new(g.outputs[0], st.inputs[1])
    bsdf.inputs['Emission Color'].default_value = (1.0, 0.6, 0.22, 1)
    nt.links.new(st.outputs[0], bsdf.inputs['Emission Strength'])
    return m


def frieze(name, r, z0, z1, mat, c):
    """A hexagonal band with per-face UVs (u 0..1 across each face + face index, v 0..1 up)."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    for i in range(6):
        a0, a1 = math.pi / 3 * i, math.pi / 3 * (i + 1)
        p = [bm.verts.new((r * math.cos(a0), r * math.sin(a0), z0)), bm.verts.new((r * math.cos(a1), r * math.sin(a1), z0)),
             bm.verts.new((r * math.cos(a1), r * math.sin(a1), z1)), bm.verts.new((r * math.cos(a0), r * math.sin(a0), z1))]
        f = bm.faces.new(p)
        for l, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            l[uv].uv = (i + u, v)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(name, bm, c, mat, smooth_shade=False)
    sol = ob.modifiers.new('thick', 'SOLIDIFY')
    sol.thickness = 0.002
    return ob


def build(M, loc, rz=0.0, c='Lantern'):
    M['lantern_glass'] = seeded_glass()
    M['lantern_frieze'] = moon_frieze_mat()
    root = empty('lantern', loc, c)
    root.rotation_euler = (0, 0, math.radians(rz))
    iron = M['iron']
    z = 0.0
    parts = [
        hex_prism('lt_foot', W * 1.12, 0, 0.008, iron, c),
        hex_prism('lt_base', W * 1.02, 0.008, BASE_H, iron, c, r_top=W * 0.98),
    ]
    z = BASE_H
    glass = hex_prism('lt_glass', W * 0.93, z, z + BODY_H, M['lantern_glass'], c)
    glass.modifiers.clear()           # a single surface: stacked layers would add their glow up into a milky sheet
    glass.visible_shadow = False
    parts.append(glass)
    # corner posts, with a twist of scrollwork at the top
    for i in range(6):
        a = math.pi / 3 * i
        x, y = W * 0.97 * math.cos(a), W * 0.97 * math.sin(a)
        parts.append(tube(f'lt_post_{i}', [(x, y, z - 0.004), (x, y, z + BODY_H + 0.004)], [0.0045, 0.0045], iron, segs=8, c=c))
    # mid rail
    parts.append(hex_prism('lt_rail_top', W * 1.0, z + BODY_H, z + BODY_H + 0.006, iron, c))
    z += BODY_H + 0.006
    fz = frieze('lt_frieze', W * 0.96, z, z + 0.038, M['lantern_frieze'], c)
    parts.append(fz)
    z += 0.038
    # roof: flared hexagonal pyramid, then a finial and a ring handle
    parts.append(hex_prism('lt_eave', W * 1.18, z, z + 0.008, iron, c, r_top=W * 1.1))
    parts.append(hex_prism('lt_roof', W * 1.1, z + 0.008, z + 0.07, iron, c, r_top=W * 0.12))
    z += 0.07
    fin = lathe('lt_finial', [(0, z), (0.012, z), (0.014, z + 0.01), (0.008, z + 0.02), (0.012, z + 0.03), (0, z + 0.04)], iron, segs=24, c=c)
    parts.append(fin)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.026, minor_radius=0.004, location=(0, 0, z + 0.065),
                                     rotation=(math.radians(90), 0, 0), major_segments=48, minor_segments=10)
    ring = bpy.context.active_object
    ring.name = 'lt_ring'
    ring.data.materials.append(iron)
    parts.append(ring)
    for p in parts:
        from lib import link
        link(p, c)
        p.parent = root
    # the candle inside, and the light
    cand, clt = fire.candle('lt_candle', (0, 0, BASE_H), h=0.075, r=0.02, M=M, mat=M['wax_old'], power=0.25, seed=77, c=c)
    cand.parent = root
    cand.location = (0, 0, BASE_H)
    # a warm glow light that blooms (in addition to the candle's flicker)
    glow = light('lantern_glow', 'POINT', (0, 0, BASE_H + 0.15), 0.5, kelvin=2000, size=0.05, c=c)
    glow.parent = root
    glow.location = (0, 0, BASE_H + 0.15)
    flicker(glow.data, 'energy', 0.5, 0.1, speed=1.5, seed=91)
    return dict(root=root, glow=glow, candle_light=clt, glass=M['lantern_glass'], frieze=M['lantern_frieze'],
                height=z + 0.09)
