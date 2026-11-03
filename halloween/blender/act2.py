"""Act II, "The Little Trickster" (frames 145–600).

04a To the laptop (145–216): the jack-o'-lantern turns from the lantern and hops to the laptop open on the floor; over its
    shoulder, the shop page.
04b The checkout (217–396): one long, square-on look at the screen from just above the pumpkin. The shop (until tap1),
    the Held checkout with its protection text (until tap2), then "Payment held". Each page stays 2–3 s.
05a The rise (397–440): behind the armchair, the ghost rises and peeks out into the room.
05b The phone (441–488): its phone floats up before its face (the merchant's Held dashboard).
05c Held for buyers (489–560): close on the phone: $48.00 held for buyers; it taps "Try to pay yourself early".
05d Glee (561–600): it wriggles with glee and turns to slip away in smoke.
"""
import bpy, math
from mathutils import Vector
import direct as D
import animate, cast, story_props as SP
import timeline as T

E = T.EV
LAPTOP = Vector((0.45, 1.00))          # on the floor before the hearth, screen towards -Y
AT_LAPTOP = Vector((0.45, 0.74))       # where the pumpkin stands to use it
GHOST = Vector((1.40, 0.80))           # behind the armchair (the chair spans x 0.83–1.89, y -0.42–0.59, 1.07 m tall)
PEEK_Z = 0.80                          # the ghost's root height when its head shows over the chair back
ROOM = Vector((0.60, 0.20))            # where the ghost looks while it peeks: out into the room, three-quarters to camera
PHONE_AT = (0.03, -0.24, -0.15)        # the phone, in the ghost's root space relative to its head: low, at its
                                       # chest, so its face stays clear; it looks down to read it
PHONE_TILT = math.radians(28)          # tipped back towards its eyes


