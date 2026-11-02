"""Act V, "Happy Halloween" (frames 601–720).

10 Friendship (601–672): the jack-o'-lantern turns to the ghost, then hops round to the lantern's side, leaving room;
   the ghost hesitates, then drifts over and settles on the other side. The camera pulls back.
11 Finale (673–720): the room glows; the picture dissolves into the Held end card (added in assembly, from
   timeline.EV['endcard']).
"""
import bpy, math
from mathutils import Vector
import direct as D
import animate, act2, act4
import timeline as T

E = T.EV
BESIDE_L = Vector((0.72, 0.74))         # the pumpkin, left of the lantern
BESIDE_R = Vector((1.17, 0.78))         # the ghost, right of it


def build(S, C):
    hero, gh, lan = C['hero'], C['ghost'], S['lantern']
    sc = bpy.context.scene
    sc.frame_set(600)
    root, body = hero['root'], hero['body']
    groot, gbody = gh['root'], gh['body']
    z0 = gbody.location.z
    D.hold(root, 601)
    D.hold(groot, 601)
    D.hold(gbody, 601)
    # it turns to the ghost
    ghost_now = Vector((groot.location.x, groot.location.y))
    D.turn(hero, *E['turn_ghost'], root.rotation_euler.z, D.heading(ghost_now - act2.AT_LAPTOP))
    mid = act2.AT_LAPTOP.lerp(BESIDE_L, 0.5)
    D.hop(hero, *E['hops_v'][0], act2.AT_LAPTOP, mid, side=1)
    D.hop(hero, *E['hops_v'][1], mid, BESIDE_L, side=-1)
    face = D.heading(Vector((0.45, 0.25)) - BESIDE_L)      # three-quarters to camera, so the film ends on its face
    D.turn(hero, E['hops_v'][1][1], E['hops_v'][1][1] + 6, D.heading(BESIDE_L - mid), face)
    D.flare(hero, E['settle'][0], peak=6.0, rest=5.0, length=12)
    # the ghost hesitates (backs off, sways), then joins it
    a, b = E['hesitate']
    back = ghost_now + Vector((0.05, 0.04))
    D.key(groot, 'location', a, (ghost_now.x, ghost_now.y, 0.0))
    D.key(groot, 'location', b, (back.x, back.y, 0.0))
    for i, f in enumerate(range(a, b, 4)):
        D.key(gbody, 'rotation_euler', f, math.radians(5 if i % 2 else -5), 1)
    D.key(gbody, 'rotation_euler', b, 0.0, 1)
    a, b = E['join']
    D.key(groot, 'location', a, (back.x, back.y, 0.0))
    D.key(groot, 'location', b, (BESIDE_R.x, BESIDE_R.y, 0.0))
    D.key(groot, 'rotation_euler', a, groot.rotation_euler.z, 2)
    D.key(groot, 'rotation_euler', b, D.heading(act4.PKG.lerp(BESIDE_L, 0.5) - BESIDE_R), 2)
    a, b = E['settle']
    D.key(gbody, 'scale', a, (1, 1, 1))
    D.key(gbody, 'scale', a + 4, (1.05, 1.05, 1.02))                         # a contented puff
    D.key(gbody, 'scale', b, (1, 1, 1))
    for f in range(b, 721, 12):
        D.key(gbody, 'location', f, z0 + 0.005 * math.sin(f * 0.5), 2)
    # the room glows a little warmer at the end
    glass = lan['glass'].node_tree
    D.value_key(glass, 'glow', 672, 0.42)
    D.value_key(glass, 'glow', 700, 0.55)
    lan['glow'].data.energy = 2.0
    lan['glow'].data.keyframe_insert('energy', frame=672)
    lan['glow'].data.energy = 2.8
    lan['glow'].data.keyframe_insert('energy', frame=700)
    animate.keep_on_floor(hero, 601, 720)
    tgt = (0.95, 0.80, 0.17)
    D.cut('s10', 601, [(601, (0.34, 0.22, 0.26), tgt, 36), (672, (0.10, -0.25, 0.42), tgt, 32)], fstop=3.2)
    D.cut('s11', 673, [(673, (0.10, -0.25, 0.42), tgt, 32), (720, (-0.18, -0.70, 0.62), tgt, 30)], fstop=4.0)
