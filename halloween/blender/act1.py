"""Act I, "The Perfect Halloween" (shots 01–03, frames 1–144): one continuous camera move into the room; the
jack-o'-lantern hops out from behind the armchair and sees the lantern. The animation itself is in animate.py."""
import bpy
from lib import light, aim
import animate, stage
import timeline as T


def build(S, C):
    """S = the set (set.build), C = the cast (cast.build)."""
    hero, L, z = C['hero'], S['lantern'], S['lantern_z']
    cam, tgt = animate.build_camera('cam_act1')
    # the lantern's light on the pumpkin's face: a small hidden area light at the lantern, aimed at where the pumpkin
    # stops; it swells with the bloom (animate_lantern). And a cool moonlight rim from the window side.
    lx, ly = stage.LANTERN
    lk = light('lantern_key', 'AREA', (lx + 0.08, ly + 0.03, z + 0.15), 0.4, kelvin=2000, size=0.12, shape='DISK', volume=0.0)
    aim(lk, (animate.WALK_TO.x, animate.WALK_TO.y, 0.09))
    lk.visible_camera = lk.visible_glossy = False
    L['key'] = lk
    rim = light('moon_rim', 'SPOT', (-1.3, 2.0, 1.2), 6.0, color=(0.55, 0.7, 1.0), size=0.2, spot=14, blend=0.6, volume=0.0)
    aim(rim, (animate.WALK_TO.x, animate.WALK_TO.y, 0.10))
    animate.animate_hero(hero)
    animate.keep_on_floor(hero)
    animate.animate_lantern(L)
    animate.animate_camera(cam, tgt, hero)
    mk = bpy.context.scene.timeline_markers.new('act1', frame=T.START)
    mk.camera = cam
    return dict(cam=cam)
