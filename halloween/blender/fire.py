"""Fire and candlelight, all procedural and cheap: emissive shaders animated by drivers on the frame, and flickering
lights animated by noise modifiers. No simulations."""
import bpy, bmesh, math
from mathutils import Vector
from lib import lathe, tube, mesh_obj, light, flicker, empty, rng, subsurf
import room

FIRE_K = 1850       # colour temperature of the firelight
CANDLE_K = 1900


def log(name, length, r, loc, rot, mat, seed):
    """A split log: a slightly irregular cylinder (bark, or charred with embers)."""
    R = rng(seed)
    n = 9
    pts = [(-length / 2 + length * i / (n - 1), 0, 0) for i in range(n)]
    radii = [r * (0.9 + 0.2 * R.random()) for _ in range(n)]
    ob = tube(name, pts, radii, mat, segs=20, c='Fire')
    for v in ob.data.vertices:          # lumpy
        v.co += Vector((0, R.uniform(-1, 1) * r * 0.06, R.uniform(-1, 1) * r * 0.06))
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def flame_card(name, w, h, loc, rz, mat):
    """A vertical card with UVs (u across, v up) for the fire shader, its bottom edge at loc."""
    bm = bmesh.new()
    nx, nz = 6, 10
    vs = [[bm.verts.new((-w / 2 + w * i / nx, 0, h * j / nz)) for i in range(nx + 1)] for j in range(nz + 1)]
    uv = bm.loops.layers.uv.new('UVMap')
    for j in range(nz):
        for i in range(nx):
            f = bm.faces.new((vs[j][i], vs[j][i + 1], vs[j + 1][i + 1], vs[j + 1][i]))
            for l, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uv].uv = (a / nx, b / nz)
    ob = mesh_obj(name, bm, 'Fire', mat)
    ob.location = loc
    ob.rotation_euler = (0, 0, math.radians(rz))
    ob.visible_shadow = False
    # a gentle sway so the cards aren't rigid
    sw = ob.modifiers.new('sway', 'SIMPLE_DEFORM')
    sw.deform_method = 'BEND'
    sw.deform_axis = 'X'
    sw.angle = 0.0
    flicker(ob, 'modifiers["sway"].angle', 0.0, 0.25, speed=1.3, seed=sum(map(ord, name)) % 97)
    return ob


def build_hearth_fire(M):
    o = room.OPEN
    cx, cy, z = (o['x0'] + o['x1']) / 2, 1.98, o['z0']
    # iron grate
    for i, dx in enumerate((-0.2, 0.2)):
        tube(f'andiron_{i}', [(cx + dx, cy - 0.16, z), (cx + dx, cy - 0.16, z + 0.12), (cx + dx, cy - 0.1, z + 0.08),
                              (cx + dx, cy + 0.12, z + 0.08)], [0.012] * 4, M['iron'], segs=8, c='Fire')
    # logs: two along, one across on top
    log('log_0', 0.5, 0.055, (cx, cy - 0.04, z + 0.09), (0, 0, math.radians(4)), M['embers'], 1)
    log('log_1', 0.46, 0.05, (cx + 0.02, cy + 0.08, z + 0.1), (0, 0, math.radians(-6)), M['embers'], 2)
    log('log_2', 0.44, 0.045, (cx - 0.02, cy + 0.02, z + 0.18), (math.radians(8), 0, math.radians(28)), M['embers'], 3)
    # a bed of embers
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.26, v.co.y * 0.14, max(v.co.z, -0.1) * 0.035))
    eb = mesh_obj('ember_bed', bm, 'Fire', M['embers'])
    eb.location = (cx, cy + 0.02, z + 0.01)
    # flame cards in a loose fan
    R = rng(7)
    for i in range(7):
        w = 0.22 + R.random() * 0.12
        h = 0.32 + R.random() * 0.2
        x = cx + R.uniform(-0.14, 0.14)
        y = cy + R.uniform(-0.06, 0.08)
        flame_card(f'flame_{i}', w, h, (x, y, z + 0.08), R.uniform(-35, 35), M['fire'])
    # the firelight comes from the flames, behind the logs' front faces: lights inside the firebox above the logs,
    # so the logs read dark against the flames, the surround's face stays in shadow and the light spills out of the
    # opening onto the room. A faint low glow in front stands in for the embers lighting the hearth.
    L = []
    for i, (dx, dy, dz, e, s) in enumerate(((0.0, -0.08, 0.30, 9, 0.12), (-0.16, -0.02, 0.24, 4, 0.1),
                                            (0.16, -0.02, 0.22, 4, 0.1), (0.0, -0.32, 0.05, 4, 0.15))):
        lt = light(f'firelight_{i}', 'POINT', (cx + dx, cy + dy, z + dz), e, kelvin=FIRE_K if i < 3 else 1500, size=s, volume=0.4)
        flicker(lt.data, 'energy', e, e * 0.35, speed=1.4, seed=11 + i)
        flicker(lt, 'location', lt.location.z, 0.02, speed=1.0, seed=31 + i, index=2)
        L.append(lt)
    # the light leaving the opening: an area light across it, facing the room (it can't light the surround's face,
    # which is behind its plane). Hidden from the camera and from reflections.
    sp = light('fire_spill', 'AREA', (cx, room.BREAST['y0'] - 0.05, (o['z0'] + o['z1']) / 2 - 0.08), 160, kelvin=FIRE_K,
               size=o['x1'] - o['x0'] - 0.1, size_y=o['z1'] - o['z0'] - 0.25, rot=(math.radians(-90), 0, 0), volume=0.08)   # emits -Y, into the room
    sp.visible_camera = False
    sp.visible_glossy = False
    flicker(sp.data, 'energy', 160, 50, speed=1.4, seed=17)
    L.append(sp)
    return L


