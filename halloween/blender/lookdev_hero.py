"""Look development for the pumpkin character: build the room, park the pumpkin by the lantern with its animation
removed, pose it, and render one still per carved face (plus a full-body still).

  blender -b --factory-startup -P blender/lookdev_hero.py -- --out renders/tests/hero [--pct 50] [--samples 32]
"""
import bpy, sys, os, math, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector
import shot01, animate, pumpkin
from lib import aim


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--pct', type=int, default=50)
    ap.add_argument('--samples', type=int, default=32)
    ap.add_argument('--faces', default=','.join(pumpkin.FACE_ORDER))
    a = ap.parse_args(argv)
    built = shot01.build()
    shot01.render_settings(a.pct, a.samples)
    rig = built['rig']
    for ob in bpy.data.collections['Hero'].all_objects:
        if ob.name.startswith(('hero_root', 'hero_body', 'hero_face')):
            ob.animation_data_clear()
    rig['body'].location = (0, 0, pumpkin.LEG)
    rig['body'].scale = (1, 1, 1)
    sc = bpy.context.scene
    sc.frame_set(130)                        # the lantern's bloom, fire and candles as in the close shots
    P = Vector((animate.WALK_TO.x, animate.WALK_TO.y))
    cam = sc.camera
    cam.animation_data_clear()
    cam.constraints.clear()
    cam.data.animation_data_clear()
    to_cam = Vector((-0.42, -0.62)).normalized()
    root = rig['root']
    root.location = (P.x, P.y, 0)
    root.rotation_euler = (0, 0, animate.heading(to_cam) + math.radians(18))     # a 3/4 view
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)

    def shot(dist, z, tz, lens, fstop, path):
        c = P + to_cam * dist
        cam.location = (c.x, c.y, z)
        aim(cam, (P.x, P.y, tz))
        cam.data.lens = lens
        cam.data.dof.use_dof = True
        cam.data.dof.focus_object = None
        cam.data.dof.focus_distance = (Vector((P.x, P.y, tz)) - cam.location).length
        cam.data.dof.aperture_fstop = fstop
        sc.render.filepath = os.path.abspath(path)
        bpy.ops.render.render(write_still=True)
    # a little life in the pose: one arm lifted, the head tilted
    sh, el, wr = rig['arm']['L']
    sh.rotation_euler = (math.radians(35), math.radians(-30), 0)
    el.rotation_euler = (math.radians(-55), 0, 0)
    rig['body'].rotation_euler = (math.radians(-3), math.radians(5), 0)
    pumpkin.set_face(rig, 'curious')
    shot(0.9, 0.2, 0.15, 45, 5.6, a.out + '_body.png')
    for fc in a.faces.split(','):
        pumpkin.set_face(rig, fc)
        shot(0.62, 0.2, 0.17, 50, 5.6, f'{a.out}_{fc}.png')


if __name__ == '__main__':
    main()
