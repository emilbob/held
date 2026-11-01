"""Set dressing: furniture, candles, books, decorative pumpkins, dried flowers. Positions follow room.py."""
import bpy, math
from lib import import_gltf, place, box, empty, rng, simple
import room, fire, pumpkin

MZ = room.MANTEL_Z
MY = room.BREAST['y0'] - 0.07          # middle of the mantel shelf's depth
HZ, HY = room.HEARTH['z'], 1.56         # hearth top, a line along it in front of the brick


def book(M, name, w, d, h, loc, rz, color, c='Props'):
    """A hardback: a cover box with the page block inset on three sides."""
    key = f'cover_{color}'
    if key not in M:
        M[key] = simple(key, color, 0.6, rough_var=0.15, color_var=0.25, var_scale=25, sheen=0.3)
    root = empty(name, loc, c)
    root.rotation_euler = (0, 0, math.radians(rz))
    cv = box(name + '_cover', w, d, h, (0, 0, 0), bevel=0.0015, mat=M[key], c=c, origin='bottom')
    cv.parent = root
    pg = box(name + '_pages', w - 0.008, d - 0.004, h - 0.005, (0.004, 0, 0.0025), mat=M['pages'], c=c, origin='bottom')
    pg.parent = root
    pg.location.x = 0.0045
    return root


def dried_flowers(M, loc, seed=8, n=15):
    """A loose bunch of dried stems: bunny-tail grass heads, seed-pod clusters and a few wheat ears, in straw,
    rust and pale seed tones, fanning out of the vase's neck."""
    from lib import tube
    from pumpkin import sphere
    R = rng(seed)
    for key, col in (('straw', (0.42, 0.33, 0.18)), ('rust', (0.32, 0.12, 0.05)), ('seed', (0.62, 0.55, 0.42)), ('stalk', (0.22, 0.18, 0.1))):
        M.setdefault('dry_' + key, simple('dry_' + key, col, 0.7, sheen=0.5, color_var=0.25, var_scale=200))
    root = empty('dried_flowers', loc, 'Props')
    for i in range(n):
        a = R.uniform(0, 2 * math.pi)
        tilt = R.uniform(0.1, 0.55)
        L = R.uniform(0.22, 0.42)
        pts = []
        for k in range(6):
            t = k / 5
            r = math.sin(tilt) * L * t * (0.6 + 0.4 * t)
            pts.append((r * math.cos(a), r * math.sin(a), math.cos(tilt) * L * t))
        st = tube(f'dry_stem_{i}', pts, [0.0018] * 6, M['dry_stalk'], segs=5, c='Props')
        st.parent = root
        tip = pts[-1]
        kind = R.choice(('tail', 'tail', 'pods', 'wheat'))
        if kind == 'tail':
            h = sphere(f'dry_head_{i}', 0.011, M['dry_seed'], 'Props', segs=12, rings=8, scale=(0.8, 0.8, 1.9))
            h.parent = root
            h.location = (tip[0], tip[1], tip[2] + 0.012)
            h.rotation_euler = (math.sin(a) * -tilt, math.cos(a) * tilt, 0)
        elif kind == 'pods':
            for k in range(5):
                b = sphere(f'dry_pod_{i}_{k}', R.uniform(0.006, 0.009), M['dry_rust'], 'Props', segs=10, rings=6)
                b.parent = root
                b.location = (tip[0] + R.uniform(-0.02, 0.02), tip[1] + R.uniform(-0.02, 0.02), tip[2] + R.uniform(-0.01, 0.02))
        else:
            for k in range(7):
                g = sphere(f'dry_grain_{i}_{k}', 0.004, M['dry_straw'], 'Props', segs=8, rings=5, scale=(0.8, 0.8, 1.6))
                g.parent = root
                g.location = (tip[0] + (0.004 if k % 2 else -0.004), tip[1], tip[2] + k * 0.007)


def tint_model(parts, rgb):
    """Multiply an imported model's base colour by rgb (its textures keep their detail)."""
    from lib import mix_rgb
    for ob in parts:
        for sl in ob.material_slots:
            nt = sl.material.node_tree
            b = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
            ln = b.inputs['Base Color'].links
            if ln:
                nt.links.new(mix_rgb(nt, ln[0].from_socket, rgb, 1.0, 'MULTIPLY'), b.inputs['Base Color'])


def build_furniture(M):
    chair, parts = import_gltf('ArmChair_01')
    place(chair, (1.35, 0.12, 0), -160)          # facing the fire, its back to the camera
    tint_model(parts, (0.62, 0.33, 0.24))        # dusty rose-rust upholstery, darker wood
    table, _ = import_gltf('side_table_01')
    place(table, (2.45, -0.2, 0), -20)
    books, _ = import_gltf('book_encyclopedia_set_01')
    place(books, (2.28, -0.08, 0.551), -20 + 180, 0.8)
    box('rug', 2.4, 1.6, 0.012, (1.15, -0.3, 0.006), bevel=0.004, mat=M['rug'], c='Props')
    basket, _ = import_gltf('wicker_basket_01')
    place(basket, (2.75, 2.0, 0), 15)


