"""Act IV, "The Delivery" (frames 841–1152).

08  Return (841–936): three knocks. The jack-o'-lantern starts and turns towards the door; the ghost floats in from behind
    the armchair with the tall HELD-printed package floating along behind it and sets it down; the pumpkin hops over.
09a Unwrap (937–990): the twine floats off; the whole cover lifts off: the lantern from the beginning stands there, glowing.
09b Joy (991–1012): the pumpkin turns to us, its candle flaring, a little hop on the spot.
09c Confirm (1013–1104): back at the laptop, square on: "I got it: release payment" → "Paid to merchant" (2.5 s).
09d Paid (1105–1152): the ghost's phone: "Delivery confirmed. You have been paid."
"""
import bpy, math
from mathutils import Vector
import direct as D
import animate, cast, story_props as SP, act2
import timeline as T

E = T.EV
PKG = Vector((0.95, 0.86))              # where the package is set down (on the floor between the laptop and the chair)
NEAR_PKG = Vector((0.68, 0.60))         # where the pumpkin watches it open (clear of the package and the laptop)
GHOST_FROM = Vector((2.6, 1.05))        # off right, behind the armchair from the room's side
GHOST_AT = Vector((1.28, 0.98))         # beside the package, 35 cm from the lantern's centre (it must never touch it)
CARRY = Vector((0.26, 0.06))            # the package floats along behind the ghost (it leads in), a little off the floor
JOY_CAM = (0.30, 0.20, 0.24)            # the joy close-up's camera: the pumpkin turns to face it


