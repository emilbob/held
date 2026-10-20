"""Held commercial: the room, the objects, the materials and the two lighting states (night, morning).

Units are metres; every object is built at its real size. The desk's front edge faces -Y (towards the camera side of
the room); the back wall with the window is at y = WALL_Y. Imported into shots.py, which adds cameras and renders.
"""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
A = os.path.join(ROOT, 'assets')
TEX = os.path.join(ROOT, 'textures')

WALL_Y = 1.0
DESK_TOP = 0.74
DESK = dict(x0=-0.85, x1=0.85, y0=0.27, y1=0.97)        # 1.7 × 0.7 m oak top
WINDOW = dict(x0=-1.85, x1=-0.45, z0=0.92, z1=2.32)     # opening in the back wall
WINDOW_L = dict(y0=-3.4, y1=-2.0, z0=0.92, z1=2.32)     # the second window, in the left wall, near the front of the room
ROOM = dict(x0=-2.6, x1=2.4, y0=-4.0, z1=2.75)


# ---------------------------------------------------------------- helpers

def link(obj, coll='Scene'):
    c = bpy.data.collections.get(coll)
    if c is None:
        c = bpy.data.collections.new(coll)
        bpy.context.scene.collection.children.link(c)
    c.objects.link(obj)
    return obj


