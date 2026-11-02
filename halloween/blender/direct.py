"""Directing helpers shared by the acts: keyframes, shot cameras with cuts, the pumpkin's hop and tap, the ghost's float.

Conventions: a heading is rotation_euler.z that turns a rig's front (-Y) towards a 2D direction (animate.heading).
For the pumpkin's body, rotation x > 0 tips its top forward and y rolls it sideways."""
import bpy, math
from mathutils import Vector
from lib import aim, fcurves
import animate

heading = animate.heading


def key(ob, path, f, value, index=-1):
    animate.key(ob, path, f, value, index)


def value_key(node_tree, name, f, v):
    """Key a Value node (a material's control) at frame f."""
    o = node_tree.nodes[name].outputs[0]
    o.default_value = v
    o.keyframe_insert('default_value', frame=f)


def cut(name, frame, keys, fstop=2.8):
    """A shot: its own camera, bound to a marker at its first frame (Blender cuts to it there).
    keys: [(frame, camera position, target, lens)], eased between."""
    cam, tgt = animate.build_camera('cam_' + name)
    for f, pos, t, lens in keys:
        cam.location = pos
        cam.keyframe_insert('location', frame=f)
        tgt.location = t
        tgt.keyframe_insert('location', frame=f)
        cam.data.lens = lens
        cam.data.keyframe_insert('lens', frame=f)
    cam.data.dof.aperture_fstop = fstop
    mk = bpy.context.scene.timeline_markers.new(name, frame=frame)
    mk.camera = cam
    # a breath of handheld drift so locked-off shots aren't dead
    for fc in fcurves(cam):
        if fc.data_path == 'location':
            nm = fc.modifiers.new('NOISE')
            nm.scale = 50
            nm.strength = 0.0025
            nm.phase = fc.array_index * 7 + frame
    return cam


def hold(ob, f, paths=('location', 'rotation_euler', 'scale')):
    """Key the current values at f, so the next move starts from rest here."""
    for p in paths:
        ob.keyframe_insert(p, frame=f)


def hop(rig, f0, f1, p0, p1, h=None, height=0.026, side=1):
    """One hop of the jack-o'-lantern from p0 (on the ground at f0) to p1 (landing at f1): gathers (rocks back),
    leans into the air, lands with a small forward rock. h: its heading during the hop (default: towards p1)."""
    root, body = rig['root'], rig['body']
    p0, p1 = Vector(p0), Vector(p1)
    h = heading(p1 - p0) if h is None else h
    mid = (f0 + f1) // 2
    key(root, 'location', f0, (p0.x, p0.y, 0))
    key(root, 'location', f1, (p1.x, p1.y, 0))
    key(root, 'rotation_euler', f0 + 1, h, 2)
    key(body, 'location', f0, 0.0, 2)
    key(body, 'rotation_euler', f0 + 1, math.radians(-4), 0)
    key(body, 'location', mid, height, 2)
    key(body, 'rotation_euler', mid, math.radians(9), 0)
    key(body, 'rotation_euler', mid, math.radians(5) * side, 1)
    key(body, 'location', f1, 0.0, 2)
    key(body, 'rotation_euler', f1, math.radians(3), 0)
    key(body, 'rotation_euler', f1, 0.0, 1)
    key(body, 'rotation_euler', f1 + 5, 0.0, 0)
    for fc in fcurves(body):
        if fc.data_path == 'location' and fc.array_index == 2:
            for kp in fc.keyframe_points:
                if int(round(kp.co.x)) == f1:
                    kp.handle_left_type = kp.handle_right_type = 'VECTOR'


def turn(rig, f0, f1, h0, h1):
    """A slow pivot on its base, with a little overshoot."""
    root = rig['root']
    key(root, 'rotation_euler', f0, h0, 2)
    key(root, 'rotation_euler', f1 - 3, h1 + 0.6 * (h1 - h0) / max(1, abs(h1 - h0)) * math.radians(4), 2)
    key(root, 'rotation_euler', f1, h1, 2)


def tap(rig, f, depth=16):
    """It tips forward until its lower front presses down (a click), and rocks back."""
    body = rig['body']
    key(body, 'rotation_euler', f - 5, 0.0, 0)
    key(body, 'rotation_euler', f, math.radians(depth), 0)
    key(body, 'rotation_euler', f + 2, math.radians(depth - 2), 0)
    key(body, 'rotation_euler', f + 8, math.radians(-3), 0)
    key(body, 'rotation_euler', f + 13, 0.0, 0)


def flare(rig, f, peak=6.0, rest=3.5, length=10):
    """The candle inside flares (its light, flame and the flesh's glow) and settles."""
    ld = rig['candle_light'].data
    gl = bpy.data.materials['flesh'].node_tree
    fl = rig['flame']
    for df, e, g, s in ((0, rest, 0.3, 1.1), (3, peak, 0.6, 1.5), (length, rest, 0.35, 1.2)):
        ld.energy = e
        ld.keyframe_insert('energy', frame=f + df)
        value_key(gl, 'glow', f + df, g)
        fl.scale[2] = s
        fl.keyframe_insert('scale', index=2, frame=f + df)


def screen_center(L, page):
    """World position of a laptop page's centre and its facing direction (towards the viewer)."""
    bpy.context.view_layer.update()
    q = L['screens'][page]
    mw = q.matrix_world
    dh = q.dimensions.z if q.dimensions.z > 0 else 0.18
    c = mw @ Vector((0, 0, dh / 2))
    n = (mw.to_3x3() @ Vector((0, -1, 0))).normalized()
    return c, n
