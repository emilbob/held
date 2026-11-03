"""The Great Halloween Trick: build the set and the cast, add every act that exists, render.

  blender -b --factory-startup -P blender/film.py -- --act 1 --out renders/act1 [--pct 66] [--samples 64]
  blender -b --factory-startup -P blender/film.py -- --frames 1-144 --out renders/preview
  blender -b --factory-startup -P blender/film.py -- --still 120 --out renders/tests/s120.png [--view face]
  blender -b --factory-startup -P blender/film.py -- --save renders/film.blend      (open it in the UI)

Each act renders on its own (--act N) into its own folder, so a fix re-renders only that act.
"""
import bpy, sys, os, time, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stage, cast, act1, act2, act3, act4, act5
import timeline as T


def build():
    S = stage.build()
    C = cast.build(S['M'])
    act1.build(S, C)
    A2 = act2.build(S, C)
    act3.build(S, C, A2)
    act4.build(S, C)
    act5.build(S, C)
    import ghost
    ghost.volume_smoke(C['ghost'], A2['wisps'], T.EV['leave'], T.EV['snap'] + 8)       # real smoke replaces the cards
    bpy.context.scene.frame_set(T.START)
    return dict(S=S, C=C, M=S['M'], rig=C['hero'], lantern=S['lantern'])


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--still', type=int)
    ap.add_argument('--frames')
    ap.add_argument('--list', help='comma-separated frames, each written as <out>/fNNNN.png')
    ap.add_argument('--out')
    ap.add_argument('--pct', type=int, default=66)
    ap.add_argument('--res', help='exact output size WxH (overrides --pct)')
    ap.add_argument('--samples', type=int, default=64)
    ap.add_argument('--save')
    ap.add_argument('--act', type=int, choices=sorted(T.ACTS))
    ap.add_argument('--view', choices=sorted(stage.VIEWS))
    ap.add_argument('--nohaze', action='store_true')
    ap.add_argument('--vt', help='view transform test: name[,look]')
    ap.add_argument('--wb', help='white balance test: off, or temperature,tint')
    a = ap.parse_args(argv)
    t0 = time.time()
    build()
    stage.render_settings(a.pct, a.samples)
    if a.res:
        r = bpy.context.scene.render
        r.resolution_x, r.resolution_y = map(int, a.res.split('x'))
        r.resolution_percentage = 100
    if a.act:
        a.frames = '%d-%d' % T.ACTS[a.act]
    if a.view:
        stage.view(a.view)
    if a.vt:
        vs = bpy.context.scene.view_settings
        name, *look = a.vt.split(',')
        vs.view_transform = name
        vs.look = look[0] if look else 'None'
    if a.wb:
        vs = bpy.context.scene.view_settings
        if a.wb == 'off':
            vs.use_white_balance = False
        else:
            vs.white_balance_temperature, vs.white_balance_tint = map(float, a.wb.split(','))
    if a.nohaze:
        bpy.data.objects['haze'].hide_render = True
    print(f'BUILD_TIME {time.time() - t0:.1f}s')
    sc = bpy.context.scene
    if a.save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.save))
    if a.still is not None:
        sc.frame_set(a.still)
        sc.render.filepath = os.path.abspath(a.out)
        t0 = time.time()
        bpy.ops.render.render(write_still=True)
        print(f'RENDER_TIME {time.time() - t0:.1f}s')
    elif a.list:
        for f in map(int, a.list.split(',')):
            sc.frame_set(f)
            sc.render.filepath = os.path.join(os.path.abspath(a.out), f'f{f:04d}.png')
            bpy.ops.render.render(write_still=True)
    elif a.frames:
        f0, f1 = map(int, a.frames.split('-'))
        sc.frame_start, sc.frame_end = f0, f1
        sc.render.filepath = os.path.join(os.path.abspath(a.out), 'f')
        sc.render.use_overwrite = False
        t0 = time.time()
        bpy.ops.render.render(animation=True)
        print(f'RENDER_TIME {time.time() - t0:.1f}s for {f1 - f0 + 1} frames')


if __name__ == '__main__':
    main()
