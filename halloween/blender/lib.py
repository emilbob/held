"""Shared helpers: geometry, materials, lights, imports. Units are metres, Z up."""
import bpy, bmesh, math, os, random
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
A = os.path.join(ROOT, 'assets')


# ---------------------------------------------------------------- objects

def coll(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def link(ob, c='Scene'):
    for u in list(ob.users_collection):
        u.objects.unlink(ob)
    coll(c).objects.link(ob)
    return ob


def empty(name, loc=(0, 0, 0), c='Scene', parent=None):
    ob = bpy.data.objects.new(name, None)
    link(ob, c)
    ob.location = loc
    ob.empty_display_size = 0.05
    if parent:
        ob.parent = parent
    return ob


def mesh_obj(name, bm, c='Scene', mat=None, smooth_shade=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    if mat:
        for m in (mat if isinstance(mat, (list, tuple)) else [mat]):
            ob.data.materials.append(m)
    if smooth_shade:
        for p in me.polygons:
            p.use_smooth = True
    return link(ob, c)


def box(name, sx, sy, sz, loc=(0, 0, 0), bevel=0.0, mat=None, c='Scene', origin='center', segs=3):
    """Box sx × sy × sz with a rounded bevel on every edge. origin 'bottom' = bottom face centre."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz + (sz / 2 if origin == 'bottom' else 0)))
    ob = mesh_obj(name, bm, c, mat, smooth_shade=False)
    ob.location = loc
    if bevel > 0:
        m = ob.modifiers.new('bevel', 'BEVEL')
        m.width = bevel
        m.segments = segs
        m.limit_method = 'ANGLE'
        for p in ob.data.polygons:
            p.use_smooth = True
        ob.modifiers.new('wn', 'WEIGHTED_NORMAL').keep_sharp = True
    return ob


def lathe(name, profile, mat, segs=64, c='Scene', cap=True):
    """Surface of revolution around Z from a (radius, z) profile; radius 0 points become poles."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        if r <= 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * i / segs), r * math.sin(2 * math.pi * i / segs), z))
                          for i in range(segs)])
    for r0, r1 in zip(rings, rings[1:]):
        if len(r0) == 1 and len(r1) == 1:
            continue
        if len(r0) == 1:
            for i in range(segs):
                bm.faces.new((r0[0], r1[i], r1[(i + 1) % segs]))
        elif len(r1) == 1:
            for i in range(segs):
                bm.faces.new((r0[i], r0[(i + 1) % segs], r1[0]))
        else:
            for i in range(segs):
                bm.faces.new((r0[i], r0[(i + 1) % segs], r1[(i + 1) % segs], r1[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, c, mat)


def tube(name, pts, radii, mat, segs=12, c='Scene'):
    """A tube along a polyline pts with per-point radius; closed with round-ish caps."""
    bm = bmesh.new()
    pts = [Vector(p) for p in pts]
    rings = []
    up = Vector((0, 0, 1))
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        ref = up if abs(t.dot(up)) < 0.95 else Vector((1, 0, 0))
        n = t.cross(ref).normalized()
        b = t.cross(n).normalized()
        r = radii[i]
        rings.append([bm.verts.new(p + r * (math.cos(2 * math.pi * k / segs) * n + math.sin(2 * math.pi * k / segs) * b))
                      for k in range(segs)])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(segs):
            bm.faces.new((r0[k], r0[(k + 1) % segs], r1[(k + 1) % segs], r1[k]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, c, mat)


def subsurf(ob, levels=2, render=None):
    m = ob.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = render if render is not None else levels
    return m


def import_gltf(name, c='Props'):
    path = os.path.join(A, 'models', name, name + '_2k.gltf')
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    root = empty(name, c=c)
    for o in new:
        link(o, c)
        if o.parent is None:
            o.parent = root
    return root, [o for o in new if o.type == 'MESH']


def place(ob, loc, rz_deg=0.0, scale=1.0):
    ob.location = loc
    ob.rotation_euler = (0, 0, math.radians(rz_deg))
    ob.scale = (scale,) * 3
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


def mix_rgb(nt, a, b, fac, blend='MIX'):
    mx = nt.nodes.new('ShaderNodeMix')
    mx.data_type = 'RGBA'
    mx.blend_type = blend
    for slot, v in ((6, a), (7, b)):
        if isinstance(v, (tuple, list)):
            mx.inputs[slot].default_value = (*v[:3], 1)
        else:
            nt.links.new(v, mx.inputs[slot])
    if isinstance(fac, (int, float)):
        mx.inputs['Factor'].default_value = fac
    else:
        nt.links.new(fac, mx.inputs['Factor'])
    return mx.outputs[2]


def pbr(name, folder, scale=1.0, rot=0.0, tint=None, sat=1.0, val=1.0, rough_mul=1.0, rough_add=0.0, bump=0.3,
        coat=0.0, coat_rough=0.2, box_blend=0.25, coords='Object', sheen=0.0):
    """Poly Haven texture set, box-projected (scale = metres per tile). tint multiplies; sat/val adjust colour."""
    m, nt, bsdf, out = node_mat(name)
    d = os.path.join(A, 'textures', folder)
    files = os.listdir(d)
    pick = lambda *keys: next(os.path.join(d, f) for f in files if any(k in f for k in keys))
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / scale,) * 3
    mp.inputs['Rotation'].default_value = (0, 0, rot)
    nt.links.new(tc.outputs[coords], mp.inputs['Vector'])

    def tex(path, nc):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img(path, nc)
        if coords != 'UV':
            t.projection = 'BOX'
            t.projection_blend = box_blend
        nt.links.new(mp.outputs[0], t.inputs[0])
        return t
    col = tex(pick('_diff_'), False).outputs[0]
    if sat != 1.0 or val != 1.0:
        hsv = nt.nodes.new('ShaderNodeHueSaturation')
        hsv.inputs['Saturation'].default_value = sat
        hsv.inputs['Value'].default_value = val
        nt.links.new(col, hsv.inputs['Color'])
        col = hsv.outputs[0]
    if tint:
        col = mix_rgb(nt, col, tint, 1.0, 'MULTIPLY')
    nt.links.new(col, bsdf.inputs['Base Color'])
    r = tex(pick('_rough_'), True)
    mr = nt.nodes.new('ShaderNodeMath')
    mr.operation = 'MULTIPLY_ADD'
    mr.use_clamp = True
    mr.inputs[1].default_value = rough_mul
    mr.inputs[2].default_value = rough_add
    nt.links.new(r.outputs[0], mr.inputs[0])
    nt.links.new(mr.outputs[0], bsdf.inputs['Roughness'])
    disp = tex(pick('_disp_'), True)
    bp = nt.nodes.new('ShaderNodeBump')
    bp.inputs['Strength'].default_value = bump
    bp.inputs['Distance'].default_value = 0.002 * scale
    nt.links.new(disp.outputs[0], bp.inputs['Height'])
    nt.links.new(bp.outputs[0], bsdf.inputs['Normal'])
    if coat:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = coat_rough
    if sheen:
        bsdf.inputs['Sheen Weight'].default_value = sheen
    m['disp'] = disp.name
    return m


def noise(nt, scale=5.0, detail=4.0, coords='Object', dims='3D', rough=0.5, distortion=0.0):
    tc = nt.nodes.new('ShaderNodeTexCoord')
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.noise_dimensions = dims
    nz.inputs['Scale'].default_value = scale
    nz.inputs['Detail'].default_value = detail
    nz.inputs['Roughness'].default_value = rough
    nz.inputs['Distortion'].default_value = distortion
    nt.links.new(tc.outputs[coords], nz.inputs['Vector'])
    return nz


def map_range(nt, src, a0, a1, b0, b1, clamp=True):
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.clamp = clamp
    mr.inputs['From Min'].default_value = a0
    mr.inputs['From Max'].default_value = a1
    mr.inputs['To Min'].default_value = b0
    mr.inputs['To Max'].default_value = b1
    nt.links.new(src, mr.inputs['Value'])
    return mr.outputs[0]


def simple(name, color, rough, metal=0.0, rough_var=0.0, spec=0.5, coat=0.0, coat_rough=0.1, sheen=0.0,
           sss=0.0, sss_radius=(0.1, 0.05, 0.02), color_var=0.0, var_scale=30.0):
    """Principled material with noise-broken roughness and (optionally) colour, so nothing reads as plastic."""
    m, nt, bsdf, out = node_mat(name)
    if color_var:
        nz = noise(nt, var_scale * 0.3, 4)
        dark = tuple(c * (1 - color_var) for c in color)
        nt.links.new(mix_rgb(nt, dark, color, map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0, 1)), bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metal
    bsdf.inputs['Specular IOR Level'].default_value = spec
    if rough_var:
        nz = noise(nt, var_scale, 6)
        nt.links.new(map_range(nt, nz.outputs['Fac'], 0.25, 0.75, rough - rough_var, rough + rough_var), bsdf.inputs['Roughness'])
    else:
        bsdf.inputs['Roughness'].default_value = rough
    if coat:
        bsdf.inputs['Coat Weight'].default_value = coat
        bsdf.inputs['Coat Roughness'].default_value = coat_rough
    if sheen:
        bsdf.inputs['Sheen Weight'].default_value = sheen
    if sss:
        bsdf.inputs['Subsurface Weight'].default_value = sss
        bsdf.inputs['Subsurface Radius'].default_value = sss_radius
        bsdf.inputs['Subsurface Scale'].default_value = 0.05
    return m


def emission(name, color, strength):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1)
    em.inputs['Strength'].default_value = strength
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


# ---------------------------------------------------------------- lights & animation

def light(name, kind, loc, energy, kelvin=None, color=None, size=0.1, size_y=None, rot=(0, 0, 0), spot=None, blend=0.5,
          shape='RECTANGLE', c='Lights', shadow=True, diffuse=1.0, specular=1.0, volume=1.0):
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
    ld.use_shadow = shadow
    ld.diffuse_factor = diffuse
    ld.specular_factor = specular
    ld.volume_factor = volume
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = rot
    return link(ob, c)


def aim(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def flicker(id_block, path, base, amount, speed=1.0, seed=0, index=-1):
    """Organic flicker: a keyed base value with two noise modifiers (slow sway + fast flutter) on its F-curve.
    id_block must be an ID (object, light data, material...); path may be nested, e.g. 'modifiers["sway"].angle'."""
    id_block.keyframe_insert(path, index=index, frame=1)
    ad = id_block.animation_data
    fcs = [fc for fc in _fcurves(ad.action) if fc.data_path == path and (index < 0 or fc.array_index == index)]
    for fc in fcs:
        for kp in fc.keyframe_points:
            kp.co.y = base
        for scale, strength, phase in ((14.0 / speed, amount * 0.7, seed * 13.1), (3.0 / speed, amount * 0.45, seed * 7.7 + 3)):
            nm = fc.modifiers.new('NOISE')
            nm.scale = scale
            nm.strength = strength
            nm.phase = phase
            nm.depth = 1


def _fcurves(action):
    """F-curves of an action (Blender 4.4+ layered actions, or the legacy list)."""
    if hasattr(action, 'layers') and action.layers:
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    out.extend(cb.fcurves)
        return out
    return list(action.fcurves)


def fcurves(id_block):
    ad = id_block.animation_data
    return _fcurves(ad.action) if ad and ad.action else []


def set_interp(id_block, kind='BEZIER', easing='AUTO'):
    for fc in fcurves(id_block):
        for kp in fc.keyframe_points:
            kp.interpolation = kind
            kp.easing = easing


def rng(seed):
    return random.Random(seed)
