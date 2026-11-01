"""The room's material library. Palette: deep green-teal paint and dark wood (cool, quiet) against amber light,
brass and orange (warm, the subject). Every surface has broken-up roughness and some colour variation."""
import bpy, math
from lib import node_mat, pbr, simple, noise, map_range, mix_rgb, emission


def painted(name, color, relief='painted_plaster_wall', scale=1.6, rough=0.62, bump=0.25):
    """Paint over a plaster relief: the texture's displacement gives the surface, the colour is ours, with a
    faint mottling so a wall never reads as one flat value."""
    m = pbr(name, relief, scale=scale, bump=bump, rough_mul=0.25, rough_add=rough)
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    nz = noise(nt, 2.5, 5)
    dark = tuple(c * 0.82 for c in color)
    nt.links.new(mix_rgb(nt, dark, color, map_range(nt, nz.outputs['Fac'], 0.35, 0.65, 0, 1)), bsdf.inputs['Base Color'])
    return m


def soot(m, z0, z1, strength=0.85):
    """Darken a material towards the top of the firebox opening (smoke stains), by object-space height."""
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    src = bsdf.inputs['Base Color'].links[0].from_socket
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    nz = noise(nt, 6, 6)
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'MULTIPLY_ADD'
    add.inputs[1].default_value = 0.12
    nt.links.new(nz.outputs['Fac'], add.inputs[0])
    nt.links.new(sep.outputs['Z'], add.inputs[2])
    fac = map_range(nt, add.outputs[0], z0, z1, 0, strength)
    nt.links.new(mix_rgb(nt, src, (0.012, 0.010, 0.009), fac), bsdf.inputs['Base Color'])


def wax(name, color=(0.70, 0.60, 0.44)):
    """Candle wax: creamy, translucent, glowing where the flame is near (subsurface does the glow)."""
    m = simple(name, color, 0.38, rough_var=0.1, sss=0.6, sss_radius=(1.0, 0.55, 0.25), color_var=0.08, var_scale=60)
    m.node_tree.nodes['Principled BSDF'].inputs['Subsurface Scale'].default_value = 0.008
    return m


