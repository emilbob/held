"""The sitting room's architecture. The camera side is -Y; the back wall's inner face is at y = BACK."""
import bpy, bmesh, math
from mathutils import Vector
from lib import box, mesh_obj, import_gltf, place

X0, X1 = -3.0, 3.2          # left and right wall inner faces
Y0, BACK = -4.5, 2.2        # front wall (behind the camera) and back wall
H = 2.8
WALL_T = 0.3
WIN = dict(x0=-2.25, x1=-0.95, z0=0.85, z1=2.35)            # window opening in the back wall
FX = 0.75                                                   # fireplace centre line
BREAST = dict(x0=-0.25, x1=1.75, y0=1.8)                    # chimney breast, its front face at y0
OPEN = dict(x0=0.35, x1=1.15, z0=0.06, z1=0.82)             # firebox opening
FIREBOX_BACK = 2.14                                         # inside the 40 cm chimney breast
MANTEL_Z = 1.2                                              # top of the mantel shelf
HEARTH = dict(x0=-0.2, x1=1.7, y0=1.32, z=0.05)
WAINSCOT_Z = 0.92


def build_shell(M):
    C = 'Room'
    # floor and ceiling run slightly under the walls so there are no light leaks
    box('floor', X1 - X0 + 0.4, BACK - Y0 + 0.4, 0.05, ((X0 + X1) / 2, (Y0 + BACK) / 2, -0.025), mat=M['floor'], c=C)
    box('ceiling', X1 - X0 + 0.4, BACK - Y0 + 0.4, 0.05, ((X0 + X1) / 2, (Y0 + BACK) / 2, H + 0.025), mat=M['ceiling'], c=C)
    t, yc = WALL_T, BACK + WALL_T / 2
    w = WIN
    # back wall, in pieces around the window
    box('wall_back_l', w['x0'] - X0 + t, t, H, ((X0 - t + w['x0']) / 2, yc, H / 2), mat=M['wall'], c=C)
    box('wall_back_r', X1 + t - w['x1'], t, H, ((w['x1'] + X1 + t) / 2, yc, H / 2), mat=M['wall'], c=C)
    box('wall_back_b', w['x1'] - w['x0'], t, w['z0'], ((w['x0'] + w['x1']) / 2, yc, w['z0'] / 2), mat=M['wall'], c=C)
    box('wall_back_t', w['x1'] - w['x0'], t, H - w['z1'], ((w['x0'] + w['x1']) / 2, yc, (w['z1'] + H) / 2), mat=M['wall'], c=C)
    box('wall_left', t, BACK - Y0, H, (X0 - t / 2, (Y0 + BACK) / 2, H / 2), mat=M['wall'], c=C)
    box('wall_right', t, BACK - Y0, H, (X1 + t / 2, (Y0 + BACK) / 2, H / 2), mat=M['wall'], c=C)
    box('wall_front', X1 - X0 + 2 * t, t, H, ((X0 + X1) / 2, Y0 - t / 2, H / 2), mat=M['wall'], c=C)
    # crown moulding and skirting all round
    for name, sx, sy, loc in (('back', X1 - X0, 0, (0, BACK, 0)), ('left', 0, BACK - Y0, (X0, 0, 0)),
                              ('right', 0, BACK - Y0, (X1, 0, 0))):
        if sx:
            box(f'crown_{name}', sx, 0.07, 0.09, ((X0 + X1) / 2, BACK - 0.035, H - 0.045), bevel=0.012, mat=M['trim'], c=C)
        else:
            x = X0 + 0.035 if name == 'left' else X1 - 0.035
            box(f'crown_{name}', 0.07, sy, 0.09, (x, (Y0 + BACK) / 2, H - 0.045), bevel=0.012, mat=M['trim'], c=C)


def wainscot_run(M, name, a, b, axis, face, inward):
    """Panelled wainscot along one wall from a to b (along axis 'x' or 'y'); face = the wall's inner coordinate,
    inward = +1/-1, the direction into the room."""
    C = 'Room'
    L = b - a
    mid = (a + b) / 2

    def put(n, along, depth, height, pos_along, off, z, bevel=0.004):
        if axis == 'x':
            return box(n, along, depth, height, (pos_along, face + inward * off, z), bevel=bevel, mat=M['wainscot'], c=C)
        return box(n, depth, along, height, (face + inward * off, pos_along, z), bevel=bevel, mat=M['wainscot'], c=C)
    put(f'{name}_board', L, 0.02, WAINSCOT_Z, mid, 0.01, WAINSCOT_Z / 2, 0.002)
    put(f'{name}_skirt', L, 0.035, 0.16, mid, 0.0175, 0.08, 0.006)
    put(f'{name}_cap', L, 0.055, 0.035, mid, 0.0275, WAINSCOT_Z, 0.01)
    put(f'{name}_rail', L, 0.03, 0.05, mid, 0.015, WAINSCOT_Z - 0.06, 0.006)
    n = max(1, round(L / 0.55))
    pw = L / n
    for i in range(n):
        c = a + pw * (i + 0.5)
        put(f'{name}_panel_{i}', pw - 0.11, 0.035, WAINSCOT_Z - 0.34, c, 0.02, 0.16 + 0.05 + (WAINSCOT_Z - 0.34) / 2, 0.012)