def mesh_obj(name, bm, coll='Scene', mat=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    if mat:
        ob.data.materials.append(mat)
    return link(ob, coll)


def box(name, sx, sy, sz, loc=(0, 0, 0), corner=0.0, edge=0.0, mat=None, coll='Scene', origin='center', segs=8):
    """Box of size sx × sy × sz. corner = radius of the vertical (Z) edges, edge = small radius on all other edges.
    origin 'bottom' puts the origin at the bottom face centre."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz + (sz / 2 if origin == 'bottom' else 0)))
    ob = mesh_obj(name, bm, coll, mat)
    ob.location = loc
    if corner > 0:
        bw = ob.data.attributes.new('bevel_weight_edge', 'FLOAT', 'EDGE')
        for e in ob.data.edges:
            a, b = (ob.data.vertices[i].co for i in e.vertices)
            bw.data[e.index].value = 1.0 if abs(a.x - b.x) < 1e-6 and abs(a.y - b.y) < 1e-6 else 0.0
        m = ob.modifiers.new('corners', 'BEVEL')
        m.limit_method = 'WEIGHT'
        m.width = corner
        m.segments = segs
    if edge > 0:
        m = ob.modifiers.new('edges', 'BEVEL')
        m.limit_method = 'ANGLE'
        m.angle_limit = math.radians(50)
        m.width = edge
        m.segments = 3
        m.harden_normals = False
    smooth(ob)
    return ob


def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.modifiers.new('wn', 'WEIGHTED_NORMAL').keep_sharp = True


def quad(name, w, h, loc, rot, mat, coll='Scene', uv=((0, 0), (1, 0), (1, 1), (0, 1))):
    """Upright quad in the local XZ plane facing -Y, w × h, origin at centre, with UVs (for screens)."""
    bm = bmesh.new()
    vs = [bm.verts.new(Vector(p)) for p in ((-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2))]
    f = bm.faces.new(vs)
    lay = bm.loops.layers.uv.new('UVMap')
    for l, c in zip(f.loops, uv):
        l[lay].uv = c
    ob = mesh_obj(name, bm, coll, mat)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


# ---------------------------------------------------------------- materials

def node_mat(name):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    return m, nt, bsdf, out


def img(path, non_color=False):
    im = bpy.data.images.load(path, check_existing=True)
    if non_color:
        im.colorspace_settings.name = 'Non-Color'
    return im


def pbr(name, folder, scale=1.0, rot=0.0, tint=None, rough_mul=1.0, rough_add=0.0, bump=0.3, coat=0.0, coat_rough=0.2,
        box_blend=0.25, ext='jpg'):
    """Poly Haven / ambientCG texture set, box-projected in object space (scale = metres per tile)."""
    m, nt, bsdf, out = node_mat(name)
    d = os.path.join(A, 'textures', folder)
    files = os.listdir(d)
    pick = lambda *keys: next(os.path.join(d, f) for f in files if any(k in f for k in keys))
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / scale,) * 3
    mp.inputs['Rotation'].default_value = (0, 0, rot)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])

    def tex(path, nc):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img(path, nc)
        t.projection = 'BOX'
        t.projection_blend = box_blend
        nt.links.new(mp.outputs[0], t.inputs[0])
        return t
    col = tex(pick('_diff_', '_Color'), False)
    if tint:
        mix = nt.nodes.new('ShaderNodeMix')
        mix.data_type = 'RGBA'
        mix.blend_type = 'MULTIPLY'
        mix.inputs['Factor'].default_value = 1.0
        mix.inputs[7].default_value = (*tint, 1)
        nt.links.new(col.outputs[0], mix.inputs[6])
        nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    else:
        nt.links.new(col.outputs[0], bsdf.inputs['Base Color'])
    r = tex(pick('_rough_', '_Roughness'), True)
    mr = nt.nodes.new('ShaderNodeMath')
    mr.operation = 'MULTIPLY_ADD'
    mr.inputs[1].default_value = rough_mul
    mr.inputs[2].default_value = rough_add
    nt.links.new(r.outputs[0], mr.inputs[0])
    nt.links.new(mr.outputs[0], bsdf.inputs['Roughness'])
    # Box projection has no tangents for the normal map, so the displacement map drives a bump instead,
    # which is projection-independent.
    disp = tex(pick('_disp_', '_Displacement'), True)
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = bump
    bp.inputs['Distance'].default_value = 0.001 * scale
    nt.links.new(disp.outputs[0], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    if coat:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = coat_rough
        nt.links.new(bp.outputs[0], bsdf.inputs['Coat Normal'])
    return m


def noise_rough(nt, bsdf, base, var, scale=40.0, detail=6):
    """Roughness = base ± var, broken up by noise: no surface is uniformly rough."""
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = detail
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['To Min'].default_value = base - var
    mr.inputs['To Max'].default_value = base + var
    nt.links.new(nz.outputs['Fac'], mr.inputs['Value'])
    nt.links.new(mr.outputs[0], bsdf.inputs['Roughness'])
    return nz


def smudges(nt, bsdf, base, strength, scale=9.0):
    """Faint fingerprints / wipe marks on glossy surfaces: low-frequency patches of higher roughness."""
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = 3
    nz.inputs['Distortion'].default_value = 1.5
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    cr = nt.nodes.new('ShaderNodeMapRange')
    cr.inputs['From Min'].default_value = 0.55
    cr.inputs['From Max'].default_value = 0.75
    cr.inputs['To Min'].default_value = base
    cr.inputs['To Max'].default_value = base + strength
    nt.links.new(nz.outputs['Fac'], cr.inputs['Value'])
    return cr.outputs[0]


def grille_mat():
    """Speaker grille: the aluminium, perforated with a fine grid of dark holes."""
    m, nt, bsdf, out = node_mat('grille')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 1400
    vor.inputs['Randomness'].default_value = 0.0
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    holes = nt.nodes.new('ShaderNodeMath'); holes.operation = 'LESS_THAN'
    holes.inputs[1].default_value = 0.22
    nt.links.new(vor.outputs['Distance'], holes.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs[6].default_value = (0.80, 0.81, 0.82, 1)
    mix.inputs[7].default_value = (0.01, 0.01, 0.01, 1)
    nt.links.new(holes.outputs[0], mix.inputs['Factor'])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    inv = nt.nodes.new('ShaderNodeMath'); inv.operation = 'SUBTRACT'
    inv.inputs[0].default_value = 1.0
    nt.links.new(holes.outputs[0], inv.inputs[1])
    nt.links.new(inv.outputs[0], bsdf.inputs['Metallic'])
    bsdf.inputs['Roughness'].default_value = 0.38
    return m


def simple(name, color, rough, metal=0.0, rough_var=0.0, spec=0.5, coat=0.0, coat_rough=0.1, sheen=0.0):
    m, nt, bsdf, out = node_mat(name)
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Specular IOR Level'].default_value = spec
    if rough_var:
        noise_rough(nt, bsdf, rough, rough_var)
    else:
        bsdf.inputs['Roughness'].default_value = rough
    if coat:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = coat_rough
    if sheen:
        bsdf.inputs['Sheen Weight'].default_value = sheen
    return m


def aluminium():
    """Bead-blasted anodised aluminium (silver)."""
    m, nt, bsdf, out = node_mat('aluminium')
    bsdf.inputs['Base Color'].default_value = (0.80, 0.81, 0.82, 1)
    bsdf.inputs['Metallic'].default_value = 1.0
    noise_rough(nt, bsdf, 0.36, 0.05, scale=600, detail=2)
    bsdf.inputs['Anisotropic'].default_value = 0.15
    return m


def screen_mat(name, glass_rough=0.015):
    """Display under cover glass: emission from the real UI (an image sequence, one image per film frame, see
    tools/screens.py) under a clear coat for the glass reflection."""
    m, nt, bsdf, out = node_mat(name)
    t = nt.nodes.new('ShaderNodeTexImage')
    t.name = 'screen'
    t.interpolation = 'Cubic'
    bsdf.inputs['Base Color'].default_value = (0.004, 0.004, 0.005, 1)
    bsdf.inputs['Roughness'].default_value = 0.35
    bsdf.inputs['Specular IOR Level'].default_value = 0.0
    nt.links.new(t.outputs[0], bsdf.inputs['Emission Color'])
    bsdf.inputs['Emission Strength'].default_value = 0.0
    bsdf.inputs['Coat Weight'].default_value = 1.0
    bsdf.inputs['Coat IOR'].default_value = 1.52
    nt.links.new(smudges(nt, bsdf, glass_rough, 0.06, scale=14), bsdf.inputs['Coat Roughness'])
    return m


def glossier(mat, ior, rough):
    """Raise a coated surface's reflectance (coat IOR) and set its smudge roughness range (clean, smudged)."""
    nt = mat.node_tree
    nt.nodes['Principled BSDF'].inputs['Coat IOR'].default_value = ior
    for n in nt.nodes:
        if n.type == 'MAP_RANGE' and n.outputs[0].links and n.outputs[0].links[0].to_socket.name == 'Coat Roughness':
            n.inputs['To Min'].default_value, n.inputs['To Max'].default_value = rough


def thin_glass():
    """Picture-frame glass: a clear sheet, so mostly transparent with a fresnel reflection."""
    m, nt, bsdf, out = node_mat('thin_glass')
    gl = nt.nodes.new('ShaderNodeBsdfGlossy')
    gl.inputs['Roughness'].default_value = 0.03
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    fr = nt.nodes.new('ShaderNodeFresnel')
    fr.inputs['IOR'].default_value = 1.52
    mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(fr.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(gl.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    return m


def set_screen(mat, seq, strength, wake=None):
    """seq: a folder in textures/seq/ (one image per film frame), or None for a display that is off.
    wake: the frame the display wakes on (dark before it, then a 5-frame fade up, as a phone's screen lights)."""
    nt = mat.node_tree
    em = nt.nodes['Principled BSDF'].inputs['Emission Strength']
    em.default_value = strength if seq else 0.0
    if not seq:
        return
    if wake:
        for f, v in ((wake, 0.0), (wake + 5, strength)):
            em.default_value = v
            em.keyframe_insert('default_value', frame=f)
    d = os.path.join(TEX, 'seq', seq)
    t = nt.nodes['screen']
    t.image = img(os.path.join(d, 'f_0001.png'))
    t.image.source = 'SEQUENCE'
    t.image_user.frame_duration = len(os.listdir(d))
    t.image_user.frame_start = 1
    t.image_user.frame_offset = 0
    t.image_user.use_auto_refresh = True


def glass_mat():
    """Window glass that lets light and shadow rays through (no caustic noise) but still reflects for the camera."""
    m, nt, bsdf, out = node_mat('window_glass')
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
    bsdf.inputs['Transmission Weight'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = 0.0
    bsdf.inputs['IOR'].default_value = 1.52
    lp = nt.nodes.new('ShaderNodeLightPath')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    mx2 = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(lp.outputs['Is Shadow Ray'], mx.inputs[0])
    nt.links.new(bsdf.outputs[0], mx.inputs[1])
    nt.links.new(tr.outputs[0], mx.inputs[2])
    nt.links.new(lp.outputs['Is Diffuse Ray'], mx2.inputs[0])
    nt.links.new(mx.outputs[0], mx2.inputs[1])
    nt.links.new(tr.outputs[0], mx2.inputs[2])
    nt.links.new(mx2.outputs[0], out.inputs[0])
    return m


def sheer_mat():
    """Sheer linen curtain: translucent, lets most light through, faint weave."""
    m, nt, bsdf, out = node_mat('sheer')
    d = os.path.join(A, 'textures', 'rough_linen')
    col = nt.nodes.new('ShaderNodeTexImage')
    col.image = img(os.path.join(d, 'rough_linen_diff_2k.jpg'))
    tl = nt.nodes.new('ShaderNodeBsdfTranslucent')
    tl.inputs['Color'].default_value = (0.45, 0.43, 0.40, 1)
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    df = nt.nodes.new('ShaderNodeBsdfDiffuse')
    df.inputs['Color'].default_value = (0.85, 0.82, 0.76, 1)
    a = nt.nodes.new('ShaderNodeAddShader')
    mx = nt.nodes.new('ShaderNodeMixShader')
    mx.inputs[0].default_value = 0.55
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (6, 6, 6)
    nt.links.new(tc.outputs['UV'], mp.inputs[0])
    nt.links.new(mp.outputs[0], col.inputs[0])
    w = nt.nodes.new('ShaderNodeMath')
    w.operation = 'MULTIPLY_ADD'
    w.inputs[1].default_value = 0.3
    w.inputs[2].default_value = 0.42
    nt.links.new(col.outputs[0], w.inputs[0])
    nt.links.new(w.outputs[0], mx.inputs[0])
    nt.links.new(tl.outputs[0], a.inputs[0])
    nt.links.new(df.outputs[0], a.inputs[1])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(a.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    return m


def cardboard_mat(name='cardboard'):
    """Kraft corrugated board. Edges and corners are lighter and rougher where handling has crushed the fibres
    (found with a Bevel node: where the rounded normal departs from the true one). The flap seam runs under the tape
    along its whole length, so it needs no shading of its own."""
    m = pbr(name, 'Cardboard002', scale=0.45, tint=(0.80, 0.74, 0.70), rough_mul=0.25, rough_add=0.72, bump=0.6)
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    col_in = bsdf.inputs['Base Color'].links[0].from_socket
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    bev = nt.nodes.new('ShaderNodeBevel')
    bev.samples = 8
    bev.inputs['Radius'].default_value = 0.006
    dot = nt.nodes.new('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
    nt.links.new(geo.outputs['Normal'], dot.inputs[0])
    nt.links.new(bev.outputs[0], dot.inputs[1])
    edge = nt.nodes.new('ShaderNodeMapRange')
    edge.inputs['From Min'].default_value = 0.995
    edge.inputs['From Max'].default_value = 0.93
    nt.links.new(dot.outputs['Value'], edge.inputs['Value'])
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 120
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    wear = nt.nodes.new('ShaderNodeMath'); wear.operation = 'MULTIPLY'
    nt.links.new(edge.outputs[0], wear.inputs[0])
    nt.links.new(nz.outputs['Fac'], wear.inputs[1])
    w2 = nt.nodes.new('ShaderNodeMath'); w2.operation = 'MULTIPLY'; w2.use_clamp = True
    w2.inputs[1].default_value = 1.6
    nt.links.new(wear.outputs[0], w2.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'
    mix.inputs[7].default_value = (0.62, 0.52, 0.40, 1)        # crushed fibre, paler than the face
    nt.links.new(w2.outputs[0], mix.inputs['Factor'])
    nt.links.new(col_in, mix.inputs[6])
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    return m


def box_print_mat():
    """Two-colour print on kraft: ink only where the artwork has alpha, with a mottled, absorbed density;
    matt like the board, a touch smoother."""
    m, nt, bsdf, out = node_mat('box_print')
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img(os.path.join(TEX, 'box_print.png'))
    t.extension = 'CLIP'
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.inputs['Scale'].default_value = 260
    nz.inputs['Detail'].default_value = 8
    dens = nt.nodes.new('ShaderNodeMapRange')
    dens.inputs['To Min'].default_value = 0.72
    dens.inputs['To Max'].default_value = 0.98
    nt.links.new(nz.outputs['Fac'], dens.inputs['Value'])
    a = nt.nodes.new('ShaderNodeMath'); a.operation = 'MULTIPLY'
    nt.links.new(t.outputs['Alpha'], a.inputs[0])
    nt.links.new(dens.outputs[0], a.inputs[1])
    ink = nt.nodes.new('ShaderNodeMix'); ink.data_type = 'RGBA'; ink.blend_type = 'MULTIPLY'
    ink.inputs['Factor'].default_value = 0.25                    # ink sits in the board's colour, not on top of it
    ink.inputs[7].default_value = (0.75, 0.68, 0.58, 1)
    nt.links.new(t.outputs['Color'], ink.inputs[6])
    nt.links.new(ink.outputs[2], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.62
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(a.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(bsdf.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    return m


def paint(name, color, relief_folder, scale=1.5, bump=0.2):
    """Matt emulsion over plaster: flat colour, the plaster's relief only as a bump."""
    m, nt, bsdf, out = node_mat(name)
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    noise_rough(nt, bsdf, 0.82, 0.06, scale=3)
    d = os.path.join(A, 'textures', relief_folder)
    disp = next(f for f in os.listdir(d) if '_disp_' in f)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / scale,) * 3
    nt.links.new(tc.outputs['Object'], mp.inputs[0])
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img(os.path.join(d, disp), True)
    t.projection = 'BOX'
    t.projection_blend = 0.3
    nt.links.new(mp.outputs[0], t.inputs[0])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = bump
    bp.inputs['Distance'].default_value = 0.002
    nt.links.new(t.outputs[0], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    return m


def shade_mat():
    """Linen lampshade: diffuse outside, translucent so the bulb glows through the weave."""
    m, nt, bsdf, out = node_mat('shade')
    d = os.path.join(A, 'textures', 'rough_linen')
    col = nt.nodes.new('ShaderNodeTexImage')
    col.image = img(os.path.join(d, 'rough_linen_diff_2k.jpg'))
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (8, 8, 8)
    nt.links.new(tc.outputs['Object'], mp.inputs[0])
    nt.links.new(mp.outputs[0], col.inputs[0])
    df = nt.nodes.new('ShaderNodeBsdfDiffuse')
    df.inputs['Color'].default_value = (0.86, 0.82, 0.74, 1)
    tl = nt.nodes.new('ShaderNodeBsdfTranslucent')
    tl.inputs['Color'].default_value = (0.95, 0.88, 0.76, 1)
    mx = nt.nodes.new('ShaderNodeMixShader')
    mx.inputs[0].default_value = 0.45
    nt.links.new(df.outputs[0], mx.inputs[1])
    nt.links.new(tl.outputs[0], mx.inputs[2])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.3
    nt.links.new(col.outputs[0], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], df.inputs['Normal'])
    nt.links.new(mx.outputs[0], out.inputs[0])
    return m


def tape_mat():
    m, nt, bsdf, out = node_mat('tape')
    bsdf.inputs['Base Color'].default_value = (0.55, 0.40, 0.22, 1)
    bsdf.inputs['Roughness'].default_value = 0.18
    bsdf.inputs['Transmission Weight'].default_value = 0.0
    bsdf.inputs['Alpha'].default_value = 0.78
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexWave')            # lengthwise stretch wrinkles
    nz.wave_type = 'BANDS'
    nz.bands_direction = 'Y'
    nz.inputs['Scale'].default_value = 60
    nz.inputs['Distortion'].default_value = 8
    nz.inputs['Detail'].default_value = 4
    nt.links.new(tc.outputs['Object'], nz.inputs['Vector'])
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = 0.12
    bp.inputs['Distance'].default_value = 0.0002
    nt.links.new(nz.outputs['Fac'], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    return m


def label_mat():
    m, nt, bsdf, out = node_mat('label')
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img(os.path.join(TEX, 'label.png'))
    nt.links.new(t.outputs[0], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.42
    bsdf.inputs['Specular IOR Level'].default_value = 0.4
    return m


# ---------------------------------------------------------------- room

def build_room(M, wall='wall', rug=((0.05, -0.05), (1.9, 1.3))):
    x0, x1, y0, z1 = ROOM['x0'], ROOM['x1'], ROOM['y0'], ROOM['z1']
    t = 0.15
    fw, fd = 0.045, 0.06          # window frame profile: face width, depth
    floor = box('floor', x1 - x0, WALL_Y - y0 + 0.5, 0.05, ((x0 + x1) / 2, (y0 + WALL_Y) / 2, -0.025), mat=M['floor'])
    ceil = box('ceiling', x1 - x0, WALL_Y - y0, 0.05, ((x0 + x1) / 2, (y0 + WALL_Y) / 2, z1 + 0.025), mat=M['ceiling'])
    w = WINDOW
    yb = WALL_Y + t / 2
    # back wall in four pieces around the window opening
    box('wall_back_l', w['x0'] - x0, t, z1, ((x0 + w['x0']) / 2, yb, z1 / 2), mat=M[wall])
    box('wall_back_r', x1 - w['x1'], t, z1, ((w['x1'] + x1) / 2, yb, z1 / 2), mat=M[wall])
    box('wall_back_b', w['x1'] - w['x0'], t, w['z0'], ((w['x0'] + w['x1']) / 2, yb, w['z0'] / 2), mat=M[wall])
    box('wall_back_t', w['x1'] - w['x0'], t, z1 - w['z1'], ((w['x0'] + w['x1']) / 2, yb, (w['z1'] + z1) / 2), mat=M[wall])
    # left wall in four pieces around the second window
    wl = WINDOW_L
    xl = x0 - t / 2
    box('wall_left_f', t, wl['y0'] - y0, z1, (xl, (y0 + wl['y0']) / 2, z1 / 2), mat=M[wall])
    box('wall_left_b', t, WALL_Y - wl['y1'], z1, (xl, (wl['y1'] + WALL_Y) / 2, z1 / 2), mat=M[wall])
    box('wall_left_lo', t, wl['y1'] - wl['y0'], wl['z0'], (xl, (wl['y0'] + wl['y1']) / 2, wl['z0'] / 2), mat=M[wall])
    box('wall_left_hi', t, wl['y1'] - wl['y0'], z1 - wl['z1'], (xl, (wl['y0'] + wl['y1']) / 2, (wl['z1'] + z1) / 2), mat=M[wall])
    cy, czl = (wl['y0'] + wl['y1']) / 2, (wl['z0'] + wl['z1']) / 2
    WL, HL = wl['y1'] - wl['y0'], wl['z1'] - wl['z0']
    fx = x0 - t * 0.6
    for n, sy, sz, ly, lz in [('frameL_f', fw, HL, wl['y0'] + fw / 2, czl), ('frameL_b', fw, HL, wl['y1'] - fw / 2, czl),
                              ('frameL_lo', WL, fw, cy, wl['z0'] + fw / 2), ('frameL_hi', WL, fw, cy, wl['z1'] - fw / 2),
                              ('mullionL', 0.035, HL, cy, czl)]:
        box(n, fd, sy, sz, (fx, ly, lz), edge=0.002, mat=M['frame'])
    gl = box('glassL', 0.006, WL - 0.02, HL - 0.02, (fx, cy, czl), mat=M['glass'])
    gl.visible_shadow = False
    box('sillL', 0.2, WL + 0.08, 0.025, (x0 + 0.03, cy, wl['z0'] - 0.0125), edge=0.003, mat=M['paint_trim'])
    box('wall_right', t, WALL_Y - y0, z1, (x1 + t / 2, (y0 + WALL_Y) / 2, z1 / 2), mat=M[wall])
    box('wall_front', x1 - x0, t, z1, ((x0 + x1) / 2, y0 - t / 2, z1 / 2), mat=M[wall])
    # skirting board
    box('skirting', x1 - x0, 0.015, 0.08, ((x0 + x1) / 2, WALL_Y - 0.0075, 0.04), edge=0.002, mat=M['paint_trim'])
    # window: deep reveal, black aluminium frame with a centre mullion, double glazing, a sill
    cx, cz = (w['x0'] + w['x1']) / 2, (w['z0'] + w['z1']) / 2
    W_, H_ = w['x1'] - w['x0'], w['z1'] - w['z0']
    fy = WALL_Y + t * 0.6
    for n, sx, sz, lx, lz in [('frame_l', fw, H_, w['x0'] + fw / 2, cz), ('frame_r', fw, H_, w['x1'] - fw / 2, cz),
                              ('frame_b', W_, fw, cx, w['z0'] + fw / 2), ('frame_t', W_, fw, cx, w['z1'] - fw / 2),
                              ('mullion', 0.035, H_, cx, cz)]:
        box(n, sx, fd, sz, (lx, fy, lz), edge=0.002, mat=M['frame'])
    g = box('glass', W_ - 0.02, 0.006, H_ - 0.02, (cx, fy, cz), mat=M['glass'])
    g.visible_shadow = False
    box('sill', W_ + 0.08, 0.2, 0.025, (cx, WALL_Y - 0.03, w['z0'] - 0.0125), edge=0.003, mat=M['paint_trim'])
    # sheer curtain, gathered to the left of the window
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=120, y_segments=8, size=0.5)
    for v in bm.verts:
        x, y = v.co.x * 0.9, v.co.y * 2.6          # 0.9 × 2.6 m panel
        v.co = Vector((x, 0.03 * math.sin(x * 38) + 0.012 * math.sin(x * 91 + 1.3), y))
    lay = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        for l in f.loops:
            l[lay].uv = (l.vert.co.x / 0.9 + 0.5, l.vert.co.z / 2.6 + 0.5)
    cur = mesh_obj('curtain', bm, mat=M['sheer'])
    cur.location = (w['x0'] - 0.05, WALL_Y - 0.09, 2.6 / 2 + 0.06)
    for p in cur.data.polygons:
        p.use_smooth = True
    cur.modifiers.new('solid', 'SOLIDIFY').thickness = 0.0008
    box('rug', rug[1][0], rug[1][1], 0.008, (*rug[0], 0.004), edge=0.003, mat=M['rug'])


# ---------------------------------------------------------------- furniture and objects

def build_desk(M):
    d = DESK
    th = 0.032
    top = box('desk_top', d['x1'] - d['x0'], d['y1'] - d['y0'], th, ((d['x0'] + d['x1']) / 2, (d['y0'] + d['y1']) / 2, DESK_TOP - th / 2),
              corner=0.004, edge=0.0025, mat=M['oak'])
    # black powder-coated steel frame: four legs + two side rails + a back rail
    s = 0.035
    for i, x in enumerate((d['x0'] + 0.06, d['x1'] - 0.06)):
        for j, y in enumerate((d['y0'] + 0.06, d['y1'] - 0.06)):
            box(f'leg_{i}{j}', s, s, DESK_TOP - th, (x, y, (DESK_TOP - th) / 2), edge=0.002, mat=M['steel'])
        box(f'rail_{i}', s, d['y1'] - d['y0'] - 0.12, 0.025, (x, (d['y0'] + d['y1']) / 2, DESK_TOP - th - 0.0125), edge=0.002, mat=M['steel'])
    box('rail_back', d['x1'] - d['x0'] - 0.12, 0.025, 0.06, ((d['x0'] + d['x1']) / 2, d['y1'] - 0.06, DESK_TOP - th - 0.03), edge=0.002, mat=M['steel'])
    return top


# MacBook Pro 14" keyboard rows: key widths in units of the 18.5 mm key pitch (the function row is full height).
MBP_ROWS = [
    [1.45] + [1.0] * 12 + [1.0],                    # esc, F1–F12, Touch ID (last)
    [1.0] * 13 + [1.45],                            # ` 1 … = delete
    [1.45] + [1.0] * 13,                            # tab … \
    [1.75] + [1.0] * 11 + [1.7],                    # caps … return
    [2.3] + [1.0] * 10 + [2.15],                    # shift … shift
    [1.0, 1.0, 1.0, 1.25, 5.0, 1.25, 1.0, 'arrows'],  # fn ctrl opt cmd space cmd opt, arrows
]


def build_laptop(M, loc, yaw_deg=0.0, open_deg=112.0):
    """MacBook Pro 14": base 312.6 × 221.2 × 15.5 mm, display 302.4 × 196.4 mm (3024 × 1964 px, 254 ppi) with the
    notch drawn in the screen image. No logo on the lid."""
    W, D, Hb, Hl = 0.3126, 0.2212, 0.0155, 0.0048
    root = bpy.data.objects.new('laptop', None)
    link(root)
    root.location = loc
    root.rotation_euler = (0, 0, math.radians(yaw_deg))

    def part(ob):
        ob.parent = root
        return ob
    part(box('laptop_base', W, D, Hb, (0, 0, 0.0012), corner=0.0095, edge=0.0018, mat=M['alu'], origin='bottom'))
    for fx in (-0.128, 0.128):                       # four round feet
        for fy in (-0.088, 0.088):
            part(box('foot', 0.012, 0.012, 0.0012, (fx, fy, 0.0), corner=0.0059, mat=M['rubber'], origin='bottom'))
    top_z = 0.0012 + Hb
    # keyboard: black keys set into the aluminium deck, each in its own dark recess
    pitch, gap = 0.0185, 0.0022
    kh = pitch - gap
    y = D / 2 - 0.0215
    for ri, row in enumerate(MBP_ROWS):
        units = sum(w if w != 'arrows' else 3.0 for w in row)
        x = -units * pitch / 2
        for w in row:
            if w == 'arrows':                       # inverted T: left, up over down (half height), right
                for j, (dx, dy, hh) in enumerate([(0, 0, 1.0), (1, 0.25, 0.48), (1, -0.25, 0.48), (2, 0, 0.48)]):
                    hk = kh * hh if j else kh * 0.48
                    cy = y + (dy * pitch if j in (1, 2) else -0.25 * pitch)
                    for nm, mat, grow, z in (('key_hole', M['kb_well'], 0.0007, top_z - 0.0001), ('key', M['key'], 0, top_z + 0.0001)):
                        part(box(nm, pitch - gap + grow, hk + grow, 0.0006 if nm == 'key' else 0.0002,
                                 (x + (dx + 0.5) * pitch, cy, z), corner=0.0012, mat=mat, origin='bottom', segs=3))
                x += 3 * pitch
                continue
            ww = w * pitch - gap
            touch_id = ri == 0 and w == row[-1] and x > 0
            for nm, mat, grow, z in (('key_hole', M['kb_well'], 0.0007, top_z - 0.0001),
                                     ('key', M['touch_id'] if touch_id else M['key'], 0, top_z + 0.0001)):
                part(box(nm, ww + grow, kh + grow, 0.0006 if nm == 'key' else 0.0002, (x + w * pitch / 2, y, z),
                         corner=0.0016, mat=mat, origin='bottom', segs=3))
            x += w * pitch
        y -= pitch
    kb_bottom = y + pitch / 2
    # speaker grilles either side of the keyboard
    for sx in (-1, 1):
        part(box('speaker', 0.0135, 0.104, 0.0001, (sx * 0.1425, D / 2 - 0.074, top_z - 0.00005), corner=0.002,
                 mat=M['grille'], origin='bottom'))
    part(box('trackpad', 0.148, 0.089, 0.0002, (0, kb_bottom - 0.011 - 0.0445, top_z - 0.00005), corner=0.0065,
             mat=M['trackpad'], origin='bottom'))
    # lid on the hinge at the back edge, tilted back by (open_deg - 90); the black hinge barrel below the display
    hinge = bpy.data.objects.new('laptop_hinge', None)
    link(hinge)
    hinge.parent = root
    hinge.location = (0, D / 2 - 0.0045, top_z + 0.0025)
    hinge.rotation_euler = (math.radians(-(open_deg - 90)), 0, 0)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.0042, depth=W - 0.05, rotation=(0, math.radians(90), 0))
    barrel = bpy.context.active_object
    barrel.name = 'hinge_barrel'
    for c in barrel.users_collection:
        c.objects.unlink(barrel)
    link(barrel)
    barrel.data.materials.append(M['hinge'])
    smooth(barrel)
    barrel.parent = hinge
    barrel.location = (0, 0.002, 0.0)
    lid = box('laptop_lid', W, Hl, D - 0.004, (0, Hl / 2, (D - 0.004) / 2 + 0.002), corner=0.0, edge=0.0013, mat=M['alu'])
    bw = lid.data.attributes.new('bevel_weight_edge', 'FLOAT', 'EDGE')
    for e in lid.data.edges:                         # round the lid's four corners (the edges along Y)
        a_, b_ = (lid.data.vertices[i].co for i in e.vertices)
        bw.data[e.index].value = 1.0 if abs(a_.x - b_.x) < 1e-6 and abs(a_.z - b_.z) < 1e-6 else 0.0
    m = lid.modifiers.new('corners', 'BEVEL')
    m.limit_method = 'WEIGHT'; m.width = 0.0095; m.segments = 8
    lid.modifiers.move(len(lid.modifiers) - 1, 0)
    lid.parent = hinge
    bezel = box('laptop_bezel', W - 0.0026, 0.0004, D - 0.0066, (0, -0.0002, (D - 0.004) / 2 + 0.002), corner=0.0, mat=M['bezel'])
    bezel.parent = hinge
    sw, sh = 0.3024, 0.1964
    scr = quad('laptop_screen', sw, sh, (0, -0.00045, D - 0.002 - 0.0062 - sh / 2), (0, 0, 0), M['laptop_screen'])
    scr.parent = hinge
    return root, scr


def build_phone(M, loc, yaw_deg=0.0):
    """Generic 6.1-inch phone lying screen-up. 71.6 × 147.2 × 8.3 mm; display 65.1 × 141.1 mm (1179 × 2556 px)."""
    W, L, T = 0.0716, 0.1472, 0.0083
    root = bpy.data.objects.new('phone', None)
    link(root)
    root.location = loc
    root.rotation_euler = (0, 0, math.radians(yaw_deg))
    body = box('phone_frame', W, L, T, (0, 0, 0), corner=0.0105, edge=0.0012, mat=M['phone_frame'], origin='bottom')
    body.parent = root
    glass = box('phone_glass', W - 0.0012, L - 0.0012, 0.0004, (0, 0, T - 0.0001), corner=0.0099, edge=0.0002,
                mat=M['bezel'], origin='bottom')
    glass.parent = root
    scr = quad('phone_screen', 0.0651, 0.1411, (0, 0, T + 0.00032), (math.radians(-90), 0, 0), M['phone_screen'])
    # quad lies in XZ facing -Y; rotate -90° about X so it lies flat facing +Z with its top towards +Y
    scr.parent = root
    for i, z in enumerate((0.035, 0.05)):     # side buttons
        b = box('phone_btn', 0.0008, 0.012 if i else 0.02, 0.0026, (W / 2 + 0.0003, z, T / 2), corner=0.0003, mat=M['phone_frame'], origin='center')
        b.parent = root
    return root, scr


def build_parcel(M, loc, yaw_deg=0.0, size=(0.32, 0.23, 0.13)):
    """Shipping box: corrugated board with sides that bulge a little (it is packed), a slightly crowned top, worn edges
    (in the material), soft dents, brown tape over the flap seam and down both ends, the label, and the Held print on
    the long side that faces -Y."""
    sx, sy, sz = size
    root = bpy.data.objects.new('parcel', None)
    link(root)
    root.location = loc
    root.rotation_euler = (0, 0, math.radians(yaw_deg))
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=24, use_grid_fill=True)
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    for v in bm.verts:
        x, y, z = v.co.x * sx, v.co.y * sy, v.co.z * sz
        fx, fy, fz = 1 - (2 * v.co.x) ** 2, 1 - (2 * v.co.y) ** 2, 1 - (2 * v.co.z) ** 2     # 0 at the edges
        bulge = 0.0035
        if abs(abs(v.co.x) - 0.5) < 1e-6: x += math.copysign(bulge * fy * fz, v.co.x)
        if abs(abs(v.co.y) - 0.5) < 1e-6: y += math.copysign(bulge * fx * fz, v.co.y)
        if v.co.z > 0.5 - 1e-6: z += 0.0025 * fx * fy                                          # top crowns
        v.co = Vector((x, y, z + hz))
    b = mesh_obj('parcel_box', bm, mat=M['cardboard'])
    bev = b.modifiers.new('edges', 'BEVEL')
    bev.limit_method = 'ANGLE'; bev.angle_limit = math.radians(40); bev.width = 0.003; bev.segments = 3
    tx = bpy.data.textures.new('dents', 'CLOUDS'); tx.noise_scale = 0.09
    ds = b.modifiers.new('dents', 'DISPLACE'); ds.texture = tx; ds.strength = 0.002; ds.mid_level = 0.5
    ds.texture_coords = 'OBJECT'
    smooth(b)
    b.parent = root
    # tape over the flap seam (the flaps meet at x = 0, so it runs along Y), folded down both ends
    tw, tt = 0.048, 0.00025
    t1 = box('tape_top', tw, sy + 0.0015, tt, (0, 0, sz + 0.0026), mat=M['tape'], origin='bottom')
    t1.parent = root
    for sgn in (-1, 1):
        te = box('tape_end', tw, tt, 0.065, (0, sgn * (sy / 2 + 0.0004), sz - 0.0325), mat=M['tape'])
        te.parent = root
    lab = box('label', 0.15, 0.10, 0.0002, (sx * 0.24, -sy * 0.04, sz + 0.0024), mat=M['label'], origin='bottom')
    lab.rotation_euler = (0, 0, math.radians(90 + 2))
    lab.parent = root
    uvmap(lab, lambda co: (co.x / 0.15 + 0.5, co.y / 0.10 + 0.5))
    # the Held print, 15 cm wide, on the -Y side, wrapped onto the bulging board 0.3 mm proud
    pw = 0.15
    ph = pw * 420 / 1114
    pr = quad('parcel_print', pw, ph, (0.01, -hy - 0.006, sz * 0.46), (0, 0, 0), M['box_print'])
    pr.parent = root
    sub = pr.modifiers.new('sub', 'SUBSURF'); sub.subdivision_type = 'SIMPLE'; sub.levels = sub.render_levels = 4
    sw = pr.modifiers.new('onto_box', 'SHRINKWRAP'); sw.target = b; sw.wrap_method = 'PROJECT'
    sw.use_negative_direction = True; sw.use_positive_direction = True; sw.offset = 0.0003
    return root


def uvmap(ob, fn):
    me = ob.data
    uv = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            uv.data[li].uv = fn(me.vertices[me.loops[li].vertex_index].co)


def import_gltf(path, coll='Scene'):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = bpy.data.objects.new(os.path.basename(path).split('_2k')[0], None)
    link(root, coll)
    for o in new:
        for c in o.users_collection:
            c.objects.unlink(o)
        link(o, coll)
        if o.parent is None:
            o.parent = root
    return root, new


def model(name):
    return os.path.join(A, 'models', name, name + '_2k.gltf')


def build_props(M, night=True):
    mug_at = (-0.40, 0.50) if night else (0.66, 0.50)       # by morning the mug has moved next to the lamp
    P = {}
    P['lamp'] = build_table_lamp(M, (0.52, 0.80, DESK_TOP))
    plant, _ = import_gltf(model('potted_plant_02'))
    plant.location = (1.25, 0.62, 0)
    plant.rotation_euler = (0, 0, math.radians(30))
    plant.scale = (1.15,) * 3
    frame, parts = import_gltf(model('standing_picture_frame_02'))
    frame.location = (0.80, 0.90, DESK_TOP)
    frame.rotation_euler = (0, 0, math.radians(-90 - 20))
    for o in parts:
        for sl in getattr(o, 'material_slots', []):
            if sl.material and sl.material.name.endswith('_glass'):
                sl.material = M['thin_glass']
    pens, parts = import_gltf(model('stationery_supplies'))
    # keep only the pen cup and two pencils standing in it
    for o in parts:
        if o.type == 'MESH' and not any(k in o.name for k in ('pencilcup',)):
            bpy.data.objects.remove(o)
    cup = next(o for o in bpy.data.objects if 'pencilcup' in o.name)
    cup.parent = None
    cup.location = (-0.70, 0.86, DESK_TOP - cup.bound_box[0][2] * cup.scale.z)
    chair, _ = import_gltf(model('modern_arm_chair_01'))
    chair.location = (0.0, -0.45, 0)
    chair.rotation_euler = (0, 0, math.radians(180 + 8))
    # a short stack of hardcover books, back left of the desk
    for i, (w, d, h, rz, col) in enumerate([(0.24, 0.17, 0.028, 4, (0.16, 0.19, 0.17)), (0.22, 0.155, 0.024, -3, (0.55, 0.50, 0.42)),
                                            (0.20, 0.14, 0.03, 7, (0.30, 0.12, 0.09))]):
        bk = box(f'book_{i}', w, d, h, (-0.52, 0.70, DESK_TOP + 0.0005 + sum([0.028, 0.024, 0.03][:i])), corner=0.0015, edge=0.0012,
                 mat=M[f'book_{i}'], origin='bottom')
        bk.rotation_euler = (0, 0, math.radians(rz))
        pg = box(f'pages_{i}', w - 0.006, d - 0.004, h - 0.004, (0.003, 0, 0.002), mat=M['pages'], origin='bottom')
        pg.parent = bk
        pg.location = (0.003, 0, 0.002)
    P['mug'] = build_mug(M, (*mug_at, DESK_TOP), 150)
    return P


def build_mug(M, loc, rot_deg=0.0):
    """Glazed ceramic mug, 82 mm across, 95 mm tall, with a handle."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.041, depth=0.095, location=(0, 0, 0.0475))
    mug = bpy.context.active_object
    mug.name = 'mug'
    mug.data.materials.append(M['ceramic'])
    bm = bmesh.new(); bm.from_mesh(mug.data)
    top = [f for f in bm.faces if f.normal.z > 0.9][0]
    bmesh.ops.inset_region(bm, faces=[top], thickness=0.004)
    bmesh.ops.translate(bm, verts=top.verts, vec=(0, 0, -0.085))
    bm.to_mesh(mug.data); bm.free()
    mug.modifiers.new('bevel', 'BEVEL').width = 0.0015
    mug.modifiers['bevel'].segments = 3
    sub = mug.modifiers.new('sub', 'SUBSURF'); sub.levels = sub.render_levels = 2
    smooth(mug)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.026, minor_radius=0.0065, location=(-0.053, 0, 0.05),
                                     rotation=(math.radians(90), 0, 0), major_segments=48, minor_segments=16)
    h = bpy.context.active_object
    h.name = 'mug_handle'
    h.scale = (0.75, 1, 1)
    h.data.materials.append(M['ceramic'])
    smooth(h)
    root = bpy.data.objects.new('mug_root', None); link(root)
    for o in (mug, h):
        for c in o.users_collection:
            c.objects.unlink(o)
        link(o)
        o.parent = root
    root.location = loc
    root.rotation_euler = (0, 0, math.radians(rot_deg))
    return root


def lathe(name, profile, mat, segs=96, coll='Scene'):
    """Surface of revolution around Z from a (radius, z) profile."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z)) for i in range(segs)])
    for r0, r1 in zip(rings, rings[1:]):
        for i in range(segs):
            bm.faces.new((r0[i], r0[(i + 1) % segs], r1[(i + 1) % segs], r1[i]))
    ob = mesh_obj(name, bm, coll, mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def build_table_lamp(M, loc):
    """Table lamp: glazed ceramic base, brass stem, linen drum shade, a 2700 K bulb inside (a real light)."""
    root = bpy.data.objects.new('table_lamp', None)
    link(root)
    root.location = loc
    base = lathe('lamp_base', [(0.0, 0.0), (0.062, 0.0), (0.066, 0.004), (0.068, 0.03), (0.064, 0.09), (0.05, 0.16), (0.034, 0.215),
                               (0.02, 0.232), (0.012, 0.236), (0.0, 0.236)], M['lamp_ceramic'])
    base.parent = root
    stem = lathe('lamp_stem', [(0.0, 0.236), (0.006, 0.236), (0.006, 0.36), (0.0, 0.36)], M['brass'], segs=32)
    stem.parent = root
    sock = lathe('lamp_socket', [(0.0, 0.33), (0.016, 0.33), (0.016, 0.37), (0.0, 0.37)], M['brass'], segs=32)
    sock.parent = root
    # drum shade, open top and bottom, 1 mm linen over a thin wire frame
    shade = lathe('lamp_shade', [(0.165, 0.30), (0.14, 0.50)], M['shade'])
    sol = shade.modifiers.new('solid', 'SOLIDIFY'); sol.thickness = 0.0012
    shade.parent = root
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.03, location=(0, 0, 0.40), segments=48, ring_count=24)
    bulb = bpy.context.active_object
    bulb.name = 'lamp_bulb'
    for c in bulb.users_collection:
        c.objects.unlink(bulb)
    link(bulb)
    bulb.data.materials.append(M['bulb'])
    bulb.parent = root
    bulb.location = (0, 0, 0.40)
    bulb.visible_shadow = False
    pt = light('lamp_bulb_light', 'POINT', (0, 0, 0.40), 0.0, kelvin=2700, size=0.028)
    pt.parent = root
    pt.location = (0, 0, 0.40)
    return dict(root=root, light=pt, bulb=bulb)


# ---------------------------------------------------------------- materials table

def materials():
    M = {}
    M['floor'] = pbr('floor', 'wood_floor', scale=1.6, rot=math.radians(90), tint=(0.78, 0.70, 0.62), rough_mul=0.6, rough_add=0.25, coat=0.25, coat_rough=0.3)
    M['wall'] = paint('wall', (0.74, 0.72, 0.68), 'plastered_wall', scale=1.5, bump=0.18)
    M['ceiling'] = simple('ceiling', (0.78, 0.77, 0.74), 0.9)
    M['paint_trim'] = simple('paint_trim', (0.80, 0.78, 0.74), 0.45, rough_var=0.05)
    M['frame'] = simple('frame', (0.02, 0.021, 0.022), 0.45, metal=0.6, rough_var=0.06)
    M['glass'] = glass_mat()
    M['thin_glass'] = thin_glass()
    M['sheer'] = sheer_mat()
    M['rug'] = pbr('rug', 'poly_wool_herringbone', scale=0.25, tint=(0.62, 0.58, 0.52), rough_mul=0.1, rough_add=0.88, bump=0.8)
    M['oak'] = pbr('oak', 'oak_veneer_01', scale=1.1, rot=0.0, tint=(0.92, 0.88, 0.84), rough_mul=0.35, rough_add=0.3, bump=0.25, coat=0.35, coat_rough=0.22)
    M['steel'] = simple('steel', (0.018, 0.018, 0.019), 0.42, metal=0.0, rough_var=0.08, spec=0.5)
    M['alu'] = aluminium()
    M['rubber'] = simple('rubber', (0.02, 0.02, 0.02), 0.8)
    M['kb_well'] = simple('kb_well', (0.006, 0.006, 0.007), 0.7)
    M['touch_id'] = simple('touch_id', (0.012, 0.012, 0.014), 0.08, coat=1.0, coat_rough=0.02)
    M['hinge'] = simple('hinge', (0.02, 0.02, 0.022), 0.35, metal=0.0, rough_var=0.05)
    M['grille'] = grille_mat()
    M['key'] = simple('key', (0.018, 0.018, 0.02), 0.38, rough_var=0.12, spec=0.4)
    m, nt, bsdf, _ = node_mat('trackpad')
    bsdf.inputs['Base Color'].default_value = (0.42, 0.43, 0.44, 1)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Coat Weight'].default_value = 1.0
    nt.links.new(smudges(nt, bsdf, 0.3, 0.15, scale=30), bsdf.inputs['Roughness'])
    M['trackpad'] = m
    m, nt, bsdf, _ = node_mat('bezel')
    bsdf.inputs['Base Color'].default_value = (0.003, 0.003, 0.004, 1)
    bsdf.inputs['Roughness'].default_value = 0.3
    bsdf.inputs['Coat Weight'].default_value = 1.0
    nt.links.new(smudges(nt, bsdf, 0.02, 0.12, scale=18), bsdf.inputs['Coat Roughness'])
    M['bezel'] = m
    M['laptop_screen'] = screen_mat('laptop_screen')
    M['phone_screen'] = screen_mat('phone_screen')
    M['phone_frame'] = simple('phone_frame', (0.20, 0.20, 0.21), 0.3, metal=1.0, rough_var=0.06)   # graphite
    M['cardboard'] = cardboard_mat()
    M['tape'] = tape_mat()
    M['label'] = label_mat()
    M['box_print'] = box_print_mat()
    M['lamp_ceramic'] = simple('lamp_ceramic', (0.20, 0.25, 0.22), 0.12, rough_var=0.04, coat=0.6, coat_rough=0.05)
    M['brass'] = simple('brass', (0.80, 0.62, 0.38), 0.32, metal=1.0, rough_var=0.08)
    M['shade'] = shade_mat()
    m, nt, bsdf, _ = node_mat('bulb')
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
    bsdf.inputs['Emission Color'].default_value = (1.0, 0.72, 0.42, 1)
    bsdf.inputs['Emission Strength'].default_value = 12.0
    M['bulb'] = m
    M['bulb_off'] = simple('bulb_off', (0.9, 0.9, 0.88), 0.1)
    for i, c in enumerate([(0.16, 0.19, 0.17), (0.55, 0.50, 0.42), (0.30, 0.12, 0.09)]):
        M[f'book_{i}'] = simple(f'book_{i}', c, 0.75, rough_var=0.1, sheen=0.3)
    M['pages'] = simple('pages', (0.78, 0.75, 0.68), 0.85)
    M['ceramic'] = simple('ceramic', (0.86, 0.84, 0.80), 0.18, rough_var=0.06, coat=0.3, coat_rough=0.08)
    return M


# ---------------------------------------------------------------- lighting

def world_hdri(path, strength, rot_z):
    w = bpy.data.worlds.new('world')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    env.image = img(path)
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Rotation'].default_value = (0, 0, rot_z)
    nt.links.new(tc.outputs['Generated'], mp.inputs[0])
    nt.links.new(mp.outputs[0], env.inputs[0])
    nt.links.new(env.outputs[0], bg.inputs[0])
    bg.inputs['Strength'].default_value = strength
    nt.links.new(bg.outputs[0], out.inputs[0])
    return w


def light(name, kind, loc, energy, kelvin=None, color=None, size=0.1, size_y=None, rot=(0, 0, 0), spot=None, blend=0.5, shape='RECTANGLE',
          coll='Lights'):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    if kelvin:
        ld.use_temperature = True
        ld.temperature = kelvin
    if color:
        ld.color = color
    if kind == 'AREA':
        ld.shape = shape
        ld.size = size
        ld.size_y = size_y or size
    elif kind in ('POINT', 'SPOT'):
        ld.shadow_soft_size = size
    elif kind == 'SUN':
        ld.angle = size
    if kind == 'SPOT':
        ld.spot_size = math.radians(spot)
        ld.spot_blend = blend
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = rot
    return link(ob, coll)


def window_fill(ob):
    """The window's fill light stands in for sky light through the glass: it lights the room but the camera and
    reflections see the HDRI / sky through the window instead."""
    ob.visible_camera = False
    ob.visible_glossy = False
    ob.visible_transmission = False
    return ob


def aim(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def lights_night(P):
    world_hdri(os.path.join(A, 'hdri', 'hansaplatz_4k.hdr'), 0.5, math.radians(0))
    P['lamp']['light'].data.energy = 22.0
    # warm bounce from a floor lamp behind the camera (off-screen practical)
    fl = light('floor_lamp', 'AREA', (1.6, -2.2, 1.6), 6.0, kelvin=2600, size=0.5, shape='DISK')
    aim(fl, (0, 0.6, 0.8))
    # blue night skylight through the window
    w = WINDOW
    win = window_fill(light('window_sky', 'AREA', ((w['x0'] + w['x1']) / 2, WALL_Y + 0.12, (w['z0'] + w['z1']) / 2), 10.0,
                color=(0.55, 0.68, 1.0), size=w['x1'] - w['x0'], size_y=w['z1'] - w['z0'], rot=(math.radians(-90), 0, 0)))
    return P['lamp']['light']


def lights_morning(P):
    """Clear autumn morning: the city outside by day, a low sun from back-left raking through the window frames."""
    world_hdri(os.path.join(A, 'hdri', 'konigsallee_4k.hdr'), 1.0, math.radians(0))
    P['lamp']['bulb'].data.materials[0] = P['M']['bulb_off']
    elev, az = math.radians(30), math.radians(-65)          # az: from +Y (out of the window) towards -X (left)
    to_sun = Vector((math.sin(az) * math.cos(elev), math.cos(az) * math.cos(elev), math.sin(elev)))
    sun = light('sun', 'SUN', (0, 3, 3), 9.0, kelvin=5000, size=math.radians(0.55))
    sun.rotation_euler = (-to_sun).to_track_quat('-Z', 'Y').to_euler()
    w = WINDOW
    window_fill(light('window_sky', 'AREA', ((w['x0'] + w['x1']) / 2, WALL_Y + 0.12, (w['z0'] + w['z1']) / 2), 40.0,
                      kelvin=7500, size=w['x1'] - w['x0'], size_y=w['z1'] - w['z0'], rot=(math.radians(-90), 0, 0)))
    wl = WINDOW_L
    window_fill(light('window_sky_l', 'AREA', (ROOM['x0'] - 0.12, (wl['y0'] + wl['y1']) / 2, (wl['z0'] + wl['z1']) / 2), 40.0,
                      kelvin=7500, size=wl['y1'] - wl['y0'], size_y=wl['z1'] - wl['z0'], rot=(0, math.radians(-90), 0)))   # emitting +X, into the room
    # the sun's bounce off the sunlit floor and desk, lighting the ceiling and walls from below (which is also what the
    # sleeping laptop's glossy screen mirrors). Seen only through its effect: hidden from the camera and from reflections.
    b = light('sun_bounce', 'AREA', (-0.4, -2.2, 0.05), 45.0, kelvin=4300, size=2.4, size_y=2.0, rot=(math.radians(180), 0, 0))
    window_fill(b)
    return sun


# ---------------------------------------------------------------- scene

def render_settings(samples=256, res=(1920, 1080), pct=100, white_k=None, exposure=0.0):
    sc = bpy.context.scene
    if white_k:     # camera white balance, as set on set: night is balanced to the lamp, morning to daylight
        sc.view_settings.use_white_balance = True
        sc.view_settings.white_balance_temperature = white_k
    sc.view_settings.exposure = exposure
    sc.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'METAL'
    sc.cycles.device = 'GPU'
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.015
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    sc.cycles.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    sc.cycles.max_bounces = 10
    sc.cycles.diffuse_bounces = 5
    sc.cycles.glossy_bounces = 5
    sc.cycles.transparent_max_bounces = 12
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0
    sc.cycles.sample_clamp_indirect = 8.0
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = pct
    sc.render.film_transparent = False
    sc.render.fps = 24
    sc.render.use_persistent_data = True     # keep the BVH and textures between animation frames
    sc.view_settings.view_transform = 'AgX'
    try:
        sc.view_settings.look = 'AgX - Medium High Contrast'
    except TypeError:
        pass
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.color_depth = '8'


def build(time='night', parcel=False, laptop=None, phone=None, phone_wake=None):
    """laptop / phone: the screen's sequence folder in textures/seq/, or None for a display that is off."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    M = materials()
    build_room(M)
    build_desk(M)
    # by morning the lid sits a little more upright (102° rather than 112°), as if nudged as it went to sleep; at that
    # angle its glass mirrors the room's side window
    lap, lap_scr = build_laptop(M, (0.02, 0.60, DESK_TOP), yaw_deg=-4, open_deg=112.0 if time == 'night' else 102.0)
    ph, ph_scr = build_phone(M, (0.25, 0.47, DESK_TOP), yaw_deg=-18)
    P = build_props(M, night=time == 'night')
    P.update(M=M, laptop=lap, phone=ph, laptop_screen=lap_scr, phone_screen=ph_scr)
    if parcel:
        P['parcel'] = build_parcel(M, (-0.34, 0.405, DESK_TOP), yaw_deg=-25)   # set down front-left, by the laptop
    strength = 1.0 if time == 'night' else 3.5      # screens sit at the same brightness; the room's light changes
    set_screen(M['laptop_screen'], laptop, strength)
    set_screen(M['phone_screen'], phone, strength, wake=phone_wake)
    if time == 'morning':
        # by day the laptop sleeps: its display is black cover glass, and it should mirror the bright room like a real
        # glossy display does (a little more reflectance, less haze; still physical for coated display glass)
        for mat in (M['laptop_screen'], M['bezel']):
            glossier(mat, ior=1.65, rough=(0.006, 0.03))
    (lights_night if time == 'night' else lights_morning)(P)
    return P


def camera(name, loc, target, focal=50, fstop=2.8, focus=None, sensor=36.0):
    cd = bpy.data.cameras.new(name)
    cd.lens = focal
    cd.sensor_width = sensor
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = fstop
    cd.dof.aperture_blades = 9
    cd.dof.aperture_rotation = math.radians(10)
    cd.clip_start = 0.01
    ob = bpy.data.objects.new(name, cd)
    link(ob, 'Cameras')
    ob.location = loc
    aim(ob, target)
    if focus is not None:
        if isinstance(focus, bpy.types.Object):
            cd.dof.focus_object = focus
        else:
            cd.dof.focus_distance = (Vector(focus) - Vector(loc)).length
    bpy.context.scene.camera = ob
    return ob