def flame_mat(name='flame', strength=7.0):
    """A candle flame: white-yellow core rising to orange, a faint blue base, soft edges. Object-space Z is the
    flame's height (0 at the wick, 1 at the tip); the mesh is a teardrop of revolution."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0.25, 0.35, 1.0, 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (1.0, 0.32, 0.05, 1)
    for p, c in ((0.12, (1.0, 0.85, 0.55, 1)), (0.35, (1.0, 0.78, 0.40, 1)), (0.7, (1.0, 0.55, 0.15, 1))):
        e = cr.elements.new(p)
        e.color = c
    nt.links.new(sep.outputs['Z'], ramp.inputs[0])
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(ramp.outputs[0], em.inputs['Color'])
    em.inputs['Strength'].default_value = strength
    # fresnel-like edge fade: facing ratio → alpha
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.35
    inv = map_range(nt, lw.outputs['Facing'], 0.0, 0.85, 1.0, 0.0)
    tip = map_range(nt, sep.outputs['Z'], 0.6, 1.0, 1.0, 0.2)
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(inv, mul.inputs[0])
    nt.links.new(tip, mul.inputs[1])
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(mul.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    m.surface_render_method = 'BLENDED'
    m.use_transparent_shadow = True
    return m


def glass(name, color=(1, 1, 1), rough=0.02, ior=1.45):
    m, nt, bsdf, out = node_mat(name)
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Transmission Weight'].default_value = 1.0
    bsdf.inputs['IOR'].default_value = ior
    m.surface_render_method = 'DITHERED'
    m.use_transparent_shadow = True
    return m


def window_glass():
    """Old window glass, seen from inside at night: mostly transparent, a faint reflection of the warm room.
    Rendered as transparent + glossy (not refractive) so the night outside reads clearly through it."""
    m = bpy.data.materials.get('window_glass') or bpy.data.materials.new('window_glass')
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    tr.inputs['Color'].default_value = (0.92, 0.95, 0.96, 1)
    gl = nt.nodes.new('ShaderNodeBsdfGlossy')
    nz = noise(nt, 3, 3)
    nt.links.new(map_range(nt, nz.outputs['Fac'], 0.3, 0.7, 0.02, 0.09), gl.inputs['Roughness'])
    fr = nt.nodes.new('ShaderNodeFresnel')
    fr.inputs['IOR'].default_value = 1.5
    mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(fr.outputs[0], mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(gl.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    m.surface_render_method = 'BLENDED'
    m.use_transparent_shadow = True
    return m


def embers(name='embers'):
    """Charred log with glowing cracks: voronoi cracks emit orange, shifting slowly with time (driven W)."""
    m = pbr(name, 'bark_brown_02', scale=0.35, val=0.08, sat=0.5, rough_mul=0.4, rough_add=0.55, bump=0.9)
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.voronoi_dimensions = '4D'
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 14.0
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    d = vor.inputs['W'].driver_add('default_value').driver
    d.expression = 'frame / 60'
    cracks = map_range(nt, vor.outputs['Distance'], 0.0, 0.014, 1.0, 0.0)
    nz = noise(nt, 4, 3)
    hot = map_range(nt, nz.outputs['Fac'], 0.5, 0.68, 0.0, 1.0)       # only some regions are hot
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    nt.links.new(cracks, mul.inputs[0])
    nt.links.new(hot, mul.inputs[1])
    # hotter towards the bottom (where the logs sit in the embers)
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    low = map_range(nt, sep.outputs['Z'], 0.2, 0.75, 1.0, 0.25)
    mul2 = nt.nodes.new('ShaderNodeMath')
    mul2.operation = 'MULTIPLY'
    nt.links.new(mul.outputs[0], mul2.inputs[0])
    nt.links.new(low, mul2.inputs[1])
    bsdf.inputs['Emission Color'].default_value = (1.0, 0.12, 0.01, 1)
    st = nt.nodes.new('ShaderNodeMath')
    st.operation = 'MULTIPLY'
    st.inputs[1].default_value = 4.0
    nt.links.new(mul2.outputs[0], st.inputs[0])
    nt.links.new(st.outputs[0], bsdf.inputs['Emission Strength'])
    return m


def fire_mat(name='fire', strength=3.5):
    """Hearth flames on crossed cards: 4D noise scrolling upwards (driven by the frame), shaped by a height gradient
    and the card's horizontal centre, through a blackbody-like ramp. Transparent where it's cool."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['UV'], sep.inputs[0])
    # scrolling noise in UV space (u across, v up)
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    scroll = nt.nodes.new('ShaderNodeMath')
    scroll.operation = 'SUBTRACT'
    nt.links.new(sep.outputs['Y'], scroll.inputs[0])
    dv = scroll.inputs[1].driver_add('default_value').driver
    dv.expression = 'frame * 0.045'
    xs = nt.nodes.new('ShaderNodeMath')
    xs.operation = 'MULTIPLY'
    xs.inputs[1].default_value = 1.6
    nt.links.new(sep.outputs['X'], xs.inputs[0])
    nt.links.new(xs.outputs[0], comb.inputs['X'])
    nt.links.new(scroll.outputs[0], comb.inputs['Y'])
    nz = nt.nodes.new('ShaderNodeTexNoise')
    nz.noise_dimensions = '4D'
    nz.inputs['Scale'].default_value = 3.2
    nz.inputs['Detail'].default_value = 6
    nz.inputs['Roughness'].default_value = 0.55
    nz.inputs['Distortion'].default_value = 0.6
    nt.links.new(comb.outputs[0], nz.inputs['Vector'])
    nz.inputs['W'].driver_add('default_value').driver.expression = 'frame * 0.03'
    # shape: strong at the bottom centre, fading upwards and to the sides
    cx = nt.nodes.new('ShaderNodeMath')
    cx.operation = 'SUBTRACT'
    cx.inputs[1].default_value = 0.5
    nt.links.new(sep.outputs['X'], cx.inputs[0])
    ax = nt.nodes.new('ShaderNodeMath')
    ax.operation = 'ABSOLUTE'
    nt.links.new(cx.outputs[0], ax.inputs[0])
    side = map_range(nt, ax.outputs[0], 0.05, 0.42, 1.0, 0.0)
    up = map_range(nt, sep.outputs['Y'], 0.0, 1.0, 1.0, 0.0)
    shape = nt.nodes.new('ShaderNodeMath')
    shape.operation = 'MULTIPLY'
    nt.links.new(side, shape.inputs[0])
    nt.links.new(up, shape.inputs[1])
    # heat = shape * 1.5 + (noise * 1.9 - 1.3): the card's edges stay below the alpha threshold everywhere, the
    # middle breaks into tongues where the noise dips
    inv = nt.nodes.new('ShaderNodeMath')
    inv.operation = 'MULTIPLY_ADD'
    inv.inputs[1].default_value = 1.9
    inv.inputs[2].default_value = -1.3
    nt.links.new(nz.outputs['Fac'], inv.inputs[0])
    heat = nt.nodes.new('ShaderNodeMath')
    heat.operation = 'MULTIPLY_ADD'
    heat.inputs[1].default_value = 1.5
    nt.links.new(shape.outputs[0], heat.inputs[0])
    nt.links.new(inv.outputs[0], heat.inputs[2])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position = 0.18
    cr.elements[0].color = (0.0, 0.0, 0.0, 1)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (1.0, 0.86, 0.6, 1)
    for p, c in ((0.3, (0.7, 0.10, 0.01, 1)), (0.5, (1.0, 0.35, 0.04, 1)), (0.75, (1.0, 0.62, 0.2, 1))):
        cr.elements.new(p).color = c
    nt.links.new(heat.outputs[0], ramp.inputs[0])
    alpha = map_range(nt, heat.outputs[0], 0.2, 0.45, 0.0, 1.0)
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(ramp.outputs[0], em.inputs['Color'])
    em.inputs['Strength'].default_value = strength
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    nt.links.new(alpha, mx.inputs[0])
    nt.links.new(tr.outputs[0], mx.inputs[1])
    nt.links.new(em.outputs[0], mx.inputs[2])
    nt.links.new(mx.outputs[0], out.inputs[0])
    m.surface_render_method = 'BLENDED'
    m.use_transparent_shadow = True
    return m


