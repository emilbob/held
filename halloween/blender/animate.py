"""Scene 01 animation: the pumpkin's trot and its moment of wonder, the lantern's bloom, the camera move.
All timing comes from timeline.py so the sound lines up."""
import bpy, math
from mathutils import Vector
from lib import empty, fcurves, link
import timeline as T

# story positions on the floor (see README layout)
LANTERN = Vector((-0.30, 0.50))     # on two old books on the floor, left of the hearth
WALK_FROM = Vector((1.15, 0.90))    # hidden in front of the armchair, whose back is to the camera
WALK_TO = Vector((0.25, 0.72))      # it trots left and a little towards the camera, so we see its face


def heading(d):
    """rotation_euler.z that turns the character's front (-Y) towards the 2D direction d."""
    return math.atan2(d.x, -d.y)


def key(ob, path, frame, value, index=-1, interp='BEZIER'):
    if index >= 0:
        getattr(ob, path)[index] = value
    else:
        setattr(ob, path, value)
    ob.keyframe_insert(path, index=index, frame=frame)


def ease(t):
    return t * t * (3 - 2 * t)


def walk_pos(f):
    """Position along a gentle arc from WALK_FROM to WALK_TO, eased in and out."""
    t = min(1.0, max(0.0, (f - T.WALK_IN) / (T.WALK_STOP - T.WALK_IN)))
    s = 0.12 + 0.88 * t if t < 1 else 1.0          # it is already moving when it enters
    s = s * s * (3 - 2 * s) * 0.35 + s * 0.65       # mostly steady, eased at the end
    p = WALK_FROM.lerp(WALK_TO, s)
    side = Vector((-(WALK_TO - WALK_FROM).y, (WALK_TO - WALK_FROM).x)).normalized()
    return p + side * 0.06 * math.sin(math.pi * s)


