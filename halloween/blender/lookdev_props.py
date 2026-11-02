"""Look development for the story props: the laptop (one still per screen) and the package, on the rug by the pumpkin.

  blender -b --factory-startup -P blender/lookdev_props.py -- --out renders/tests/props/v1 [--pct 50] [--samples 32]
"""
import bpy, sys, os, math, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector
import film, stage, animate, story_props as SP
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
    M = built['M']
    LP = Vector((0.62, 0.30))                       # the laptop on the rug, its screen towards the camera side
    L = SP.build_laptop(M, (LP.x, LP.y, 0.012), rz=math.radians(-20))
    K = Vector((0.95, 0.55))
    SP.build_package(M, (K.x, K.y, 0.012), rz=math.radians(25))
    sc = bpy.context.scene
    sc.frame_set(144)
    cam = sc.camera
    cam.animation_data_clear()
    cam.constraints.clear()
    cam.data.animation_data_clear()
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)

    def shot(pos, tgt, lens, fs, path):
        cam.location = pos
        aim(cam, tgt)
        cam.data.lens = lens
        cam.data.dof.focus_object = None
        cam.data.dof.focus_distance = (Vector(tgt) - Vector(pos)).length
        cam.data.dof.aperture_fstop = fs
        sc.render.filepath = os.path.abspath(path)
        bpy.ops.render.render(write_still=True)
    # wide: laptop, package and pumpkin together
    shot((0.15, -0.75, 0.42), (0.75, 0.45, 0.06), 35, 5.6, a.out + '_wide.png')
    # over-the-shoulder-ish view of each screen
    for page in SP.PAGES:
        SP.set_screen(L, page)
        shot((LP.x + 0.12, LP.y - 0.42, 0.24), (LP.x - 0.02, LP.y + 0.06, 0.10), 45, 4.0, f'{a.out}_{page}.png')
    # the package close
    shot((K.x + 0.32, K.y - 0.36, 0.24), (K.x, K.y, 0.07), 50, 4.0, a.out + '_package.png')


if __name__ == '__main__':
    main()
