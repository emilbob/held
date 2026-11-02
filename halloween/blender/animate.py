"""Scene 01 animation: the jack-o'-lantern's hops and the moment it sees the lantern, the lantern's bloom, the camera move.
All timing comes from timeline.py so the sound lines up."""
import bpy, math
from mathutils import Vector
from lib import empty, fcurves, link
import timeline as T

# story positions on the floor (see README layout)
LANTERN = Vector((-0.30, 0.50))     # on two old books on the floor, left of the hearth
WALK_FROM = Vector((1.15, 0.90))    # hidden in front of the armchair, whose back is to the camera
WALK_TO = Vector((0.25, 0.72))      # it hops left and a little towards the camera, so we see its face


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


def hop_frame(f):
    """Warps time so the pumpkin travels in hops: within each step it barely moves on the ground and covers the
    distance in the air."""
    for land in T.STEPS:
        start = land - T.STEP
        if start <= f < land:
            t = (f - start) / T.STEP
            return start + T.STEP * ease(ease(t))
    return f


def key_vector_handles(ob, path, index, frames):
    """Sharp contacts: the keys at these frames get vector handles (a hard landing, not an eased one)."""
    for fc in fcurves(ob):
        if fc.data_path == path and fc.array_index == index:
            for kp in fc.keyframe_points:
                if int(round(kp.co.x)) in frames:
                    kp.handle_left_type = kp.handle_right_type = 'VECTOR'


def animate_hero(rig):
    """A heavy, deliberate creature: it hops on its base (no squash), leaning into each hop and rocking on landing,
    stops, turns to the lantern, and the candle inside flares as it sees it."""
    root, body = rig['root'], rig['body']
    # --- path: keyed every frame through the hops, then held
    prev = None
    for f in range(T.START, T.WALK_STOP + 1):
        g = hop_frame(f)
        p = walk_pos(g)
        nxt = walk_pos(g + 2)
        h = heading(nxt - p) if (nxt - p).length > 1e-5 else prev
        prev = h if h is not None else heading(WALK_TO - WALK_FROM)
        key(root, 'location', f, (p.x, p.y, 0))
        key(root, 'rotation_euler', f, prev, index=2)
    # it turns to face the lantern: a slow pivot on its base, with a small overshoot
    end_h = prev
    face = heading(LANTERN - WALK_TO)
    key(root, 'rotation_euler', T.TURN[0], end_h, 2)
    key(root, 'rotation_euler', T.TURN[0] + 9, face + math.radians(4), 2)
    key(root, 'rotation_euler', T.TURN[1], face, 2)
    key(root, 'rotation_euler', T.END, face, 2)
    key(root, 'location', T.END, (WALK_TO.x, WALK_TO.y, 0))

    # --- the hops: rx > 0 leans the top forward (towards -Y), ry rolls it side to side
    lands = []
    for i, f in enumerate(T.STEPS):
        side = 1 if i % 2 else -1
        start = f - T.STEP
        key(body, 'location', start + 1, 0.0, 2)
        key(body, 'rotation_euler', start + 1, math.radians(-4), 0)            # gathers itself, rocking back
        key(body, 'location', f - T.STEP // 2, 0.026, 2)
        key(body, 'rotation_euler', f - T.STEP // 2, math.radians(9), 0)      # leans into the hop
        key(body, 'rotation_euler', f - T.STEP // 2, math.radians(5) * side, 1)
        key(body, 'location', f, 0.0, 2)
        key(body, 'rotation_euler', f, math.radians(3), 0)
        key(body, 'rotation_euler', f, math.radians(2) * side, 1)
        lands.append(f)
    key_vector_handles(body, 'location', 2, set(lands))
    stop = T.STEPS[-1]
    # --- stopping: it rocks to rest on its round base
    for df, rx, ry in ((4, -3.5, -1.0), (9, 1.5, 0.5), (14, -0.5, 0.0), (18, 0.0, 0.0)):
        key(body, 'rotation_euler', stop + df, math.radians(rx), 0)
        key(body, 'rotation_euler', stop + df, math.radians(ry), 1)
    key(body, 'location', stop + 4, 0.0, 2)
    # --- the notice: it tips back a little, as if looking up at the lantern, and stays there
    n = T.NOTICE_AT
    key(body, 'rotation_euler', n, 0.0, 0)
    key(body, 'rotation_euler', n + 8, math.radians(-5), 0)
    key(body, 'rotation_euler', T.END, math.radians(-4), 0)
    # the candle inside flares: light, flame and the flesh's inner glow (keys ride under the flicker noise)
    a, b = T.EYES_BRIGHT
    ld = rig['candle_light'].data
    for f, e in ((T.START, 2.5), (a, 2.5), (b, 6.0), (T.END, 5.0)):
        ld.energy = e
        ld.keyframe_insert('energy', frame=f)
    fl = rig['flame']
    for f, sz in ((T.START, 1.0), (a, 1.0), (a + 6, 1.45), (T.END, 1.3)):
        fl.scale[2] = sz
        fl.keyframe_insert('scale', index=2, frame=f)
    gl = bpy.data.materials['flesh'].node_tree.nodes['glow'].outputs[0]
    for f, g in ((T.START, 0.15), (a, 0.15), (b, 0.6), (T.END, 0.45)):
        gl.default_value = g
        gl.keyframe_insert('default_value', frame=f)


def keep_on_floor(rig):
    """Tilting the body about its base pushes the rim of the pumpkin below the floor. For every frame, find the lowest
    contact point after the body's tilt and hop and key the lift empty so it just touches the floor."""
    from mathutils import Euler
    body, lift = rig['body'], rig['lift']
    sc = bpy.context.scene
    for f in range(T.START, T.END + 1):
        sc.frame_set(f)
        rot = Euler(body.rotation_euler).to_matrix()
        low = min((rot @ (Vector(p) * Vector(body.scale))).z for p in rig['contact']) + body.location.z
        lift.location.z = max(0.0, -low)
        lift.keyframe_insert('location', index=2, frame=f)
    for fc in fcurves(lift):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'


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


def build_camera(name='cam'):
    cd = bpy.data.cameras.new(name)
    cd.sensor_width = 36
    cd.dof.use_dof = True
    cd.dof.aperture_blades = 7
    cd.clip_start = 0.02
    cam = bpy.data.objects.new(name, cd)
    link(cam, 'Camera')
    bpy.context.scene.camera = cam
    tgt = empty(name + '_target', c='Camera')
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
        (72, (-0.45, -1.25, 0.42), (*pk(72), 0.10), 32, 2.4),
        (100, (-0.36, -0.52, 0.22), (*pk(100), 0.09), 35, 2.0),
        (144, (-0.44, -0.34, 0.17), (WALK_TO.x - 0.02, WALK_TO.y, 0.09), 36, 1.8),
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
        tgt.location = (p.x, p.y, 0.10)
        tgt.keyframe_insert('location', frame=f)
    # a barely perceptible drift, so the camera breathes
    for fc in fcurves(cam):
        if fc.data_path == 'location':
            nm = fc.modifiers.new('NOISE')
            nm.scale = 60
            nm.strength = 0.004
            nm.phase = fc.array_index * 9
