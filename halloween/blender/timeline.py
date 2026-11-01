"""Scene 01 timeline: one source of truth for picture and sound. Frames are 1-based at 24 fps (frame 1 = 0.0 s).

The pumpkin's footfalls are derived here so the animation (pumpkin.py walk) and the footsteps (audio/sfx.py) agree.
Run as a script to write out/timeline.json for the audio tools (which don't import bpy).
"""
import json, os

FPS = 24
START, END = 1, 144

# acts
ESTABLISH = (1, 48)          # wide push-in
REVEAL = (49, 96)            # the pumpkin trots in, camera follows
NOTICE = (97, 144)           # the pumpkin notices the lantern

# the pumpkin's walk: it enters at WALK_IN, steps every STEP frames, the last step lands at WALK_STOP
WALK_IN = 44
STEP = 7                      # ~3.4 steps a second: a small creature's quick trot
WALK_STOP = 100
STEPS = list(range(WALK_IN + 4, WALK_STOP + 1, STEP))       # frames at which a foot lands
TURN = (100, 112)             # turns its body towards the lantern
NOTICE_AT = 108               # it sees the lantern: eyes widen, pupils dilate
LANTERN_BLOOM = (104, 124)    # the lantern's glow swells
EYES_BRIGHT = (110, 126)      # the eyes catch the light and brighten
SETTLE = 132                  # a small happy bob, then stillness


def sec(frame):
    return (frame - 1) / FPS


def as_dict():
    return dict(fps=FPS, start=START, end=END, steps=STEPS, steps_s=[sec(f) for f in STEPS], walk_in=WALK_IN,
                walk_stop=WALK_STOP, notice_at=NOTICE_AT, notice_s=sec(NOTICE_AT), lantern_bloom=LANTERN_BLOOM,
                eyes_bright=EYES_BRIGHT, settle=SETTLE, duration_s=(END - START + 1) / FPS)


if __name__ == '__main__':
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out', 'timeline.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as f:
        json.dump(as_dict(), f, indent=1)
    print(out)