def build_mantel(M):
    clock, _ = import_gltf('mantel_clock_01')
    place(clock, (room.FX + 0.02, MY + 0.02, MZ), 0)
    vase, _ = import_gltf('ceramic_vase_01')
    place(vase, (-0.03, MY, MZ), 20, 0.8)
    dried_flowers(M, (-0.03, MY, MZ + 0.29))
    for i, (x, h, sd) in enumerate(((0.28, 0.0, 1), (1.27, 0.0, 2))):
        cs, _ = import_gltf('wooden_candlestick')
        place(cs, (x, MY + 0.02, MZ), 0, 1.0)
        fire.candle(f'taper_{i}', (x, MY + 0.02, MZ + 0.205), h=0.2, r=0.011, M=M, power=0.7, seed=10 + i)
    fire.candle('mantel_pillar_0', (1.48, MY - 0.02, MZ), h=0.16, r=0.035, M=M, power=0.9, seed=21)
    fire.candle('mantel_pillar_1', (1.6, MY + 0.03, MZ), h=0.1, r=0.03, M=M, mat=M['wax_old'], power=0.7, seed=22)
    pumpkin.decor(M, 'mantel_pk_0', (0.12, MY - 0.02, MZ), R=0.06, variety='white', seed=3, rz=30)
    pumpkin.decor(M, 'mantel_pk_1', (1.08, MY - 0.03, MZ), R=0.05, variety='orange', seed=4, rz=-20)
    book(M, 'mantel_book_0', 0.2, 0.14, 0.03, (1.66, MY - 0.01, MZ), 85, (0.18, 0.08, 0.06))


def build_hearth(M):
    pumpkin.decor(M, 'hearth_pk_big', (-0.0, 1.55, HZ), R=0.17, variety='jarrah', squash=0.62, ribs=12, seed=11, rz=10)
    pumpkin.decor(M, 'hearth_pk_1', (0.22, 1.44, HZ), R=0.085, variety='orange', seed=12, rz=50)
    pumpkin.decor(M, 'hearth_pk_2', (1.5, 1.52, HZ), R=0.13, variety='deep', squash=0.7, seed=13, rz=-30)
    pumpkin.decor(M, 'hearth_pk_3', (1.3, 1.42, HZ), R=0.075, variety='white', seed=14, rz=0)
    for i, (x, y, h, r) in enumerate(((0.3, 1.6, 0.2, 0.04), (0.18, 1.66, 0.13, 0.035), (0.38, 1.5, 0.09, 0.03))):
        fire.candle(f'hearth_candle_{i}', (x, y, HZ), h=h, r=r, M=M, power=0.7, seed=30 + i)
    # mini gourds in the basket by the chair
    for i, (dx, dy, R_, v) in enumerate(((-0.07, 0, 0.05, 'orange'), (0.06, 0.03, 0.045, 'white'), (0.0, -0.06, 0.04, 'deep'))):
        pumpkin.decor(M, f'basket_pk_{i}', (2.75 + dx, 2.0 + dy, 0.03), R=R_, variety=v, seed=40 + i, rz=i * 70)


def build_window_sill(M):
    w = room.WIN
    sz = w['z0']
    fire.candle('sill_candle_0', (w['x0'] + 0.22, room.BACK + 0.05, sz), h=0.14, r=0.035, M=M, power=0.8, seed=51)
    fire.candle('sill_candle_1', (w['x0'] + 0.34, room.BACK + 0.0, sz), h=0.09, r=0.03, M=M, mat=M['wax_old'], power=0.6, seed=52)
    pumpkin.decor(M, 'sill_pk', (w['x1'] - 0.25, room.BACK + 0.04, sz), R=0.065, variety='orange', seed=53, rz=10)
    v, _ = import_gltf('antique_ceramic_vase_01')
    place(v, (w['x1'] + 0.35, room.BACK - 0.25, 0), 0, 1.0)


def build_lantern_stand(M, loc):
    """Two old books on the floor for the lantern to stand on. Returns the top's z."""
    x, y = loc
    book(M, 'stand_book_0', 0.26, 0.19, 0.04, (x, y, 0), 12, (0.10, 0.12, 0.10))
    book(M, 'stand_book_1', 0.22, 0.16, 0.034, (x + 0.005, y - 0.004, 0.04), -6, (0.28, 0.12, 0.06))
    return 0.074


def build(M):
    build_furniture(M)
    build_mantel(M)
    build_hearth(M)
    build_window_sill(M)