def build_wainscot(M):
    wainscot_run(M, 'wsc_back_l', X0, WIN['x0'], 'x', BACK, -1)
    wainscot_run(M, 'wsc_back_m', WIN['x1'], BREAST['x0'], 'x', BACK, -1)
    wainscot_run(M, 'wsc_back_r', BREAST['x1'], X1, 'x', BACK, -1)
    wainscot_run(M, 'wsc_under_win', WIN['x0'], WIN['x1'], 'x', BACK, -1)
    wainscot_run(M, 'wsc_left', Y0, BACK, 'y', X0, 1)
    wainscot_run(M, 'wsc_right', Y0, BACK, 'y', X1, -1)


def build_window(M):
    """A tall sash window: the reveal, a painted frame, two sashes with glazing bars, old glass, a deep sill."""
    C = 'Room'
    w = WIN
    cx, W, Hh = (w['x0'] + w['x1']) / 2, w['x1'] - w['x0'], w['z1'] - w['z0']
    fy = BACK + 0.17                       # the window sits back in the wall
    # architrave around the opening (room side)
    box('win_arch_l', 0.09, 0.03, Hh + 0.09, (w['x0'] - 0.045, BACK - 0.015, (w['z0'] + w['z1'] + 0.09) / 2), bevel=0.008, mat=M['trim'], c=C)
    box('win_arch_r', 0.09, 0.03, Hh + 0.09, (w['x1'] + 0.045, BACK - 0.015, (w['z0'] + w['z1'] + 0.09) / 2), bevel=0.008, mat=M['trim'], c=C)
    box('win_arch_t', W + 0.18, 0.03, 0.09, (cx, BACK - 0.015, w['z1'] + 0.045), bevel=0.008, mat=M['trim'], c=C)
    box('win_sill', W + 0.24, 0.26, 0.045, (cx, BACK + 0.02, w['z0'] - 0.0225), bevel=0.008, mat=M['trim'], c=C)
    box('win_apron', W + 0.1, 0.025, 0.08, (cx, BACK - 0.012, w['z0'] - 0.085), bevel=0.006, mat=M['trim'], c=C)
    # frame: jambs, head, sill board
    box('win_jamb_l', 0.06, 0.12, Hh, (w['x0'] + 0.03, fy, (w['z0'] + w['z1']) / 2), mat=M['trim'], c=C)
    box('win_jamb_r', 0.06, 0.12, Hh, (w['x1'] - 0.03, fy, (w['z0'] + w['z1']) / 2), mat=M['trim'], c=C)
    box('win_head', W, 0.12, 0.07, (cx, fy, w['z1'] - 0.035), mat=M['trim'], c=C)
    # two sashes, each 2 × 2 panes; the upper sits slightly further out
    iw = W - 0.12
    sh = (Hh - 0.07) / 2
    for k, (z0, dy) in enumerate(((w['z0'], -0.025), (w['z0'] + sh, 0.025))):
        sy = fy + dy
        zc = z0 + sh / 2
        r = 0.045
        box(f'sash{k}_b', iw, 0.04, r, (cx, sy, z0 + r / 2), bevel=0.004, mat=M['trim'], c=C)
        box(f'sash{k}_t', iw, 0.04, r, (cx, sy, z0 + sh - r / 2), bevel=0.004, mat=M['trim'], c=C)
        box(f'sash{k}_l', r, 0.04, sh, (cx - iw / 2 + r / 2, sy, zc), bevel=0.004, mat=M['trim'], c=C)
        box(f'sash{k}_r', r, 0.04, sh, (cx + iw / 2 - r / 2, sy, zc), bevel=0.004, mat=M['trim'], c=C)
        box(f'sash{k}_bar_v', 0.022, 0.035, sh, (cx, sy, zc), bevel=0.004, mat=M['trim'], c=C)
        box(f'sash{k}_bar_h', iw, 0.035, 0.022, (cx, sy, zc), bevel=0.004, mat=M['trim'], c=C)
        g = box(f'sash{k}_glass', iw - 0.02, 0.003, sh - 0.02, (cx, sy, zc), mat=M['window_glass'], c=C)
        g.visible_shadow = False


