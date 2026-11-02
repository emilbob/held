"""Act III, "The Held Surprise" (frames 289–456).

06 The attempt (289–360): close on the ghost, dissolving into smoke... cut to the laptop: the payment is held, the
   lime badge pulses... cut back: the smoke snaps back, the ghost is whole again, jolted.
07 The realization (361–456): close on the ghost: it sags (it can't take the money; it will only be paid once the
   buyer confirms delivery), then straightens with reluctant resolve and turns to go and fetch the lantern. Then the
   Held screen itself, clean and readable: payment held, the protection window, confirm or dispute.
"""
import bpy, math
from mathutils import Vector
import direct as D
import act2
import timeline as T

ATTEMPT, PULSE, SNAP = T.EV['attempt'], T.EV['pulse'], T.EV['snap']
SAG, RESOLVE, TURN_GO = T.EV['sag'], T.EV['resolve'], T.EV['turn_go']


def build(S, C, A2):
    gh, L = C['ghost'], C['laptop']
    groot, gbody = gh['root'], gh['body']
    lin = bpy.data.materials['linen'].node_tree
    sm = bpy.data.materials['ghost_smoke'].node_tree
    z0 = gbody.location.z
    bpy.context.scene.frame_set(288)
    # ---- 06: it keeps dissolving, then snaps back whole
    D.value_key(lin, 'dissolve', ATTEMPT[1], 0.62)
    D.value_key(sm, 'amount', ATTEMPT[1], 1.0)
    D.value_key(lin, 'dissolve', SNAP, 0.62)
    D.value_key(lin, 'dissolve', SNAP + 5, 0.0)
    D.value_key(sm, 'amount', SNAP, 1.0)
    D.value_key(sm, 'amount', SNAP + 6, 0.0)
    # the void inside shrinks away with the cloth, and comes back with it
    vd = gh['void']
    D.key(vd, 'scale', ATTEMPT[0] + 8, (1, 1, 1))
    D.key(vd, 'scale', ATTEMPT[1] - 4, (0.0, 0.0, 0.0))
    D.key(vd, 'scale', SNAP, (0.0, 0.0, 0.0))
    D.key(vd, 'scale', SNAP + 4, (1, 1, 1))
    for w in A2['wisps']:
        D.key(w, 'scale', ATTEMPT[1], (1.6, 1.6, 1.6))
        D.key(w, 'scale', SNAP, (1.6, 1.6, 1.6))
        D.key(w, 'scale', SNAP + 6, (0.2, 0.2, 0.2))
    # the jolt: a jump up, a stretch, spun back round to the laptop
    look = D.heading(act2.ROOM - act2.GHOST)
    D.key(groot, 'rotation_euler', SNAP, groot.rotation_euler.z, 2)
    D.key(groot, 'rotation_euler', SNAP + 4, look, 2)
    D.key(gbody, 'location', SNAP, z0, 2)
    D.key(gbody, 'location', SNAP + 3, z0 + 0.035, 2)
    D.key(gbody, 'location', SNAP + 12, z0 + 0.01, 2)
    D.key(gbody, 'scale', SNAP, (1, 1, 1))
    D.key(gbody, 'scale', SNAP + 3, (0.94, 0.94, 1.1))
    D.key(gbody, 'scale', SNAP + 10, (1, 1, 1))
    D.key(gbody, 'rotation_euler', SNAP, 0.0, 0)
    D.key(gbody, 'rotation_euler', SNAP + 3, math.radians(-8), 0)          # recoils, head back
    D.key(gbody, 'rotation_euler', SNAP + 14, math.radians(-3), 0)
    # the laptop: the held badge pulses lime
    held = bpy.data.materials['screen_held'].node_tree
    for f, v in ((PULSE[0], 1.1), (PULSE[0] + 5, 1.9), (PULSE[0] + 11, 1.2), (PULSE[1], 1.1)):
        D.value_key(held, 'brightness', f, v)
    head = Vector((act2.GHOST.x, act2.GHOST.y, act2.PEEK_Z + z0))
    D.cut('s06a', ATTEMPT[0], [(ATTEMPT[0], (1.10, -0.60, 1.16), tuple(head + Vector((0, 0, -0.06))), 55),
                               (ATTEMPT[1], (1.12, -0.52, 1.15), tuple(head + Vector((0, 0, -0.06))), 66)], fstop=2.4)
    c, n = D.screen_center(L, 'held')
    D.cut('s06b', PULSE[0], [(PULSE[0], tuple(c + n * 0.30 + Vector((0.05, 0, 0.0))), tuple(c), 50),
                             (PULSE[1], tuple(c + n * 0.27 + Vector((0.045, 0, 0.0))), tuple(c), 50)], fstop=3.5)
    D.cut('s06c', SNAP, [(SNAP, (1.02, -0.78, 1.08), tuple(head + Vector((0, 0, -0.03))), 48),
                         (360, (1.04, -0.74, 1.09), tuple(head + Vector((0, 0, -0.03))), 50)], fstop=2.4)

    # ---- 07: the realization
    D.key(gbody, 'location', SAG[0], z0 + 0.01, 2)
    D.key(gbody, 'location', SAG[1], z0 - 0.03, 2)                         # it sinks
    D.key(gbody, 'scale', SAG[0], (1, 1, 1))
    D.key(gbody, 'scale', SAG[1], (1.04, 1.04, 0.92))                      # slumps
    D.key(gbody, 'rotation_euler', SAG[0], math.radians(-3), 0)
    D.key(gbody, 'rotation_euler', SAG[1], math.radians(10), 0)            # head drops forward
    D.key(gbody, 'rotation_euler', RESOLVE[0], math.radians(10), 0)
    D.key(gbody, 'location', RESOLVE[0], z0 - 0.03, 2)
    D.key(gbody, 'scale', RESOLVE[0], (1.04, 1.04, 0.92))
    D.key(gbody, 'location', RESOLVE[1], z0 + 0.01, 2)                     # draws itself up
    D.key(gbody, 'scale', RESOLVE[1], (0.98, 0.98, 1.04))
    D.key(gbody, 'rotation_euler', RESOLVE[1], math.radians(-2), 0)
    D.key(gbody, 'scale', RESOLVE[1] + 6, (1, 1, 1))
    door = look - math.radians(200)                                        # towards the door, off right
    D.key(groot, 'rotation_euler', TURN_GO[0], look, 2)
    D.key(groot, 'rotation_euler', TURN_GO[1], door, 2)
    D.key(groot, 'location', TURN_GO[0], (act2.GHOST.x, act2.GHOST.y, act2.PEEK_Z), -1)
    D.key(groot, 'location', 440, (act2.GHOST.x + 0.6, act2.GHOST.y - 0.2, act2.PEEK_Z - 0.2), -1)
    D.cut('s07a', 361, [(361, (1.08, -0.66, 1.18), tuple(head + Vector((0, 0, -0.05))), 60),
                        (420, (1.12, -0.56, 1.16), tuple(head + Vector((0, 0, -0.07))), 72)], fstop=2.2)
    # the Held screen, square on and readable, a slow push
    up = Vector((0, 0, 0.13))                                # over the pumpkin's stem, looking down a touch
    D.cut('s07b', 421, [(421, tuple(c + n * 0.50 + up), tuple(c), 50), (456, tuple(c + n * 0.45 + up * 0.9), tuple(c), 50)],
          fstop=5.6)