def build():
    M = {}
    M['floor'] = pbr('floor', 'old_wood_floor', scale=2.2, rot=math.radians(90), tint=(0.85, 0.72, 0.6), rough_mul=0.5,
                     rough_add=0.3, bump=0.35, coat=0.2, coat_rough=0.35)
    M['wall'] = painted('wall', (0.16, 0.24, 0.22))                 # deep sage-teal
    M['wainscot'] = simple('wainscot', (0.07, 0.115, 0.105), 0.42, rough_var=0.08, color_var=0.1)   # darker, satin
    M['trim'] = simple('trim', (0.06, 0.09, 0.085), 0.4, rough_var=0.08, color_var=0.08)
    M['ceiling'] = painted('ceiling', (0.55, 0.52, 0.46), scale=2.5, rough=0.85, bump=0.15)
    M['brick'] = pbr('brick', 'castle_brick_02_red', scale=1.1, sat=0.75, val=0.8, rough_mul=0.3, rough_add=0.65, bump=0.8)
    M['firebrick'] = pbr('firebrick', 'castle_brick_02_red', scale=0.9, val=0.05, sat=0.6, rough_mul=0.2, rough_add=0.75, bump=0.8)
    soot(M['firebrick'], -0.2, 0.55, 0.9)
    M['hearth'] = simple('hearth', (0.05, 0.05, 0.052), 0.5, rough_var=0.15, color_var=0.25, var_scale=12)   # slate
    M['mantel'] = pbr('mantel', 'wood_table_worn', scale=1.0, tint=(0.55, 0.38, 0.26), rough_mul=0.4, rough_add=0.35, bump=0.3,
                      coat=0.3, coat_rough=0.25)
    M['dark_wood'] = pbr('dark_wood', 'dark_wood', scale=1.0, rough_mul=0.4, rough_add=0.35, bump=0.25, coat=0.25, coat_rough=0.3)
    M['rug'] = pbr('rug', 'quatrefoil_jacquard_fabric', scale=0.6, tint=(0.16, 0.075, 0.065), sat=0.7, rough_mul=0.1,
                   rough_add=0.85, bump=0.6, sheen=0.15)
    M['velvet'] = pbr('velvet', 'velour_velvet', scale=0.4, tint=(0.55, 0.22, 0.12), rough_mul=0.2, rough_add=0.7, sheen=1.0)
    M['bark'] = pbr('bark', 'bark_brown_02', scale=0.4, val=0.7, rough_mul=0.3, rough_add=0.6, bump=0.8)
    M['embers'] = embers()
    M['ash'] = simple('ash', (0.09, 0.085, 0.08), 0.95, color_var=0.5, var_scale=40)
    M['iron'] = simple('iron', (0.035, 0.032, 0.03), 0.5, metal=0.85, rough_var=0.15, color_var=0.3, var_scale=50)
    M['brass'] = simple('brass', (0.78, 0.56, 0.30), 0.3, metal=1.0, rough_var=0.12, color_var=0.25, var_scale=40)
    M['wax'] = wax('wax')
    M['wax_old'] = wax('wax_old', (0.62, 0.50, 0.34))
    M['wick'] = simple('wick', (0.02, 0.018, 0.016), 0.9)
    M['flame'] = flame_mat()
    M['fire'] = fire_mat()
    M['window_glass'] = window_glass()
    M['amber_glass'] = glass('amber_glass', (1.0, 0.62, 0.25), rough=0.08)
    M['ceramic_cream'] = simple('ceramic_cream', (0.72, 0.66, 0.56), 0.22, rough_var=0.08, coat=0.4, coat_rough=0.1, color_var=0.08)
    M['pages'] = simple('pages', (0.66, 0.60, 0.50), 0.85, color_var=0.12)
    M['moon'] = emission('moon', (0.75, 0.85, 1.0), 6.0)
    return M