def build(S, C):
    hero, gh, L, P, lan, F = C['hero'], C['ghost'], C['laptop'], C['package'], S['lantern'], C['phone']
    sc = bpy.context.scene
    groot, gbody = gh['root'], gh['body']
    z0 = gbody.location.z
    # the lantern leaves its books after Act I; it comes back in the package
    cast.show(lan['root'], False, 145)
    sc.frame_set(840)
    root, body = hero['root'], hero['body']
    D.hold(root, 841)
    D.hold(body, 841)

    # ---- 08: knock, startle, turn
    s = E['startle']
    D.key(body, 'rotation_euler', s - 1, 0.0, 0)
    D.key(body, 'rotation_euler', s + 2, math.radians(-8), 0)
    D.key(body, 'rotation_euler', s + 9, 0.0, 0)
    ld = hero['candle_light'].data
    for df, e in ((-1, 3.5), (2, 1.6), (6, 2.6), (12, 4.5)):               # the flame gutters, then steadies bright
        ld.energy = e
        ld.keyframe_insert('energy', frame=s + df)
    D.turn(hero, *E['turn_door'], root.rotation_euler.z, D.heading(Vector((1, 0))))

    # the ghost floats in, the package behind it
    pr = P['root']
    travel = D.heading(GHOST_AT - GHOST_FROM)
    D.key(groot, 'location', 841, (GHOST_FROM.x, GHOST_FROM.y, 0.0))
    D.key(groot, 'rotation_euler', 841, travel, 2)
    D.key(gbody, 'location', 841, z0, 2)
    D.key(gbody, 'scale', 841, (1, 1, 1))
    D.key(gbody, 'rotation_euler', 841, 0.0, 0)
    D.key(gbody, 'rotation_euler', 841, 0.0, 1)
    a, b = E['enter']
    D.key(groot, 'location', a, (GHOST_FROM.x, GHOST_FROM.y, 0.0))
    D.key(groot, 'location', b, (GHOST_AT.x, GHOST_AT.y, 0.0))
    cast.show(pr, True, 841)
    for f in range(a, b + 1, 2):
        t = (f - a) / (b - a)
        t = t * t * (3 - 2 * t)
        g = GHOST_FROM.lerp(GHOST_AT, t)
        bob = 0.006 * math.sin(f * 0.45)
        D.key(pr, 'location', f, (g.x + CARRY.x, g.y + CARRY.y, 0.05 + bob))
        D.key(gbody, 'location', f, z0 + bob, 2)
    D.key(pr, 'location', 841, (GHOST_FROM.x + CARRY.x, GHOST_FROM.y + CARRY.y, 0.05))
    D.key(pr, 'rotation_euler', a, math.radians(-8), 2)
    D.key(pr, 'rotation_euler', b, math.radians(4), 2)
    c, d = E['set_down']
    D.key(pr, 'location', c, (GHOST_AT.x + CARRY.x, GHOST_AT.y + CARRY.y, 0.05))
    D.key(pr, 'location', d, (PKG.x, PKG.y, 0.0))
    D.key(pr, 'rotation_euler', d, 0.0, 2)
    rest_h = D.heading(PKG - GHOST_AT) + math.radians(-30)
    D.key(groot, 'location', d + 4, (GHOST_AT.x + 0.03, GHOST_AT.y + 0.02, 0.0))          # it eases back a little
    D.key(groot, 'rotation_euler', d + 4, rest_h, 2)
    # the pumpkin hops over to watch
    watch = D.heading(PKG - NEAR_PKG)
    D.hop(hero, *E['hop_pkg'], act2.AT_LAPTOP, NEAR_PKG, side=1)
    D.turn(hero, E['hop_pkg'][1], E['hop_pkg'][1] + 5, D.heading(NEAR_PKG - act2.AT_LAPTOP), watch)
    D.cut('s08_return', 841, [(841, (0.18, 0.08, 0.40), (0.95, 0.88, 0.18), 30),
                              (936, (0.26, 0.18, 0.36), (0.92, 0.86, 0.17), 32)], fstop=4.0)

    # ---- 09a: unwrap
    D.key(gbody, 'rotation_euler', E['twine'][0] - 2, 0.0, 0)
    D.key(gbody, 'rotation_euler', E['twine'][0] + 6, math.radians(10), 0)                 # leans in over it
    D.key(gbody, 'rotation_euler', E['cover'][1], math.radians(-4), 0)                     # and back, a showman
    tw = P['twine']
    a, b = E['twine']
    D.key(tw, 'location', a, (0, 0, 0))
    D.key(tw, 'rotation_euler', a, 0.0, 2)
    D.key(tw, 'scale', a, (1, 1, 1))
    D.key(tw, 'location', b, (0.10, 0.04, 0.55))
    D.key(tw, 'rotation_euler', b, math.radians(70), 2)
    D.key(tw, 'scale', b, (0.7, 0.7, 0.7))
    cast.show(tw, False, b + 1)
    cv = P['cover']
    a, b = E['cover']
    D.key(cv, 'location', a, (0, 0, 0))
    D.key(cv, 'rotation_euler', a, 0.0, 1)
    D.key(cv, 'location', a + 4, (0, 0, 0.02))                                             # it lifts, slowly at first
    D.key(cv, 'location', b, (0.22, 0.10, 0.62))
    D.key(cv, 'rotation_euler', b, math.radians(22), 1)
    cast.show(cv, False, b + 1)
    # the lantern: inside all along, glowing up as it's revealed
    lr = lan['root']
    D.key(lr, 'location', 841, (PKG.x, PKG.y, 0.006))
    D.key(lr, 'rotation_euler', 841, math.radians(20), 2)
    cast.show(lr, True, E['cover'][0])
    a, b = E['glow']
    glass = lan['glass'].node_tree
    frieze = lan['frieze'].node_tree
    for f, g, z, e in ((a - 10, 0.05, 1.0, 0.1), (a, 0.12, 2.5, 0.5), (b, 0.5, 8.5, 2.4), (1152, 0.42, 7.0, 2.0)):
        D.value_key(glass, 'glow', f, g)
        D.value_key(frieze, 'glow', f, z)
        lan['glow'].data.energy = e
        lan['glow'].data.keyframe_insert('energy', frame=f)
    D.cut('s09a_unwrap', 937, [(937, (0.42, 0.22, 0.46), (0.98, 0.88, 0.34), 30),
                               (990, (0.47, 0.30, 0.38), (0.96, 0.87, 0.22), 34)], fstop=3.5)

    # ---- 09b: joy, to camera; then back to the laptop
    a, b = E['joy']
    to_cam = D.heading(Vector(JOY_CAM[:2]) - NEAR_PKG)
    D.turn(hero, a - 4, a + 4, watch, to_cam)
    D.flare(hero, a, peak=7.0, rest=4.5, length=10)
    D.hop(hero, a + 3, b, NEAR_PKG, NEAR_PKG, h=to_cam, height=0.03)
    D.hop(hero, *E['hop_back'], NEAR_PKG, act2.AT_LAPTOP, side=-1)
    face_laptop = D.heading(Vector((0, 1)))
    D.turn(hero, E['hop_back'][1], E['hop_back'][1] + 5, D.heading(act2.AT_LAPTOP - NEAR_PKG), face_laptop)
    D.cut('s09b_joy', 991, [(991, JOY_CAM, (0.68, 0.62, 0.10), 40),
                            (1012, (0.31, 0.22, 0.25), (0.66, 0.62, 0.10), 38)], fstop=3.2)

    # ---- 09c: confirm, square on to the screen
    D.tap(hero, E['confirm'], depth=18)
    SP.set_screen(L, 'released', E['confirm'] + 1)
    D.flare(hero, E['confirm'] + 1, peak=6.5, rest=5.0)
    scr = L['screens']['released']
    p0, c = D.screen_view(scr, 0.50, up=0.12)
    p1, _ = D.screen_view(scr, 0.44, up=0.10)
    D.cut('s09c_confirm', 1013, [(1013, p0, c, 50), (1104, p1, c, 50)], fstop=4.0)

    # ---- 09d: the ghost's phone: paid
    ph = F['root']
    hx, hy, hz = act2.PHONE_AT
    pf = E['phone_paid']
    cast.show(ph, True, pf - 6)
    SP.set_screen(F, 'phone_paid', pf - 6)
    D.key(ph, 'rotation_euler', pf - 6, (act2.PHONE_TILT, 0, math.pi))
    D.key(ph, 'location', pf - 6, (hx, hy, z0 + hz - 0.25))
    D.key(ph, 'location', pf + 4, (hx, hy, z0 + hz))
    D.key(gbody, 'scale', pf + 14, (1, 1, 1))
    D.key(gbody, 'scale', pf + 19, (1.05, 1.05, 1.03))                                     # a contented puff
    D.key(gbody, 'scale', pf + 28, (1, 1, 1))
    D.key(ph, 'location', 1146, (hx, hy, z0 + hz))
    D.key(ph, 'location', 1152, (hx, hy, z0 + hz - 0.25))
    cast.show(ph, False, 1153)
    animate.keep_on_floor(hero, 841, 1152)
    sc.frame_set(pf + 12)
    scr = F['screens']['phone_paid']
    p0, pc = D.screen_view(scr, 0.36, turn_deg=-24, up=0.04, aim_up=0.035)
    p1, _ = D.screen_view(scr, 0.31, turn_deg=-22, up=0.04, aim_up=0.035)
    cam = D.cut('s09d_phone_paid', pf, [(pf, p0, pc, 50), (1152, p1, pc, 50)], fstop=4.0)
    cam.data.clip_start = 0.28          # clip away the ghost's cloth between the camera and the phone