def candle(name, loc, h=0.14, r=0.025, mat=None, M=None, lit=True, power=1.6, seed=0, c='Candles'):
    """A pillar or taper candle: melted dip at the top, a wick, a teardrop flame and its flickering light."""
    R = rng(seed)
    mat = mat or M['wax']
    root = empty(name, loc, c)
    dip = min(0.012, r * 0.35)
    prof = [(0, 0), (r * 0.98, 0), (r, 0.003), (r * (1 + R.uniform(-0.02, 0.02)), h * 0.5), (r, h - 0.002),
            (r * 0.94, h), (r * 0.7, h - dip * 0.6), (r * 0.3, h - dip), (0, h - dip)]
    body = lathe(name + '_wax', prof, mat, segs=48, c=c)
    body.parent = root
    # a drip or two down the side
    for k in range(R.randint(0, 2)):
        a = R.uniform(0, 2 * math.pi)
        dl = R.uniform(0.2, 0.5) * h
        pts = [(r * math.cos(a), r * math.sin(a), h - 0.003 - dl * t) for t in (0, 0.5, 1)]
        d = tube(f'{name}_drip{k}', pts, [0.004, 0.0035, 0.0025], mat, segs=8, c=c)
        d.parent = root
    wick = tube(name + '_wick', [(0, 0, h - dip - 0.002), (0, 0.001, h - dip + 0.008), (0.002, 0.002, h - dip + 0.012)],
                [0.0011] * 3, M['wick'], segs=6, c=c)
    wick.parent = root
    if not lit:
        return root, None
    fh = 0.032 + r * 0.25
    fprof = [(0, 0), (0.0035, 0.06), (0.0055, 0.2), (0.0058, 0.33), (0.0048, 0.55), (0.0026, 0.8), (0, 1.0)]
    fl = lathe(name + '_flame', [(rr, zz * fh) for rr, zz in fprof], M['flame'], segs=16, c=c)
    fl.parent = root
    fl.location = (0, 0, h - dip + 0.004)
    fl.visible_shadow = False
    # flame flicker: sway and stretch
    flicker(fl, 'rotation_euler', 0.0, 0.07, speed=1.6, seed=seed * 3 + 1, index=0)
    flicker(fl, 'rotation_euler', 0.0, 0.07, speed=1.6, seed=seed * 3 + 2, index=1)
    flicker(fl, 'scale', 1.0, 0.08, speed=2.0, seed=seed * 3 + 3, index=2)
    lt = light(name + '_light', 'POINT', (0, 0, 0), power, kelvin=CANDLE_K, size=0.008, c=c)
    lt.parent = root
    lt.location = (0, 0, h - dip + fh * 1.3)
    lt.data.use_soft_falloff = False
    flicker(lt.data, 'energy', power, power * 0.22, speed=1.8, seed=seed * 5 + 7)
    return root, lt
