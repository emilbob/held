"""Act II, "The Little Trickster" (frames 145–288).

04 The purchase (145–216): the laptop lies open on the floor before the hearth. The jack-o'-lantern turns from the
   lantern, hops to it, tips forward to press "Pay with Held" (the checkout opens), then "Pay": the screen shows the
   payment held. Over its shoulder, then close on the screen.
05 The trick (217–288): behind the armchair, the ghost rises and peeks over its back towards the laptop, wriggles with
   glee, turns away and begins to dissolve into smoke.
"""
import bpy, math
from mathutils import Vector
import direct as D
import animate, cast, story_props as SP
import timeline as T

LAPTOP = Vector((0.45, 1.00))          # on the floor before the hearth, screen towards -Y
AT_LAPTOP = Vector((0.45, 0.74))       # where the pumpkin stands to use it
GHOST = Vector((1.40, 0.80))           # behind the armchair (the chair spans x 0.83–1.89, y -0.42–0.59, 1.07 m tall)
PEEK_Z = 0.80                          # the ghost's root height when its head shows over the chair back
ROOM = Vector((0.60, 0.20))            # where the ghost looks while it peeks: out into the room, three-quarters to camera

# frames (timeline.EV: the sound uses the same beats)
TURN, HOPS, TAP1, TAP2 = T.EV['turn'], T.EV['hops'], T.EV['tap1'], T.EV['tap2']
RISE, GLEE, LEAVE = T.EV['rise'], T.EV['glee'], T.EV['leave']


def build(S, C):
    hero, gh, L = C['hero'], C['ghost'], C['laptop']
    # ---- 04: the purchase
    lap = L['root']
    lap.location = (LAPTOP.x, LAPTOP.y, 0.0)
    lap.rotation_euler = (0, 0, 0)
    cast.show(lap, True, 145)
    SP.set_screen(L, 'shop', 145)
    SP.set_screen(L, 'checkout', TAP1 + 1)
    SP.set_screen(L, 'held', TAP2 + 1)
    root, body = hero['root'], hero['body']
    start = animate.WALK_TO
    bpy.context.scene.frame_set(144)               # continue from where Act I leaves it
    D.hold(root, 145)
    D.hold(body, 145)
    h_end = root.rotation_euler.z
    via = start.lerp(AT_LAPTOP, 0.5)
    face_laptop = D.heading(Vector((0, 1)))
    D.turn(hero, *TURN, h_end, D.heading(via - start))
    D.hop(hero, HOPS[0][0], HOPS[0][1], start, via, side=1)
    D.hop(hero, HOPS[1][0], HOPS[1][1], via, AT_LAPTOP, side=-1)
    D.turn(hero, HOPS[1][1], HOPS[1][1] + 6, D.heading(AT_LAPTOP - via), face_laptop)
    D.tap(hero, TAP1)
    D.tap(hero, TAP2, depth=18)
    D.flare(hero, TAP2 + 1)
    D.key(root, 'location', 216, (AT_LAPTOP.x, AT_LAPTOP.y, 0))
    D.key(root, 'rotation_euler', 216, face_laptop, 2)
    animate.keep_on_floor(hero, 145, 288)
    c, n = D.screen_center(L, 'shop')
    # over the shoulder: low, behind and left of the pumpkin, the screen beyond it
    D.cut('s04a', 145, [(145, (0.04, 0.30, 0.36), tuple(c + Vector((-0.06, 0, -0.02))), 38),
                        (180, (0.12, 0.40, 0.32), tuple(c + Vector((-0.02, 0, -0.02))), 44)], fstop=2.8)
    # close on the screen, the pumpkin's glowing shoulder at the edge of frame
    D.cut('s04b', 188, [(188, tuple(c + n * 0.42 + Vector((-0.10, 0, 0.02))), tuple(c), 50),
                        (216, tuple(c + n * 0.36 + Vector((-0.08, 0, 0.015))), tuple(c), 50)], fstop=3.5)

    # ---- 05: the trick
    groot, gbody = gh['root'], gh['body']
    look = D.heading(ROOM - GHOST)
    away = look + math.radians(150)
    groot.location = (GHOST.x, GHOST.y, 0.0)
    groot.rotation_euler = (0, 0, look)
    D.hold(groot, 217)
    cast.show(groot, True, 217)
    z0 = gbody.location.z
    # it rises slowly behind the chair and stops with its eyes just over the back
    D.key(groot, 'location', RISE[0], (GHOST.x, GHOST.y, 0.0))
    D.key(groot, 'location', RISE[1], (GHOST.x, GHOST.y, PEEK_Z + 0.012))
    D.key(groot, 'location', RISE[1] + 5, (GHOST.x, GHOST.y, PEEK_Z))
    # a breathing float from here on
    for f in range(RISE[1] + 5, 289, 12):
        D.key(gbody, 'location', f, z0 + 0.006 * math.sin(f * 0.5), 2)
    # glee: a puff and two quick wriggles
    D.key(gbody, 'scale', GLEE[0], (1, 1, 1))
    D.key(gbody, 'scale', GLEE[0] + 4, (1.05, 1.05, 1.03))
    for i, f in enumerate(range(GLEE[0] + 2, GLEE[1], 4)):
        D.key(gbody, 'rotation_euler', f, math.radians(9 if i % 2 else -9), 1)
    D.key(gbody, 'rotation_euler', GLEE[1], 0.0, 1)
    D.key(gbody, 'scale', GLEE[1], (1, 1, 1))
    # it turns away and starts to go: sinking a little, dissolving from the hem up, smoke curling
    D.key(groot, 'rotation_euler', LEAVE, look, 2)
    D.key(groot, 'rotation_euler', LEAVE + 10, away, 2)
    import ghost
    wisps = ghost.smoke(S['M'], gh)
    lin = bpy.data.materials['linen'].node_tree
    sm = bpy.data.materials['ghost_smoke'].node_tree
    D.value_key(lin, 'dissolve', LEAVE + 4, 0.0)
    D.value_key(lin, 'dissolve', 288, 0.32)
    D.value_key(sm, 'amount', LEAVE, 0.0)
    D.value_key(sm, 'amount', 288, 0.8)
    vd = gh['void']
    D.key(vd, 'scale', LEAVE, (1, 1, 1))
    for i, w in enumerate(wisps):
        D.key(w, 'scale', LEAVE, (0.4, 0.4, 0.4))
        D.key(w, 'scale', 288, (1.2, 1.2, 1.2))
        z = w.location.z
        D.key(w, 'location', LEAVE, z, 2)
        D.key(w, 'location', 288, z + 0.08, 2)
    # the chair's back first, the ghost rising over it; then close on it
    D.cut('s05a', 217, [(217, (0.50, -1.30, 0.72), (1.40, 0.62, 0.98), 34),
                        (250, (0.56, -1.20, 0.78), (1.40, 0.66, 1.04), 36)], fstop=4.0)
    head = Vector((GHOST.x, GHOST.y, PEEK_Z + z0))
    D.cut('s05b', 251, [(251, (1.06, -0.72, 1.20), tuple(head + Vector((0, 0, -0.05))), 60),
                        (288, (1.09, -0.64, 1.19), tuple(head + Vector((0, 0, -0.06))), 66)], fstop=2.8)
    for w in wisps:
        con = w.constraints.new('TRACK_TO')
        con.target = bpy.data.objects['cam_s05b']
        con.track_axis = 'TRACK_NEGATIVE_Y'
        con.up_axis = 'UP_Z'
    return dict(wisps=wisps)
