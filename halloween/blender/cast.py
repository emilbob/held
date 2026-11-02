"""The cast and the story props, built once for the whole film: the pumpkin, the ghost, the laptop and the package.
Each act moves them and shows or hides them on its own frames (show())."""
import bpy, math
import pumpkin, ghost, story_props


def build(M):
    hero = pumpkin.build_hero(M)
    gh = ghost.build(M, (0.9, 1.0, 0))
    lap = story_props.build_laptop(M, (0.6, 0.3, 0.012))
    pkg = story_props.build_package(M, (1.0, 0.6, 0.012))
    # off stage until their acts bring them in
    for rig in (gh, lap, pkg):
        show(rig['root'], False, 1)
    return dict(hero=hero, ghost=gh, laptop=lap, package=pkg)


def show(root, visible, frame):
    """Show or hide a rig (its root and everything under it) from this frame on. Showing the laptop un-hides every
    screen page: call story_props.set_screen on the same frame afterwards."""
    for ob in [root] + list(root.children_recursive):
        if ob.type == 'EMPTY':
            continue
        ob.hide_render = not visible
        ob.hide_viewport = not visible
        ob.keyframe_insert('hide_render', frame=frame)
        ob.keyframe_insert('hide_viewport', frame=frame)
