"""The night outside the window: a moonlit sky backdrop with a distant tree line, a bare tree close to the glass
whose branches sway, and autumn leaves blowing past. All keyframed/driven; no simulation."""
import bpy, bmesh, math
from mathutils import Vector
from lib import mesh_obj, tube, empty, node_mat, noise, map_range, mix_rgb, rng, light, flicker, fcurves
import room


def sky_mat():
    m = bpy.data.materials.new('sky')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['UV'], sep.inputs[0])
    # gradient: deep blue overhead, a hazy lighter band low down
    grad = mix_rgb(nt, (0.06, 0.11, 0.22), (0.010, 0.018, 0.045), map_range(nt, sep.outputs['Y'], 0.15, 0.85, 0, 1))
    # moon glow (upper left of the window)
    # the backdrop is 14 × 7 m but its UVs run 0–1 both ways: scale u by 2 so the moon (and its halo) are round
    ux = nt.nodes.new('ShaderNodeMath')
    ux.operation = 'MULTIPLY'
    ux.inputs[1].default_value = 2.0
    nt.links.new(sep.outputs['X'], ux.inputs[0])
    c = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(ux.outputs[0], c.inputs['X'])
    nt.links.new(sep.outputs['Y'], c.inputs['Y'])
    d = nt.nodes.new('ShaderNodeVectorMath')
    d.operation = 'DISTANCE'
    d.inputs[1].default_value = (0.66, 0.56, 0)
    nt.links.new(c.outputs[0], d.inputs[0])
    halo = map_range(nt, d.outputs['Value'], 0.0, 0.22, 1.0, 0.0)
    pw = nt.nodes.new('ShaderNodeMath')
    pw.operation = 'POWER'
    pw.inputs[1].default_value = 2.5
    nt.links.new(halo, pw.inputs[0])
    col = mix_rgb(nt, grad, (0.35, 0.45, 0.65), pw.outputs[0], 'ADD')
    disc = map_range(nt, d.outputs['Value'], 0.024, 0.027, 1.0, 0.0)
    # the moon's face: faint maria
    nz = noise(nt, 60, 4, coords='UV')
    face = mix_rgb(nt, (2.2, 2.3, 2.4), (1.4, 1.5, 1.65), map_range(nt, nz.outputs['Fac'], 0.45, 0.6, 0, 1))
    col = mix_rgb(nt, col, face, disc)
    # clouds: soft noise drifting across, lit faintly
    nz2 = nt.nodes.new('ShaderNodeTexNoise')
    nz2.noise_dimensions = '4D'
    nz2.inputs['Scale'].default_value = 3.0
    nz2.inputs['Detail'].default_value = 6
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1, 2.5, 1)
    nt.links.new(tc.outputs['UV'], mp.inputs[0])
    nt.links.new(mp.outputs[0], nz2.inputs['Vector'])
    nz2.inputs['W'].driver_add('default_value').driver.expression = 'frame * 0.004'
    mp.inputs['Location'].driver_add('default_value', 0).driver.expression = 'frame * 0.0012'
    cl = map_range(nt, nz2.outputs['Fac'], 0.5, 0.75, 0.0, 0.6)
    col = mix_rgb(nt, col, (0.07, 0.09, 0.14), cl)
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(col, em.inputs['Color'])
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(em.outputs[0], out.inputs[0])
    return m


def treeline_mat(name, col):
    """Silhouettes read by their own faint emission (atmospheric haze) rather than by lighting."""
    m, nt, bsdf, out = node_mat(name)
    bsdf.inputs['Base Color'].default_value = (0, 0, 0, 1)
    bsdf.inputs['Emission Color'].default_value = (*col, 1)
    bsdf.inputs['Emission Strength'].default_value = 1.0
    return m