def build_fireplace(M):
    C = 'Room'
    b, o = BREAST, OPEN
    # chimney breast (painted, full height) with the brick surround in front of its lower part
    box('breast', b['x1'] - b['x0'], BACK - b['y0'], H, ((b['x0'] + b['x1']) / 2, (b['y0'] + BACK) / 2, H / 2), mat=M['wall'], c=C)
    # the breast is solid; cut the firebox out of it with a boolean
    cut = box('firebox_cut', o['x1'] - o['x0'], 1.0, o['z1'] - o['z0'], ((o['x0'] + o['x1']) / 2, b['y0'] + 0.3, (o['z0'] + o['z1']) / 2), c=C)
    cut.display_type = 'WIRE'
    cut.hide_render = True
    br = bpy.data.objects['breast']
    m = br.modifiers.new('firebox', 'BOOLEAN')
    m.object = cut
    m.solver = 'EXACT'
    fy = b['y0'] - 0.04                       # brick face sits 4 cm proud of the breast
    sx0, sx1 = o['x0'] - 0.42, o['x1'] + 0.42
    zt = MANTEL_Z - 0.07
    box('brick_l', o['x0'] - sx0, 0.08, zt, ((sx0 + o['x0']) / 2, b['y0'], zt / 2), bevel=0.004, mat=M['brick'], c=C)
    box('brick_r', sx1 - o['x1'], 0.08, zt, ((o['x1'] + sx1) / 2, b['y0'], zt / 2), bevel=0.004, mat=M['brick'], c=C)
    box('brick_lintel', o['x1'] - o['x0'], 0.08, zt - o['z1'], ((o['x0'] + o['x1']) / 2, b['y0'], (o['z1'] + zt) / 2), bevel=0.004, mat=M['brick'], c=C)
    # firebox interior: splayed sides, back, smoke shelf, floor of ash
    depth = FIREBOX_BACK - fy
    inner = 0.06
    box('fb_back', o['x1'] - o['x0'] - 2 * inner, 0.06, o['z1'] - o['z0'], ((o['x0'] + o['x1']) / 2, FIREBOX_BACK, (o['z0'] + o['z1']) / 2), mat=M['firebrick'], c=C)
    for side, x in (('l', o['x0']), ('r', o['x1'])):
        s = box(f'fb_side_{side}', 0.06, depth, o['z1'] - o['z0'], (x, (fy + FIREBOX_BACK) / 2, (o['z0'] + o['z1']) / 2), mat=M['firebrick'], c=C)
        s.rotation_euler.z = math.radians(10 if side == 'l' else -10)
        s.location.x += 0.05 if side == 'l' else -0.05
    box('fb_top', o['x1'] - o['x0'], depth, 0.06, ((o['x0'] + o['x1']) / 2, (fy + FIREBOX_BACK) / 2, o['z1'] + 0.03), mat=M['firebrick'], c=C)
    box('fb_floor', o['x1'] - o['x0'], depth, 0.02, ((o['x0'] + o['x1']) / 2, (fy + FIREBOX_BACK) / 2, o['z0'] - 0.005), mat=M['ash'], c=C)
    # mantel shelf with a moulded edge, on two corbels
    mw = sx1 - sx0 + 0.3
    box('mantel', mw, 0.24, 0.06, (FX, b['y0'] - 0.06, MANTEL_Z - 0.03), bevel=0.01, mat=M['mantel'], c=C)
    box('mantel_mould', mw - 0.06, 0.2, 0.035, (FX, b['y0'] - 0.04, MANTEL_Z - 0.075), bevel=0.012, mat=M['mantel'], c=C)
    for x in (sx0 + 0.07, sx1 - 0.07):
        box(f'corbel_{x:.2f}', 0.07, 0.11, 0.18, (x, b['y0'] - 0.075, MANTEL_Z - 0.18), bevel=0.012, mat=M['mantel'], c=C)
    h = HEARTH
    box('hearth', h['x1'] - h['x0'], b['y0'] - h['y0'] + 0.05, h['z'], ((h['x0'] + h['x1']) / 2, (h['y0'] + b['y0']) / 2, h['z'] / 2), bevel=0.006, mat=M['hearth'], c=C)
    # a picture above the mantel
    pic, parts = import_gltf('fancy_picture_frame_01', c=C)
    place(pic, (FX, b['y0'] - 0.012, 1.82), 0, 1.25)


def build(M):
    build_shell(M)
    build_wainscot(M)
    build_window(M)
    build_fireplace(M)
