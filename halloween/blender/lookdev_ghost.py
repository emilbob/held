"""Look development for the ghost: build Scene 01, add the ghost behind the pumpkin, render the shot camera at the
last frame and a closer 3/4 view.

  blender -b --factory-startup -P blender/lookdev_ghost.py -- --out renders/tests/ghost/v1 [--pct 50] [--samples 32]
"""
import bpy, sys, os, math, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector
import film, stage, animate, ghost
from lib import aim


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', required=True)
    ap.add_argument('--pct', type=int, default=50)
    ap.add_argument('--samples', type=int, default=32)
    a = ap.parse_args(argv)
    built = film.build()
    stage.render_settings(a.pct, a.samples)
    G = Vector((0.66, 0.98))
    cam_pos = Vector((-0.44, -0.34))
    g = ghost.build(built['M'], (G.x, G.y, 0), rz=animate.heading(cam_pos.lerp(animate.WALK_TO, 0.5) - G))
    g['body'].rotation_euler = (math.radians(-4), math.radians(3), 0)      # leaning back a little, aloof
    sc = bpy.context.scene
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    sc.frame_set(144)
    sc.render.filepath = os.path.abspath(a.out + '_shot.png')
    bpy.ops.render.render(write_still=True)
    # a closer 3/4 view of the ghost
    cam = sc.camera
    cam.animation_data_clear()
    cam.constraints.clear()
    cam.data.animation_data_clear()
    hz = g['body'].location.z                       # the head's centre
    tgt = Vector((G.x, G.y, hz - 0.09))
    cam.location = (G.x - 0.42, G.y - 0.74, hz - 0.05)
    aim(cam, tgt)
    cam.data.lens = 50
    cam.data.dof.focus_object = None
    cam.data.dof.focus_distance = (tgt - cam.location).length
    cam.data.dof.aperture_fstop = 4.0
    sc.render.filepath = os.path.abspath(a.out + '_close.png')
    bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
