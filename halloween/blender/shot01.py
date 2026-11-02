"""Scene 01, "The Perfect Halloween": build the room, the pumpkin and the lantern, animate, render with Eevee.

  blender -b --factory-startup -P blender/shot01.py -- --still 120 --out renders/tests/s120.png [--pct 66] [--samples 64]
  blender -b --factory-startup -P blender/shot01.py -- --frames 1-144 --out renders/preview [--pct 66]
  blender -b --factory-startup -P blender/shot01.py -- --save renders/scene01.blend      (open it in the UI)
"""
import bpy, sys, os, math, time, argparse
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import box, light, node_mat, empty, ROOT, flicker
import materials, room, fire, props, outside, lantern, pumpkin, animate
import timeline as T


def haze(M):
    """A faint warm haze filling the room, so firelight, candles and the moon's shafts have volume."""
    m = bpy.data.materials.new('haze')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    v = nt.nodes.new('ShaderNodeVolumePrincipled')
    v.inputs['Density'].default_value = 0.004
    v.inputs['Color'].default_value = (1.0, 0.97, 0.94, 1)
    v.inputs['Anisotropy'].default_value = 0.35
    nt.links.new(v.outputs[0], out.inputs['Volume'])
    hb = box('haze', room.X1 - room.X0, room.BACK - room.Y0, room.H, ((room.X0 + room.X1) / 2, (room.Y0 + room.BACK) / 2, room.H / 2),
             mat=m, c='FX')
    hb.visible_shadow = False


def world():
    w = bpy.data.worlds.new('world')
    bpy.context.scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.02, 0.03, 0.06, 1)
    bg.inputs['Strength'].default_value = 0.15


def fill_lights():
    """Lifts the shadows just enough to keep detail: a big soft warm bounce from the fire's side and floor."""
    b = light('fire_bounce', 'AREA', (0.8, 0.6, 0.02), 1.2, kelvin=2200, size=2.5, size_y=1.6, rot=(math.radians(180), 0, 0),
              shadow=False, specular=0.0)
    flicker(b.data, 'energy', 1.2, 0.25, speed=1.4, seed=61)
    room_fill = light('room_fill', 'AREA', (0.4, -2.5, 2.6), 20.0, kelvin=3000, size=3.0, rot=(0, 0, 0), specular=0.0)
    return b, room_fill


def render_settings(pct=66, samples=64):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    e = sc.eevee
    e.taa_render_samples = samples
    e.use_raytracing = True
    e.ray_tracing_method = 'SCREEN'
    e.ray_tracing_options.resolution_scale = '2'
    e.use_fast_gi = True
    e.fast_gi_method = 'GLOBAL_ILLUMINATION'
    e.use_shadows = True
    e.shadow_ray_count = 2
    e.shadow_step_count = 8
    e.shadow_pool_size = '1024'            # ~20 shadow-casting candle and fire lights overflow the default 512 MB at 1080p
    e.use_volumetric_shadows = True
    e.volumetric_tile_size = '4'
    e.volumetric_samples = 64
    e.volumetric_start = 0.05
    e.volumetric_end = 12.0
    e.clamp_surface_indirect = 10.0
    sc.render.resolution_x, sc.render.resolution_y = 1920, 1080
    sc.render.resolution_percentage = pct
    sc.render.fps = T.FPS
    sc.frame_start, sc.frame_end = T.START, T.END
    sc.render.film_transparent = False
    # Filmic, not AgX: AgX turns this film's saturated candle- and firelit oranges salmon-pink (tested side by side)
    sc.view_settings.view_transform = 'Filmic'
    sc.view_settings.look = 'Medium High Contrast'
    sc.view_settings.exposure = 0.35
    sc.view_settings.use_white_balance = True     # balanced towards the firelight, so the walls keep their green
    sc.view_settings.white_balance_temperature = 4300
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.color_depth = '8'
    compositor(sc)


