"""The shots of "Until it arrives": lighting state, what each screen shows, camera moves. Builds and renders one.

  blender -b -P commercial/blender/shots.py -- --shot s1 --out renders/s1/ --frames 1-120 [--pct 50] [--samples 160]
  --frames range renders the shot's own range (s4n and s4m: one camera move in two lighting states that dissolve)
  blender -b -P commercial/blender/shots.py -- --shot s1 --out renders/s1_still.png --frame 60
  blender -b -P commercial/blender/shots.py -- --shot s1 --save blender/s1.blend
"""
import bpy, sys, os, math, argparse, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scene as S
from mathutils import Vector

# Camera points are either world coordinates, or ('laptop' | 'phone', u, v[, (right, out, up)]): a point on that
# screen in texture coordinates (u from the left, v from the top), optionally offset in the screen's own frame
# (metres along its right, out of the glass, and up). Camera keys: (frame, location, target, focal mm, f-stop, focus).
SHOTS = {
    # 0–5 s. Night. The buyer pays on the real checkout page: the link opens, the pointer picks pathUSD and goes to
    # "Pay $64.00" (both buttons' real hover states), "Sending…", then "Held: protected" decodes in. The phone is asleep.
    's1': dict(time='night', frames=120, laptop='s1-laptop', phone=None,
               cam=[(1, (0.86, -0.70, 1.13), (0.03, 0.68, 0.84), 40, 2.8, ('laptop', 0.5, 0.75)),
                    (120, (0.50, -0.16, 0.985), (0.04, 0.69, 0.855), 40, 2.8, ('laptop', 0.5, 0.75))]),
    # 5–10 s. The phone beside the laptop: the same order, held, the protection window counting down; a short scroll.
    's2': dict(time='night', frames=120, laptop='s2-laptop', phone='s2-phone',
               cam=[(1, ('phone', 0.50, 0.36, (-0.018, 0.255, -0.150)), ('phone', 0.48, 0.36), 85, 5.6, ('phone', 0.40, 0.40)),
                    (120, ('phone', 0.50, 0.47, (0.010, 0.235, -0.135)), ('phone', 0.52, 0.45), 85, 5.6, ('phone', 0.40, 0.45))]),
    # 10–15 s. The laptop's screen, close: "Held until delivery", "locked by the Tempo protocol, not by the merchant."
    # The pointer drifts onto "I got it: release payment" and rests there: not yet.
    's3': dict(time='night', frames=120, laptop='s3-laptop', phone='s3-phone',
               cam=[(1, ('laptop', 0.50, 0.40, (0.02, 0.40, 0.02)), ('laptop', 0.48, 0.40), 50, 4.0, ('laptop', 0.48, 0.40)),
                    (120, ('laptop', 0.56, 0.40, (0.09, 0.36, 0.02)), ('laptop', 0.52, 0.40), 50, 4.0, ('laptop', 0.52, 0.40))]),
    # 15–21 s. The night passes: the desk wide, in the opening's framing, lamp on, the held order on the screen. On one
    # unbroken camera move it dissolves into the same frame next morning: lamp off, sun through the window, the laptop
    # asleep, the mug moved, and the parcel on the desk. s4n renders frames 1–84 of the move, s4m frames 61–144.
    's4n': dict(time='night', frames=144, range=(1, 84), laptop='s4n-laptop', phone=None, cam=[(1, (0.86, -0.70, 1.13), (0.03, 0.66, 0.84), 40, 4.0, (0.0, 0.60, 0.82)),
                     (144, (0.70, -0.50, 1.08), (-0.02, 0.64, 0.83), 40, 4.0, (0.0, 0.60, 0.82))]),
    's4m': dict(time='morning', frames=144, range=(61, 144), parcel=True, laptop=None, phone=None, cam=[(1, (0.86, -0.70, 1.13), (0.03, 0.66, 0.84), 40, 4.0, (0.0, 0.60, 0.82)),
                     (144, (0.70, -0.50, 1.08), (-0.02, 0.64, 0.83), 40, 4.0, (0.0, 0.60, 0.82))]),
    # 21–31 s. Close on the parcel, the Held print on its side; the camera rises and drifts to the phone as focus racks
    # over. The phone wakes (f62) on the order; the buyer releases the payment: "Confirming…", "Paid to merchant".
    # The camera settles at f168 and holds there to f240, so "Paid to merchant" reads before the end card.
    's5': dict(time='morning', frames=240, parcel=True, laptop=None, phone='s5-phone', phone_wake=62,
               cam=[(1, (-0.565, -0.105, 0.845), (-0.381, 0.293, 0.80), 50, 2.8, (-0.381, 0.293, 0.80)),
                    (60, (-0.525, -0.045, 0.85), (-0.370, 0.293, 0.80), 50, 2.8, (-0.381, 0.293, 0.80)),
                    (100, (-0.10, 0.02, 0.93), ('phone', 0.48, 0.36), 55, 3.2, ('phone', 0.45, 0.36)),
                    (168, ('phone', 0.50, 0.40, (-0.015, 0.235, -0.215)), ('phone', 0.47, 0.34), 60, 4.0, ('phone', 0.45, 0.40)),
                    (240, ('phone', 0.50, 0.40, (-0.015, 0.235, -0.215)), ('phone', 0.47, 0.34), 60, 4.0, ('phone', 0.45, 0.40))]),
    # look development
    'hero': dict(time='night', frames=1, laptop='s3-laptop', phone='s2-phone',
                 cam=[(1, (0.50, -0.14, 0.97), (0.06, 0.62, 0.82), 45, 2.8, (0.02, 0.72, 0.86))]),
    'wide': dict(time='night', frames=1, laptop='s3-laptop', phone='s2-phone',
                 cam=[(1, (0.4, -2.3, 1.55), (0.0, 0.7, 0.8), 24, 16, (0.0, 0.7, 0.8))]),
    'wide_m': dict(time='morning', frames=1, parcel=True, laptop=None, phone=None,
                   cam=[(1, (0.4, -2.3, 1.55), (0.0, 0.7, 0.8), 24, 16, (0.0, 0.7, 0.8))]),
}