def build(S, C):
    hero, gh, L, F = C['hero'], C['ghost'], C['laptop'], C['phone']
    sc = bpy.context.scene
    # ---- 04: the purchase
    lap = L['root']
    lap.location = (LAPTOP.x, LAPTOP.y, 0.0)
    lap.rotation_euler = (0, 0, 0)
    cast.show(lap, True, 145)
    SP.set_screen(L, 'shop', 145)
    SP.set_screen(L, 'checkout', E['tap1'] + 1)
    SP.set_screen(L, 'held', E['tap2'] + 1)
    root, body = hero['root'], hero['body']
    start = animate.WALK_TO
    sc.frame_set(144)                              # continue from where Act I leaves it
    D.hold(root, 145)
    D.hold(body, 145)
    via = start.lerp(AT_LAPTOP, 0.5)
    face_laptop = D.heading(Vector((0, 1)))
    D.turn(hero, *E['turn'], root.rotation_euler.z, D.heading(via - start))
    D.hop(hero, *E['hops'][0], start, via, side=1)
    D.hop(hero, *E['hops'][1], via, AT_LAPTOP, side=-1)
    D.turn(hero, E['hops'][1][1], E['hops'][1][1] + 6, D.heading(AT_LAPTOP - via), face_laptop)
    D.tap(hero, E['tap1'])
    D.tap(hero, E['tap2'], depth=18)
    D.flare(hero, E['tap2'] + 1)
    D.key(root, 'location', 600, (AT_LAPTOP.x, AT_LAPTOP.y, 0))
    D.key(root, 'rotation_euler', 600, face_laptop, 2)
    animate.keep_on_floor(hero, 145, 600)
    scr = L['screens']['shop']
    pos, c = D.screen_view(scr, 0.50, up=0.12)
    # over the shoulder: behind and left of the pumpkin, high enough to see the screen over it
    D.cut('s04a_to_laptop', 145, [(145, (0.06, 0.30, 0.36), tuple(Vector(c) + Vector((-0.06, 0, -0.02))), 38),
                                  (216, (0.14, 0.42, 0.34), tuple(Vector(c) + Vector((-0.02, 0, -0.01))), 44)], fstop=2.8)
    # the screen, square on, from just above the pumpkin's stem: a slow push over 7.5 s
    pos2, _ = D.screen_view(scr, 0.42, up=0.10)
    D.cut('s04b_checkout', 217, [(217, pos, c, 50), (396, pos2, c, 50)], fstop=4.0)

    # ---- 05: the ghost, and its phone
    groot, gbody = gh['root'], gh['body']
    look = D.heading(ROOM - GHOST)
    groot.location = (GHOST.x, GHOST.y, 0.0)
    groot.rotation_euler = (0, 0, look)
    D.hold(groot, 397)
    cast.show(groot, True, 397)
    z0 = gbody.location.z
    a, b = E['rise']
    D.key(groot, 'location', a, (GHOST.x, GHOST.y, 0.0))
    D.key(groot, 'location', b, (GHOST.x, GHOST.y, PEEK_Z + 0.012))
    D.key(groot, 'location', b + 5, (GHOST.x, GHOST.y, PEEK_Z))
    for f in range(b + 5, 601, 12):                                          # a breathing float
        D.key(gbody, 'location', f, z0 + 0.006 * math.sin(f * 0.5), 2)
    # the phone floats up from below into reading position, its screen towards the ghost
    ph = F['root']
    cast.show(ph, True, E['phone_up'][0])
    SP.set_screen(F, 'phone_held', E['phone_up'][0])
    SP.set_screen(F, 'phone_busy', E['tap_early'] + 1)
    hx, hy, hz = PHONE_AT
    ph.rotation_euler = (PHONE_TILT, 0, math.pi)
    D.key(ph, 'rotation_euler', E['phone_up'][0], (PHONE_TILT, 0, math.pi))
    D.key(ph, 'location', E['phone_up'][0], (hx, hy, z0 + hz - 0.28))
    D.key(ph, 'location', E['phone_up'][1], (hx, hy, z0 + hz + 0.01))
    D.key(ph, 'location', E['phone_up'][1] + 6, (hx, hy, z0 + hz))
    # the ghost leans in to read; the tap: the phone dips as if pressed
    D.key(gbody, 'rotation_euler', E['phone_up'][1], 0.0, 0)
    D.key(gbody, 'rotation_euler', E['phone_up'][1] + 10, math.radians(7), 0)
    t = E['tap_early']
    D.key(ph, 'location', t - 3, (hx, hy, z0 + hz))
    D.key(ph, 'location', t, (hx, hy + 0.012, z0 + hz - 0.006))
    D.key(ph, 'location', t + 5, (hx, hy, z0 + hz))
    # glee: a puff and quick wriggles; then it turns to slip away and starts to dissolve
    a, b = E['glee']
    D.key(gbody, 'rotation_euler', a, math.radians(7), 0)
    D.key(gbody, 'rotation_euler', a + 4, math.radians(-3), 0)
    D.key(gbody, 'scale', a, (1, 1, 1))
    D.key(gbody, 'scale', a + 4, (1.05, 1.05, 1.03))
    for i, f in enumerate(range(a + 2, b, 4)):
        D.key(gbody, 'rotation_euler', f, math.radians(9 if i % 2 else -9), 1)
    D.key(gbody, 'rotation_euler', b, 0.0, 1)
    D.key(gbody, 'scale', b, (1, 1, 1))
    lv = E['leave']
    away = look + math.radians(150)
    D.key(groot, 'rotation_euler', lv, look, 2)
    D.key(groot, 'rotation_euler', lv + 12, away, 2)
    import ghost
    wisps = ghost.smoke(S['M'], gh)
    lin = bpy.data.materials['linen'].node_tree
    sm = bpy.data.materials['ghost_smoke'].node_tree
    D.value_key(lin, 'dissolve', lv + 4, 0.0)
    D.value_key(lin, 'dissolve', 600, 0.30)
    D.value_key(sm, 'amount', lv, 0.0)
    D.value_key(sm, 'amount', 600, 0.8)
    D.key(gh['void'], 'scale', lv, (1, 1, 1))
    for w in wisps:
        D.key(w, 'scale', lv, (0.4, 0.4, 0.4))
        D.key(w, 'scale', 600, (1.2, 1.2, 1.2))
        z = w.location.z
        D.key(w, 'location', lv, z, 2)
        D.key(w, 'location', 600, z + 0.08, 2)
    # cameras
    head = Vector((GHOST.x, GHOST.y, PEEK_Z + z0))
    D.cut('s05a_rise', 397, [(397, (0.50, -1.30, 0.72), (1.40, 0.62, 0.98), 34),
                             (440, (0.56, -1.20, 0.78), (1.40, 0.66, 1.04), 36)], fstop=4.0)
    D.cut('s05b_phone_up', 441, [(441, (1.06, -0.72, 1.20), tuple(head + Vector((0, 0, -0.05))), 55),
                                 (488, (1.08, -0.66, 1.19), tuple(head + Vector((0, 0, -0.06))), 60)], fstop=2.8)
    sc.frame_set(500)
    scr = F['screens']['phone_held']
    p0, pc = D.screen_view(scr, 0.36, turn_deg=-24, up=0.04, aim_up=0.035)
    p1, _ = D.screen_view(scr, 0.32, turn_deg=-22, up=0.04, aim_up=0.035)
    cam = D.cut('s05c_phone_held', 489, [(489, p0, pc, 50), (560, p1, pc, 50)], fstop=4.0)
    cam.data.clip_start = 0.29          # the ghost's own cloth sits between this camera and the phone: clip it away
    D.cut('s05d_glee', 561, [(561, (1.06, -0.72, 1.20), tuple(head + Vector((0, 0, -0.05))), 55),
                             (600, (1.09, -0.64, 1.19), tuple(head + Vector((0, 0, -0.06))), 62)], fstop=2.8)
    for w in wisps:
        con = w.constraints.new('TRACK_TO')
        con.target = bpy.data.objects['cam_s05d_glee']
        con.track_axis = 'TRACK_NEGATIVE_Y'
        con.up_axis = 'UP_Z'
    return dict(wisps=wisps)