def build_backdrop(M):
    C = 'Outside'
    W, H = 14.0, 7.0
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in ((-W / 2, 0, 0), (W / 2, 0, 0), (W / 2, 0, H), (-W / 2, 0, H))]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new('UVMap')
    for l, c in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        l[uv].uv = c
    sky = mesh_obj('sky', bm, C, sky_mat())
    sky.location = (-1.6, 9.0, -1.0)
    sky.visible_shadow = False
    # distant tree lines: two soft, rounded silhouettes (canopies as sums of bumps), the far one hazier
    for k, (y, base, amp, col) in enumerate(((8.6, 0.9, 0.9, (0.012, 0.018, 0.03)), (7.2, 0.5, 0.7, (0.003, 0.004, 0.006)))):
        R = rng(5 + k)
        crowns = [(R.uniform(-7, 7), R.uniform(0.3, 0.9), R.uniform(0.25, 0.7)) for _ in range(40)]
        bm = bmesh.new()
        n = 280
        top, bottom = [], []
        for i in range(n + 1):
            x = -7 + 14 * i / n
            h = base + 0.15 * math.sin(x * 0.7 + k)
            h += max((amp * hh * max(0.0, 1 - ((x - cx) / w) ** 2) ** 0.5 for cx, hh, w in crowns), default=0)
            top.append(bm.verts.new((x, 0, h)))
            bottom.append(bm.verts.new((x, 0, -1)))
        for i in range(n):
            bm.faces.new((bottom[i], bottom[i + 1], top[i + 1], top[i]))
        m = treeline_mat(f'treeline_{k}', col)
        tl = mesh_obj(f'treeline_{k}', bm, C, m, smooth_shade=False)
        tl.location = (-1.6, y, 0)
    # ground outside
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=8)
    g = mesh_obj('ground', bm, C, M.setdefault('ground', ground_mat()))
    g.location = (-1.6, 6.0, -0.05)


def ground_mat():
    m, nt, bsdf, out = node_mat('ground')
    nz = noise(nt, 3, 6)
    nt.links.new(mix_rgb(nt, (0.01, 0.012, 0.01), (0.04, 0.035, 0.025), map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0, 1)), bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.9
    return m


def branch(M, R, name, p0, d, length, r0, depth, parts, c):
    """Recursive bare branch: a gently curving tube, splitting into two or three thinner ones."""
    pts, radii = [], []
    p = Vector(p0)
    d = Vector(d).normalized()
    n = 6
    for i in range(n):
        t = i / (n - 1)
        pts.append(p.copy())
        radii.append(r0 * (1 - 0.45 * t))
        d = (d + Vector((R.uniform(-0.25, 0.25), R.uniform(-0.1, 0.1), R.uniform(-0.15, 0.2)))).normalized()
        p = p + d * (length / (n - 1))
    ob = tube(name, pts, radii, M['bark_out'], segs=8 if depth < 2 else 6, c=c)
    parts.append(ob)
    if depth >= 4 or r0 < 0.006:
        return
    for k in range(R.choice((2, 2, 3))):
        nd = (d + Vector((R.uniform(-0.9, 0.9), R.uniform(-0.3, 0.3), R.uniform(-0.2, 0.6)))).normalized()
        branch(M, R, f'{name}_{k}', pts[-1 - R.randint(0, 2)], nd, length * R.uniform(0.55, 0.75), radii[-1] * 0.85,
               depth + 1, parts, c)


def build_tree(M):
    """A bare tree just outside, right of the window, its branches reaching across the upper panes."""
    C = 'Outside'
    M['bark_out'] = M['bark']
    R = rng(21)
    parts = []
    root = empty('tree', (-2.9, 3.4, -0.2), C)
    branch(M, R, 'trunk', (0, 0, 0), (0.25, 0.1, 1), 1.7, 0.13, 0, parts, C)
    for ob in parts:
        ob.parent = root
    # sway in the wind: the whole tree rocks slightly (a slow gust every couple of seconds)
    flicker(root, 'rotation_euler', 0.0, 0.025, speed=0.6, seed=4, index=1)
    flicker(root, 'rotation_euler', 0.0, 0.012, speed=0.8, seed=5, index=0)
    return root