LOOK = dict(night=dict(white_k=4300, exposure=0.0), morning=dict(white_k=5600, exposure=0.6))
SCREEN_SIZE = dict(laptop=(0.3024, 0.1964), phone=(0.0651, 0.1411))


def point(P, spec):
    if not isinstance(spec[0], str):
        return Vector(spec)
    scr = P[spec[0] + '_screen']
    w, h = SCREEN_SIZE[spec[0]]
    mw = scr.matrix_world
    # both screen quads are built in their local XZ plane, facing local -Y
    p = mw @ Vector(((spec[1] - 0.5) * w, 0, (0.5 - spec[2]) * h))
    if len(spec) > 3:
        r, o, u = spec[3]
        p = p + mw.to_3x3().normalized() @ Vector((r, -o, u))
    return p


def fcurves(action):
    """F-curves of an action (Blender 5 keeps them in layered channelbags)."""
    if hasattr(action, 'fcurves'):
        return list(action.fcurves)
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                out += list(bag.fcurves)
    return out


def keyed_camera(P, spec):
    keys = spec['cam']
    _, loc, tgt, focal, fstop, _ = keys[0]
    cam = S.camera('cam', point(P, loc), point(P, tgt), focal, fstop)
    tgt_ob = bpy.data.objects.new('cam_target', None); S.link(tgt_ob, 'Cameras')
    foc_ob = bpy.data.objects.new('cam_focus', None); S.link(foc_ob, 'Cameras')
    con = cam.constraints.new('TRACK_TO'); con.target = tgt_ob
    con.track_axis = 'TRACK_NEGATIVE_Z'; con.up_axis = 'UP_Y'
    cam.data.dof.focus_object = foc_ob
    for f, loc, tgt, focal, fstop, focus in keys:
        cam.location = point(P, loc); cam.keyframe_insert('location', frame=f)
        tgt_ob.location = point(P, tgt); tgt_ob.keyframe_insert('location', frame=f)
        foc_ob.location = point(P, focus); foc_ob.keyframe_insert('location', frame=f)
        cam.data.lens = focal; cam.data.keyframe_insert('lens', frame=f)
        cam.data.dof.aperture_fstop = fstop; cam.data.keyframe_insert('dof.aperture_fstop', frame=f)
    # a slider move: Bezier keys with flat handles ease in and out of the move
    for ob in (cam, tgt_ob, foc_ob, cam.data):
        ad = ob.animation_data
        for fc in fcurves(ad.action) if ad and ad.action else []:
            for k in fc.keyframe_points:
                k.interpolation = 'BEZIER'
                k.handle_left_type = k.handle_right_type = 'AUTO_CLAMPED'
    return cam


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--shot', default='hero')
    ap.add_argument('--out')
    ap.add_argument('--save')
    ap.add_argument('--pct', type=int, default=100)
    ap.add_argument('--samples', type=int, default=256)
    ap.add_argument('--frame', type=int, default=1)
    ap.add_argument('--frames')
    ap.add_argument('--step', type=int, default=1)
    ap.add_argument('--no-overwrite', action='store_true', help='keep frames already on disk (resume an interrupted render)')
    a = ap.parse_args(argv)
    spec = SHOTS[a.shot]
    P = S.build(spec['time'], parcel=spec.get('parcel'), laptop=spec.get('laptop'), phone=spec.get('phone'), phone_wake=spec.get('phone_wake'))
    bpy.context.view_layer.update()
    keyed_camera(P, spec)
    S.render_settings(samples=a.samples, pct=a.pct, **LOOK[spec['time']])
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, spec['frames']
    if a.save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.save))
    if a.out:
        t = time.time()
        if a.frames:
            f0, f1 = spec.get('range', (1, spec['frames'])) if a.frames == 'range' else map(int, a.frames.split('-'))
            sc.frame_start, sc.frame_end, sc.frame_step = f0, f1, a.step
            sc.render.filepath = os.path.join(os.path.abspath(a.out), 'f_####')
            sc.render.use_overwrite = not a.no_overwrite
            sc.render.use_placeholder = a.no_overwrite
            bpy.ops.render.render(animation=True)
        else:
            sc.frame_set(a.frame)
            sc.render.filepath = os.path.abspath(a.out)
            bpy.ops.render.render(write_still=True)
        print(f'RENDER_TIME {time.time() - t:.1f}s')


main()
