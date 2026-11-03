"""Act V, "Happy Halloween" (frames 1153–1320).

10 Friendship (1153–1236): the jack-o'-lantern turns to the ghost, then hops round to the lantern's side, leaving room;
   the ghost hesitates, then drifts over and settles on the other side. The camera pulls back.
11 Finale (1237–1320): the room glows; the picture dissolves into the Held end card (added in assembly, from
   timeline.EV['endcard']).
"""
import bpy, math
from mathutils import Vector
import direct as D
import animate, act2, act4
import timeline as T

E = T.EV
BESIDE_L = Vector((0.66, 0.70))         # the pumpkin, left of the lantern
BESIDE_R = Vector((1.27, 0.84))         # the ghost, right of it: 32 cm from the lantern's centre (no overlap)


def build(S, C):
    hero, gh, lan = C['hero'], C['ghost'], S['lantern']
    sc = bpy.context.scene
    sc.frame_set(1152)
    root, body = hero['root'], hero['body']
    groot, gbody = gh['root'], gh['body']
    z0 = gbody.location.z
    D.hold(root, 1153)
    D.hold(groot, 1153)
    D.hold(gbody, 1153)
    # it turns to the ghost, then hops round to the lantern's side
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
    D.key(groot, 'rotation_euler', b, D.heading(Vector((0.45, 0.25)) - BESIDE_R), 2)      # it turns to us too
    a, b = E['settle']
    D.key(gbody, 'scale', a, (1, 1, 1))
    D.key(gbody, 'scale', a + 4, (1.05, 1.05, 1.02))                                       # a contented puff
    D.key(gbody, 'scale', b, (1, 1, 1))
    for f in range(b, T.FILM_END + 1, 12):
        D.key(gbody, 'location', f, z0 + 0.005 * math.sin(f * 0.5), 2)
    # the room glows a little warmer at the end
    glass = lan['glass'].node_tree
    D.value_key(glass, 'glow', 1236, 0.42)
    D.value_key(glass, 'glow', 1270, 0.55)
    lan['glow'].data.energy = 2.0
    lan['glow'].data.keyframe_insert('energy', frame=1236)
    lan['glow'].data.energy = 2.8
    lan['glow'].data.keyframe_insert('energy', frame=1270)
    animate.keep_on_floor(hero, 1153, T.FILM_END)
    tgt = (0.95, 0.80, 0.17)
    D.cut('s10_friendship', 1153, [(1153, (0.34, 0.22, 0.26), tgt, 36), (1236, (0.10, -0.25, 0.42), tgt, 32)], fstop=3.2)
    D.cut('s11_finale', 1237, [(1237, (0.10, -0.25, 0.42), tgt, 32), (T.FILM_END, (-0.22, -0.78, 0.64), tgt, 30)],
          fstop=4.0)
