"""Act IV, "The Delivery" (frames 457–600).

08 Return (457–528): three knocks. The jack-o'-lantern starts and turns towards the door; the ghost floats in from behind
   the armchair with the tall wrapped package floating beside it and sets it down; the pumpkin hops over to it.
09 The reveal (529–600): the twine floats off, the lid lifts, the walls fall open: the lantern from the beginning stands
   there, glowing. The pumpkin's candle flares; it hops back to the laptop and presses "I got it: release payment":
   Paid to merchant.
"""
import bpy, math
from mathutils import Vector
import direct as D
import animate, cast, story_props as SP, act2
import timeline as T

E = T.EV
PKG = Vector((0.95, 0.86))              # where the package is set down (on the floor between the laptop and the chair)
NEAR_PKG = Vector((0.66, 0.80))         # where the pumpkin stands to watch it open
GHOST_FROM = Vector((2.6, 1.05))        # off right, behind the armchair from the room's side
GHOST_AT = Vector((1.25, 0.97))         # beside the package
CARRY = Vector((0.26, 0.06))            # the package floats along behind the ghost (it leads in), a little off the floor


def build(S, C):
    hero, gh, L, P, lan = C['hero'], C['ghost'], C['laptop'], C['package'], S['lantern']
    sc = bpy.context.scene
    groot, gbody = gh['root'], gh['body']
    z0 = gbody.location.z
    # the lantern leaves its books after Act I; it comes back in the package
    cast.show(lan['root'], False, 145)
    sc.frame_set(456)
    root, body = hero['root'], hero['body']
    D.hold(root, 457)
    D.hold(body, 457)

    # ---- 08: knock, startle, turn
    D.key(body, 'rotation_euler', E['startle'] - 1, 0.0, 0)
    D.key(body, 'rotation_euler', E['startle'] + 2, math.radians(-8), 0)
    D.key(body, 'rotation_euler', E['startle'] + 9, 0.0, 0)
    ld = hero['candle_light'].data
    for df, e in ((-1, 3.5), (2, 1.6), (6, 2.6), (12, 4.5)):                 # the flame gutters, then steadies bright
        ld.energy = e
        ld.keyframe_insert('energy', frame=E['startle'] + df)
    to_door = D.heading(Vector((1, 0)))
    D.turn(hero, *E['turn_door'], root.rotation_euler.z, to_door)

    # the ghost floats in, the package beside it
    pr = P['root']
    travel = D.heading(GHOST_AT - GHOST_FROM)
    groot.rotation_euler = (0, 0, travel)
    D.key(groot, 'location', 457, (GHOST_FROM.x, GHOST_FROM.y, 0.0))
    D.key(groot, 'rotation_euler', 457, travel, 2)
    D.key(gbody, 'location', 457, z0, 2)
    D.key(gbody, 'scale', 457, (1, 1, 1))
    D.key(gbody, 'rotation_euler', 457, 0.0, 0)
    D.key(gbody, 'rotation_euler', 457, 0.0, 1)
    a, b = E['enter']
    D.key(groot, 'location', a, (GHOST_FROM.x, GHOST_FROM.y, 0.0))
    D.key(groot, 'location', b, (GHOST_AT.x, GHOST_AT.y, 0.0))
    cast.show(pr, True, 457)
    for f in range(a, b + 1, 2):
        t = (f - a) / (b - a)
        t = t * t * (3 - 2 * t)
        g = GHOST_FROM.lerp(GHOST_AT, t)
        bob = 0.006 * math.sin(f * 0.45)
        D.key(pr, 'location', f, (g.x + CARRY.x, g.y + CARRY.y, 0.05 + bob))
        D.key(gbody, 'location', f, z0 + bob, 2)
    D.key(pr, 'rotation_euler', a, math.radians(-8), 2)
    D.key(pr, 'rotation_euler', b, math.radians(4), 2)
    c, d = E['set_down']
    D.key(pr, 'location', c, (GHOST_AT.x + CARRY.x, GHOST_AT.y + CARRY.y, 0.05))
    D.key(pr, 'location', d, (PKG.x, PKG.y, 0.0))
    D.key(pr, 'rotation_euler', d, 0.0, 2)
    D.key(groot, 'location', d + 4, (GHOST_AT.x + 0.03, GHOST_AT.y + 0.02, 0.0))          # it eases back a little
    D.key(groot, 'rotation_euler', d + 4, D.heading(PKG - GHOST_AT) + math.radians(-30), 2)
    # the pumpkin hops over to it
    near_h = D.heading(PKG - NEAR_PKG)
    D.hop(hero, *E['hop_pkg'], act2.AT_LAPTOP, NEAR_PKG, side=1)
    D.turn(hero, E['hop_pkg'][1], E['hop_pkg'][1] + 5, D.heading(NEAR_PKG - act2.AT_LAPTOP), near_h)
    D.cut('s08', 457, [(457, (0.18, 0.08, 0.40), (0.95, 0.88, 0.18), 30),
                       (528, (0.24, 0.16, 0.36), (0.92, 0.86, 0.17), 32)], fstop=4.0)

    # ---- 09: the reveal
    D.key(gbody, 'rotation_euler', E['twine'][0] - 2, 0.0, 0)
    D.key(gbody, 'rotation_euler', E['twine'][0] + 6, math.radians(10), 0)                   # leans in over it
    D.key(gbody, 'rotation_euler', E['walls'][0], math.radians(-4), 0)                       # and back, a showman
    tw = P['twine']
    a, b = E['twine']
    for ob, frames in ((tw, E['twine']),):
        D.key(ob, 'location', a, (0, 0, 0))
        D.key(ob, 'rotation_euler', a, 0.0, 2)
        D.key(ob, 'scale', a, (1, 1, 1))
        D.key(ob, 'location', b, (0.10, 0.04, 0.32))
        D.key(ob, 'rotation_euler', b, math.radians(70), 2)
        D.key(ob, 'scale', b, (0.7, 0.7, 0.7))
    cast.show(tw, False, b + 1)
    lid = P['lid']
    a, b = E['lid']
    lz = lid.location.z
    D.key(lid, 'location', a, (0, 0, lz))
    D.key(lid, 'rotation_euler', a, 0.0, 1)
    D.key(lid, 'location', b, (0.16, 0.06, lz + 0.22))
    D.key(lid, 'rotation_euler', b, math.radians(25), 1)
    cast.show(lid, False, b + 1)
    a, b = E['walls']
    for side, (hg, axis, ang) in P['walls'].items():
        lag = {'front': 0, 'right': 1, 'left': 2, 'back': 3}[side]
        D.key(hg, 'rotation_euler', a + lag, 0.0, axis)
        D.key(hg, 'rotation_euler', b + lag - 2, ang * 1.04, axis)
        D.key(hg, 'rotation_euler', b + lag + 1, ang, axis)
    # the lantern: inside, then revealed, its glow swelling
    lr = lan['root']
    D.key(lr, 'location', 457, (PKG.x, PKG.y, 0.006))
    D.key(lr, 'rotation_euler', 457, math.radians(20), 2)
    cast.show(lr, True, E['walls'][0] - 2)
    a, b = E['glow']
    glass = lan['glass'].node_tree
    frieze = lan['frieze'].node_tree
    for f, g, z, e in ((a - 8, 0.05, 1.0, 0.1), (a, 0.12, 2.5, 0.5), (b, 0.5, 8.5, 2.4), (600, 0.42, 7.0, 2.0)):
        D.value_key(glass, 'glow', f, g)
        D.value_key(frieze, 'glow', f, z)
        lan['glow'].data.energy = e
        lan['glow'].data.keyframe_insert('energy', frame=f)
    # the pumpkin: joy (a flare and a little hop on the spot), then back to the laptop to confirm
    a, b = E['joy']
    D.flare(hero, a, peak=7.0, rest=4.5, length=10)
    D.hop(hero, a + 2, b, NEAR_PKG, NEAR_PKG, h=near_h, height=0.03)
    D.hop(hero, *E['hop_back'], NEAR_PKG, act2.AT_LAPTOP, side=-1)
    face_laptop = D.heading(Vector((0, 1)))
    D.turn(hero, E['hop_back'][1], E['hop_back'][1] + 5, D.heading(act2.AT_LAPTOP - NEAR_PKG), face_laptop)
    D.tap(hero, E['confirm'], depth=18)
    SP.set_screen(L, 'released', E['confirm'] + 1)
    D.flare(hero, E['confirm'] + 1, peak=6.5, rest=5.0)
    animate.keep_on_floor(hero, 457, 600)
    D.cut('s09a', 529, [(529, (0.42, 0.22, 0.40), (0.98, 0.88, 0.30), 30),
                        (560, (0.47, 0.30, 0.34), (0.96, 0.87, 0.22), 34)], fstop=3.5)
    D.cut('s09b', 561, [(561, (1.02, 0.66, 0.22), (0.68, 0.80, 0.11), 34),
                        (580, (1.03, 0.67, 0.23), (0.62, 0.79, 0.11), 32)], fstop=3.2)
    c, n = D.screen_center(L, 'released')
    D.cut('s09c', 581, [(581, tuple(c + n * 0.40 + Vector((-0.10, 0, 0.03))), tuple(c), 50),
                        (600, tuple(c + n * 0.35 + Vector((-0.08, 0, 0.025))), tuple(c), 50)], fstop=3.5)