def leaf_mesh(name, mat, c, size=0.05):
    """A flat maple-ish leaf: a lobed outline fanned from its stalk."""
    bm = bmesh.new()
    centre = bm.verts.new((0, 0, 0))
    ring = []
    n = 30
    for i in range(n):
        a = 2 * math.pi * i / n
        lobes = 0.55 + 0.45 * abs(math.cos(2.5 * a)) ** 0.6
        r = size * lobes * (0.8 + 0.2 * math.sin(a))
        ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), 0.004 * math.sin(3 * a))))
    for i in range(n):
        bm.faces.new((centre, ring[i], ring[(i + 1) % n]))
    return mesh_obj(name, bm, c, mat)


def leaf_mat(name, col):
    m, nt, bsdf, out = node_mat(name)
    nz = noise(nt, 40, 4)
    nt.links.new(mix_rgb(nt, tuple(x * 0.5 for x in col), col, map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0, 1)), bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 0.6
    bsdf.inputs['Transmission Weight'].default_value = 0.0
    bsdf.inputs['Subsurface Weight'].default_value = 0.3
    return m


def build_leaves(M, frames=(1, 144)):
    """~30 leaves blowing past the window, right to left and a little down, tumbling. Each is keyed at its start and
    end with linear motion plus noise wobble; staggered so a few are always in view."""
    C = 'Outside'
    mats = [leaf_mat(f'leaf_{i}', c) for i, c in enumerate(((0.45, 0.12, 0.02), (0.55, 0.28, 0.03), (0.3, 0.08, 0.03), (0.5, 0.36, 0.08)))]
    R = rng(33)
    f0, f1 = frames
    for i in range(30):
        lf = leaf_mesh(f'leaf_{i}', R.choice(mats), C, size=R.uniform(0.025, 0.045))
        dur = R.uniform(40, 80)
        start = R.uniform(f0 - dur, f1)
        y = R.uniform(2.6, 4.5)
        z0 = R.uniform(0.6, 3.0)
        lf.location = (R.uniform(1.2, 2.0), y, z0)
        lf.keyframe_insert('location', frame=start)
        lf.location = (R.uniform(-4.6, -3.6), y + R.uniform(-0.3, 0.3), z0 - R.uniform(0.4, 1.6))
        lf.keyframe_insert('location', frame=start + dur)
        lf.rotation_euler = (R.uniform(0, 6), R.uniform(0, 6), R.uniform(0, 6))
        lf.keyframe_insert('rotation_euler', frame=start)
        lf.rotation_euler = tuple(a + R.uniform(-12, 12) for a in lf.rotation_euler)
        lf.keyframe_insert('rotation_euler', frame=start + dur)
        for fc in fcurves(lf):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
            fc.extrapolation = 'LINEAR'
            if fc.data_path == 'location' and fc.array_index == 2:
                nm = fc.modifiers.new('NOISE')
                nm.scale = 12
                nm.strength = 0.25
                nm.phase = i * 3.3


def build_moonlight():
    """Cool moonlight through the window: a sun from high behind-left, so the window casts its panes onto the floor,
    and a soft sky fill in the window opening (hidden from the camera)."""
    sun = light('moon', 'SUN', (0, 6, 4), 0.35, color=(0.62, 0.74, 1.0), size=math.radians(0.6), volume=4.0)
    elev, az = math.radians(28), math.radians(-30)
    to_moon = Vector((math.sin(az) * math.cos(elev), math.cos(az) * math.cos(elev), math.sin(elev)))
    sun.rotation_euler = (-to_moon).to_track_quat('-Z', 'Y').to_euler()
    w = room.WIN
    fill = light('window_sky', 'AREA', ((w['x0'] + w['x1']) / 2, room.BACK + 0.35, (w['z0'] + w['z1']) / 2), 4.0,
                 color=(0.45, 0.58, 1.0), size=w['x1'] - w['x0'], size_y=w['z1'] - w['z0'], rot=(math.radians(-90), 0, 0))   # emits -Y, into the room
    fill.visible_camera = False
    fill.visible_glossy = False
    return sun, fill


def build(M):
    build_backdrop(M)
    build_tree(M)
    build_leaves(M)
    return build_moonlight()