def animate_hero(rig):
    root, body = rig['root'], rig['body']
    legs, arms, lids, eyes = rig['legs'], rig['arms'], rig['lids'], rig['eyes']
    # --- path: key every 2 frames from the walk's start to its stop, then hold
    prev = None
    for f in range(T.START, T.WALK_STOP + 1, 2):
        p = walk_pos(f)
        nxt = walk_pos(f + 2)
        h = heading(nxt - p) if (nxt - p).length > 1e-5 else prev
        prev = h if h is not None else heading(WALK_TO - WALK_FROM)
        key(root, 'location', f, (p.x, p.y, 0))
        key(root, 'rotation_euler', f, prev, index=2)
    # turn towards the lantern (with a small overshoot), eyes first
    end_h = prev
    face = heading(LANTERN - WALK_TO)
    key(root, 'rotation_euler', T.TURN[0], end_h, 2)
    key(root, 'rotation_euler', T.TURN[0] + 8, face + math.radians(6), 2)
    key(root, 'rotation_euler', T.TURN[1], face, 2)
    key(root, 'rotation_euler', T.END, face, 2)
    key(root, 'location', T.END, (WALK_TO.x, WALK_TO.y, 0))

    # --- the trot: per step a hop (body up mid-step, squash on landing), legs and arms swinging, a side-to-side roll
    rest_z = body.location.z
    steps = T.STEPS
    for i, f in enumerate(steps):
        side = 1 if i % 2 else -1
        mid = f - T.STEP // 2
        key(body, 'location', mid, rest_z + 0.022, 2)
        key(body, 'location', f, rest_z - 0.004, 2)
        key(body, 'scale', mid, (0.97, 0.97, 1.05))
        key(body, 'scale', f, (1.05, 1.05, 0.93))
        key(body, 'scale', f + 2, (0.99, 0.99, 1.01))
        key(body, 'rotation_euler', mid, math.radians(7) * side, 1)
        key(body, 'rotation_euler', mid, math.radians(-6), 0)                  # leaning into the walk
        for k, leg in enumerate(legs):
            s = side * (1 if k else -1)
            key(leg, 'rotation_euler', mid, math.radians(32) * s, 0)
            key(leg, 'rotation_euler', f, math.radians(-14) * s, 0)
        for k, arm in enumerate(arms):
            s = side * (-1 if k else 1)
            key(arm, 'rotation_euler', mid, math.radians(35) * s, 0)
            key(arm, 'rotation_euler', mid, math.radians(-15 if k else 15), 1)
    stop = steps[-1]
    # --- stopping: settle, then the moment of noticing: a little rise and stretch, then a happy bob
    key(body, 'location', stop + 4, rest_z, 2)
    key(body, 'scale', stop + 4, (1, 1, 1))
    key(body, 'rotation_euler', stop + 4, 0.0, 1)
    key(body, 'rotation_euler', stop + 4, math.radians(-3), 0)
    for leg in legs:
        key(leg, 'rotation_euler', stop + 4, 0.0, 0)
    for k, arm in enumerate(arms):
        key(arm, 'rotation_euler', stop + 4, 0.0, 0)
        key(arm, 'rotation_euler', stop + 4, 0.0, 1)
    n = T.NOTICE_AT
    key(body, 'scale', n - 2, (1.03, 1.03, 0.96))              # anticipation
    key(body, 'location', n - 2, rest_z - 0.003, 2)
    key(body, 'scale', n + 4, (0.97, 0.97, 1.07))               # "oh!"
    key(body, 'location', n + 4, rest_z + 0.01, 2)
    key(body, 'rotation_euler', n + 4, math.radians(6), 0)      # leans back a touch, looking up
    for k, arm in enumerate(arms):                              # hands lift with delight
        s = 1 if k else -1
        key(arm, 'rotation_euler', n - 1, 0.0, 1)
        key(arm, 'rotation_euler', n + 6, math.radians(-40) * s, 1)
        key(arm, 'rotation_euler', n + 6, math.radians(-30), 0)
    key(body, 'scale', n + 12, (1, 1, 1))
    key(body, 'location', n + 12, rest_z, 2)
    s0 = T.SETTLE
    key(body, 'location', s0, rest_z, 2)
    key(body, 'location', s0 + 4, rest_z + 0.012, 2)
    key(body, 'location', s0 + 8, rest_z, 2)
    key(body, 'scale', s0 + 8, (1.02, 1.02, 0.98))
    key(body, 'scale', s0 + 12, (1, 1, 1))
    key(body, 'rotation_euler', T.END, math.radians(4), 0)
    for k, arm in enumerate(arms):
        s = 1 if k else -1
        key(arm, 'rotation_euler', T.END, math.radians(-30) * s, 1)
        key(arm, 'rotation_euler', T.END, math.radians(-22), 0)

    # --- eyes: look ahead while walking, dart to the lantern, then the body follows (the eyes keep aiming)
    look = rig['look']
    for f in range(T.START, n - 4, 4):
        p = walk_pos(f)
        ahead = walk_pos(f + 12)
        d = (ahead - p)
        d = d.normalized() if d.length > 1e-5 else (WALK_TO - WALK_FROM).normalized()
        key(look, 'location', f, (p.x + d.x * 0.8, p.y + d.y * 0.8, 0.1))
    lz = 0.074 + 0.17                                            # the lantern's glowing body
    key(look, 'location', n - 3, (LANTERN.x, LANTERN.y, lz))
    key(look, 'location', T.END, (LANTERN.x, LANTERN.y, lz + 0.01))
    # lids: rest at -25°, blink once mid-walk, open wide at the notice
    for lid in lids:
        key(lid, 'rotation_euler', T.START, math.radians(-8), 0)
        key(lid, 'rotation_euler', 80, math.radians(-8), 0)
        key(lid, 'rotation_euler', 82, math.radians(40), 0)
        key(lid, 'rotation_euler', 85, math.radians(-8), 0)
        key(lid, 'rotation_euler', n - 1, math.radians(-8), 0)
        key(lid, 'rotation_euler', n + 3, math.radians(-48), 0)
        key(lid, 'rotation_euler', T.END, math.radians(-40), 0)
    for e in eyes:
        key(e, 'scale', n - 1, (1, 1, 1))
        key(e, 'scale', n + 3, (1.1, 1.1, 1.14))
        key(e, 'scale', T.END, (1.07, 1.07, 1.1))
    # pupils dilate, the irises catch the light
    em = bpy.data.materials['eye'].node_tree
    pupil, glow = em.nodes['pupil'].outputs[0], em.nodes['glow'].outputs[0]
    for f, pv in ((T.START, 0.36), (n, 0.36), (n + 5, 0.54), (T.END, 0.5)):
        pupil.default_value = pv
        pupil.keyframe_insert('default_value', frame=f)
    for f, g in ((T.START, 0.0), (T.EYES_BRIGHT[0], 0.0), (T.EYES_BRIGHT[1], 0.3), (T.END, 0.24)):
        glow.default_value = g
        glow.keyframe_insert('default_value', frame=f)


