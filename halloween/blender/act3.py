"""Act III, "The Held Surprise" (frames 601–840).

06a Vanish (601–640): the ghost dissolves into smoke, its phone hanging in the air before it.
06b Refused (641–712): close on the phone: "Refused. Only the buyer can pay the merchant before the protection window
    ends." Held's three notes.
06c Snap (713–752): the smoke snaps back; the ghost is whole again, jolted: there is nothing to run away with.
07  Realization (753–840): it slumps (it will be paid only when the buyer confirms delivery), draws itself up with
    reluctant resolve, and floats off to fetch the lantern; the phone goes with it and is put away.
"""
import bpy, math
from mathutils import Vector
import direct as D
import act2, cast, story_props as SP
import timeline as T

E = T.EV


def build(S, C, A2):
    gh, F = C['ghost'], C['phone']
    groot, gbody = gh['root'], gh['body']
    lin = bpy.data.materials['linen'].node_tree
    sm = bpy.data.materials['ghost_smoke'].node_tree
    z0 = gbody.location.z
    sc = bpy.context.scene
    sc.frame_set(600)
    a, b = E['attempt']
    snap = E['snap']
    # ---- 06: it keeps dissolving, the phone refuses, it snaps back whole
    D.value_key(lin, 'dissolve', b, 0.62)
    D.value_key(sm, 'amount', b, 1.0)
    D.value_key(lin, 'dissolve', snap, 0.62)
    D.value_key(lin, 'dissolve', snap + 5, 0.0)
    D.value_key(sm, 'amount', snap, 1.0)
    D.value_key(sm, 'amount', snap + 6, 0.0)
    vd = gh['void']
    D.key(vd, 'scale', a + 8, (1, 1, 1))
    D.key(vd, 'scale', b - 4, (0.0, 0.0, 0.0))
    D.key(vd, 'scale', snap, (0.0, 0.0, 0.0))
    D.key(vd, 'scale', snap + 4, (1, 1, 1))
    for w in A2['wisps']:
        D.key(w, 'scale', b, (1.6, 1.6, 1.6))
        D.key(w, 'scale', snap, (1.6, 1.6, 1.6))
        D.key(w, 'scale', snap + 6, (0.2, 0.2, 0.2))
    SP.set_screen(F, 'phone_refused', E['refused'])
    # the phone: it stays where it was left, then jolts as the refusal lands
    ph = F['root']
    hx, hy, hz = act2.PHONE_AT
    rest = (hx, hy, z0 + hz)
    D.key(ph, 'location', E['refused'] - 1, rest)
    D.key(ph, 'location', E['refused'] + 2, (hx, hy, z0 + hz + 0.01))
    D.key(ph, 'location', E['refused'] + 6, rest)
    # the jolt: a jump up, a stretch, spun back round to face the room (and the phone)
    look = D.heading(act2.ROOM - act2.GHOST)
    D.key(groot, 'rotation_euler', snap, groot.rotation_euler.z, 2)
    D.key(groot, 'rotation_euler', snap + 4, look, 2)
    D.key(gbody, 'location', snap, z0, 2)
    D.key(gbody, 'location', snap + 3, z0 + 0.035, 2)
    D.key(gbody, 'location', snap + 12, z0 + 0.01, 2)
    D.key(gbody, 'scale', snap, (1, 1, 1))
    D.key(gbody, 'scale', snap + 3, (0.94, 0.94, 1.1))
    D.key(gbody, 'scale', snap + 10, (1, 1, 1))
    D.key(gbody, 'rotation_euler', snap, 0.0, 0)
    D.key(gbody, 'rotation_euler', snap + 3, math.radians(-8), 0)
    D.key(gbody, 'rotation_euler', snap + 14, math.radians(-3), 0)
    head = Vector((act2.GHOST.x, act2.GHOST.y, act2.PEEK_Z + z0))
    D.cut('s06a_vanish', a, [(a, (1.10, -0.60, 1.16), tuple(head + Vector((0, 0, -0.06))), 50),
                             (b, (1.12, -0.52, 1.15), tuple(head + Vector((0, 0, -0.06))), 58)], fstop=2.4)
    sc.frame_set(E['refused'] + 10)
    scr = F['screens']['phone_refused']
    p0, pc = D.screen_view(scr, 0.36, turn_deg=-24, up=0.04, aim_up=0.035)
    p1, _ = D.screen_view(scr, 0.30, turn_deg=-22, up=0.04, aim_up=0.035)
    cam = D.cut('s06b_refused', E['refused'], [(E['refused'], p0, pc, 50), (712, p1, pc, 50)], fstop=4.0)
    cam.data.clip_start = 0.27          # clip away the ghost's cloth between the camera and the phone
    D.cut('s06c_snap', snap, [(snap, (1.02, -0.78, 1.08), tuple(head + Vector((0, 0, -0.03))), 46),
                              (752, (1.04, -0.74, 1.09), tuple(head + Vector((0, 0, -0.03))), 48)], fstop=2.4)

    # ---- 07: the realization
    a, b = E['sag']
    D.key(gbody, 'location', a, z0 + 0.01, 2)
    D.key(gbody, 'location', b, z0 - 0.03, 2)                          # it sinks
    D.key(gbody, 'scale', a, (1, 1, 1))
    D.key(gbody, 'scale', b, (1.04, 1.04, 0.92))                       # slumps
    D.key(gbody, 'rotation_euler', a, math.radians(-3), 0)
    D.key(gbody, 'rotation_euler', b, math.radians(10), 0)             # head drops forward, over the phone
    c, d = E['resolve']
    D.key(gbody, 'rotation_euler', c, math.radians(10), 0)
    D.key(gbody, 'location', c, z0 - 0.03, 2)
    D.key(gbody, 'scale', c, (1.04, 1.04, 0.92))
    D.key(gbody, 'location', d, z0 + 0.01, 2)                          # draws itself up
    D.key(gbody, 'scale', d, (0.98, 0.98, 1.04))
    D.key(gbody, 'rotation_euler', d, math.radians(-2), 0)
    D.key(gbody, 'scale', d + 6, (1, 1, 1))
    # it puts the phone away (down out of sight), turns towards the door and goes
    D.key(ph, 'location', d, rest)
    D.key(ph, 'location', d + 10, (hx, hy, z0 + hz - 0.30))
    cast.show(ph, False, d + 11)
    e, f = E['turn_go']
    door = look - math.radians(200)
    D.key(groot, 'rotation_euler', e, look, 2)
    D.key(groot, 'rotation_euler', f, door, 2)
    D.key(groot, 'location', e, (act2.GHOST.x, act2.GHOST.y, act2.PEEK_Z), -1)
    D.key(groot, 'location', 840, (act2.GHOST.x + 0.8, act2.GHOST.y - 0.25, act2.PEEK_Z - 0.25), -1)
    D.cut('s07_realization', 753, [(753, (1.08, -0.66, 1.18), tuple(head + Vector((0, 0, -0.05))), 55),
                                   (840, (1.12, -0.56, 1.16), tuple(head + Vector((0, 0, -0.07))), 66)], fstop=2.2)
