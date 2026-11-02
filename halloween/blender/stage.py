"""The set: the one sitting room the whole film plays in. Room, fire, props, the night outside, the lantern, haze, world,
fill lights, Eevee and compositor settings, and fixed look-development cameras (VIEWS)."""
import bpy, math
from lib import box, light, node_mat, empty, aim, flicker
import materials, room, fire, props, outside, lantern
import timeline as T

LANTERN = (-0.30, 0.50)          # on two old books on the floor, left of the hearth (the story's lantern)


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
    sc.frame_start, sc.frame_end = T.START, T.FILM_END
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
    """Builds the room; returns dict(M=materials, lantern=lantern rig, lantern_z=its stand height)."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = T.START, T.FILM_END
    M = materials.build()
    room.build(M)
    fire.build_hearth_fire(M)
    props.build(M)
    outside.build(M)
    z = props.build_lantern_stand(M, LANTERN)
    L = lantern.build(M, (*LANTERN, z), rz=10)
    world()
    haze(M)
    fill_lights()
    return dict(M=M, lantern=L, lantern_z=z)


VIEWS = {   # fixed test cameras (location, target, lens, f-stop) for look development
    'fire': ((0.75, 0.2, 0.55), (0.75, 1.95, 0.3), 45, 4.0),
    'hero': ((-0.05, 0.38, 0.12), (0.25, 0.8, 0.09), 50, 4.0),
    'face': ((-0.12, 0.50, 0.13), (0.25, 0.72, 0.08), 50, 5.6),       # the jack-o'-lantern's face, frames 112+
    'lantern': ((-0.3, 0.05, 0.25), (-0.3, 0.5, 0.2), 50, 4.0),
    'mantel': ((0.7, -0.4, 1.35), (0.7, 1.7, 1.3), 40, 5.6),
    'window': ((-1.3, -1.0, 1.3), (-1.6, 2.2, 1.6), 30, 5.6),
}


def view(name):
    """Replace the active camera's move with a fixed look-development view."""
    cam = bpy.context.scene.camera
    cam.animation_data_clear()
    cam.constraints.clear()
    tgt = bpy.data.objects.get(cam.name + '_target')
    if tgt:
        tgt.animation_data_clear()
    loc, t, lens, fs = VIEWS[name]
    cam.location = loc
    tgt.location = t
    aim(cam, t)
    cam.data.animation_data_clear()
    cam.data.lens = lens
    cam.data.dof.aperture_fstop = fs