def compositor(sc):
    """Soft bloom around the flames and the lantern, and a gentle vignette."""
    tree = bpy.data.node_groups.new('comp', 'CompositorNodeTree')
    sc.compositing_node_group = tree
    tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    rl = tree.nodes.new('CompositorNodeRLayers')
    gl = tree.nodes.new('CompositorNodeGlare')
    gl.inputs['Type'].default_value = 'Bloom'
    gl.inputs['Quality'].default_value = 'High'
    gl.inputs['Threshold'].default_value = 2.0
    gl.inputs['Strength'].default_value = 0.2
    gl.inputs['Size'].default_value = 0.5
    tree.links.new(rl.outputs['Image'], gl.inputs['Image'])
    # vignette: an ellipse mask, blurred, multiplied in
    vm = tree.nodes.new('CompositorNodeEllipseMask')
    vm.inputs['Size'].default_value = (0.95, 0.85)
    bl = tree.nodes.new('CompositorNodeBlur')
    bl.inputs['Size'].default_value = (220, 220)
    tree.links.new(vm.outputs[0], bl.inputs['Image'])
    mr = tree.nodes.new('ShaderNodeMapRange')
    mr.inputs['To Min'].default_value = 0.72
    tree.links.new(bl.outputs[0], mr.inputs['Value'])
    mul = tree.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    tree.links.new(gl.outputs['Image'], mul.inputs[6])
    tree.links.new(mr.outputs[0], mul.inputs[7])
    go = tree.nodes.new('NodeGroupOutput')
    tree.links.new(mul.outputs[2], go.inputs[0])


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = T.START, T.END
    M = materials.build()
    room.build(M)
    fire.build_hearth_fire(M)
    props.build(M)
    outside.build(M)
    z = props.build_lantern_stand(M, tuple(animate.LANTERN))
    L = lantern.build(M, (*animate.LANTERN, z), rz=10)
    rig = pumpkin.build_hero(M)
    world()
    haze(M)
    fill_lights()
    cam, tgt = animate.build_camera()
    # the lantern's light on the pumpkin's face: a small hidden area light at the lantern, aimed at where the pumpkin
    # stops; it swells with the bloom (animate_lantern). And a cool moonlight rim from the window side.
    from lib import aim
    lk = light('lantern_key', 'AREA', (animate.LANTERN.x + 0.08, animate.LANTERN.y + 0.03, z + 0.15), 0.4, kelvin=2000,
               size=0.12, shape='DISK', volume=0.0)
    aim(lk, (animate.WALK_TO.x, animate.WALK_TO.y, 0.09))
    lk.visible_camera = lk.visible_glossy = False
    L['key'] = lk
    rim = light('moon_rim', 'SPOT', (-1.3, 2.0, 1.2), 6.0, color=(0.55, 0.7, 1.0), size=0.2, spot=14, blend=0.6, volume=0.0)
    aim(rim, (animate.WALK_TO.x, animate.WALK_TO.y, 0.10))
    animate.animate_hero(rig)
    animate.animate_lantern(L)
    animate.animate_camera(cam, tgt, rig)
    return dict(M=M, rig=rig, lantern=L, cam=cam)


VIEWS = {   # fixed test cameras (location, target, lens, f-stop) for look development
    'fire': ((0.75, 0.2, 0.55), (0.75, 1.95, 0.3), 45, 4.0),
    'hero': ((-0.05, 0.38, 0.12), (0.25, 0.8, 0.09), 50, 4.0),
    'face': ((-0.12, 0.50, 0.13), (0.25, 0.72, 0.08), 50, 5.6),       # the jack-o'-lantern's face, frames 112+
    'lantern': ((-0.3, 0.05, 0.25), (-0.3, 0.5, 0.2), 50, 4.0),
    'mantel': ((0.7, -0.4, 1.35), (0.7, 1.7, 1.3), 40, 5.6),
    'window': ((-1.3, -1.0, 1.3), (-1.6, 2.2, 1.6), 30, 5.6),
}


def view(name):
    cam = bpy.context.scene.camera
    cam.animation_data_clear()
    cam.constraints.clear()
    tgt = bpy.data.objects['cam_target']
    tgt.animation_data_clear()
    loc, t, lens, fs = VIEWS[name]
    cam.location = loc
    tgt.location = t
    from lib import aim
    aim(cam, t)
    cam.data.animation_data_clear()
    cam.data.lens = lens
    cam.data.dof.aperture_fstop = fs


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument('--still', type=int)
    ap.add_argument('--frames')
    ap.add_argument('--out')
    ap.add_argument('--pct', type=int, default=66)
    ap.add_argument('--samples', type=int, default=64)
    ap.add_argument('--save')
    ap.add_argument('--view', choices=sorted(VIEWS))
    ap.add_argument('--nohaze', action='store_true')
    ap.add_argument('--vt', help='view transform test: name[,look]')
    ap.add_argument('--wb', help='white balance test: off, or temperature,tint')
    a = ap.parse_args(argv)
    t0 = time.time()
    build()
    render_settings(a.pct, a.samples)
    if a.view:
        view(a.view)
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