def animate_lantern(L):
    a, b = T.LANTERN_BLOOM
    gl = L['glass'].node_tree.nodes['glow'].outputs[0]
    fz = L['frieze'].node_tree.nodes['glow'].outputs[0]
    for f, g, z in ((T.START, 0.12, 2.5), (a, 0.12, 2.5), (b, 0.45, 8.0), (T.END, 0.36, 6.5)):
        gl.default_value = g
        gl.keyframe_insert('default_value', frame=f)
        fz.default_value = z
        fz.keyframe_insert('default_value', frame=f)
    # the bloom light (its F-curve already carries a flicker noise; these keys ride underneath it)
    ld = L['glow'].data
    for f, e in ((T.START, 0.5), (a, 0.5), (b, 2.2), (T.END, 1.7)):
        ld.energy = e
        ld.keyframe_insert('energy', frame=f)
    kd = L['key'].data
    for f, e in ((T.START, 0.3), (a, 0.3), (b, 1.1), (T.END, 0.9)):
        kd.energy = e
        kd.keyframe_insert('energy', frame=f)


def build_camera():
    cd = bpy.data.cameras.new('cam')
    cd.sensor_width = 36
    cd.dof.use_dof = True
    cd.dof.aperture_blades = 7
    cd.clip_start = 0.02
    cam = bpy.data.objects.new('cam', cd)
    link(cam, 'Camera')
    bpy.context.scene.camera = cam
    tgt = empty('cam_target', c='Camera')
    con = cam.constraints.new('TRACK_TO')
    con.target = tgt
    con.track_axis = 'TRACK_NEGATIVE_Z'
    con.up_axis = 'UP_Y'
    cd.dof.focus_object = tgt
    return cam, tgt


def animate_camera(cam, tgt, rig):
    """One continuous move: a slow push into the room, sinking and swinging left to find the pumpkin, settling low
    in a 3/4 close-up with the lantern in the left foreground."""
    cd = cam.data
    pk = lambda f: walk_pos(f)
    keys = [
        # frame, camera position, target, lens, f-stop
        (1, (0.55, -3.35, 1.40), (0.45, 1.6, 0.80), 30, 4.0),
        (40, (0.42, -2.75, 1.18), (0.35, 1.4, 0.62), 30, 3.2),
        (72, (-0.45, -1.25, 0.46), (*pk(72), 0.16), 32, 2.4),
        (100, (-0.36, -0.52, 0.28), (*pk(100), 0.15), 35, 2.0),
        (144, (-0.44, -0.34, 0.24), (WALK_TO.x - 0.02, WALK_TO.y, 0.16), 36, 1.8),
    ]
    for f, p, t, lens, fs in keys:
        cam.location = p
        cam.keyframe_insert('location', frame=f)
        tgt.location = t
        tgt.keyframe_insert('location', frame=f)
        cd.lens = lens
        cd.keyframe_insert('lens', frame=f)
        cd.dof.aperture_fstop = fs
        cd.dof.keyframe_insert('aperture_fstop', frame=f)
    # follow the pumpkin smoothly between 60 and 100 (extra target keys)
    for f in range(56, 100, 8):
        p = pk(f)
        tgt.location = (p.x, p.y, 0.16)
        tgt.keyframe_insert('location', frame=f)
    # a barely perceptible drift, so the camera breathes
    for fc in fcurves(cam):
        if fc.data_path == 'location':
            nm = fc.modifiers.new('NOISE')
            nm.scale = 60
            nm.strength = 0.004
            nm.phase = fc.array_index * 9
