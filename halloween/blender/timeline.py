"""Scene 01 timeline: one source of truth for picture and sound. Frames are 1-based at 24 fps (frame 1 = 0.0 s).

The pumpkin's landings are derived here so the animation (animate.py hops) and the footsteps (audio/sfx.py) agree.
Run as a script to write out/timeline.json for the audio tools (which don't import bpy).
"""
import json, os

FPS = 24
START, END = 1, 144           # Act I (Scene 01)
FILM_END = 720                # the whole film: 30 s

# every shot of the film: name → (first frame, last frame). Acts: I 1–144, II 145–288, III 289–456, IV 457–600, V 601–720.
SHOTS = {
    's01_establish': (1, 48), 's02_reveal': (49, 96), 's03_discovery': (97, 144),
    's04_purchase': (145, 216), 's05_trick': (217, 288),
    's06_attempt': (289, 360), 's07_realization': (361, 456),
    's08_return': (457, 528), 's09_reveal': (529, 600),
    's10_friendship': (601, 672), 's11_finale': (673, 720),
}
ACTS = {1: (1, 144), 2: (145, 288), 3: (289, 456), 4: (457, 600), 5: (601, 720)}

# Acts II–III story beats (frames), shared by the animation (act2.py, act3.py) and the sound (audio/acts23.py)
EV = dict(
    turn=(147, 156), hops=[(157, 165), (166, 174)],            # the pumpkin turns from the lantern, hops to the laptop
    tap1=182, tap2=202,                                         # it presses "Pay with Held", then "Pay $48.00"
    rise=(222, 246), glee=(252, 268), leave=272,                # the ghost rises, wriggles with glee, turns to go
    attempt=(289, 322), pulse=(323, 338), snap=339,             # dissolving; the held badge pulses; it snaps back whole
    sag=(366, 388), resolve=(398, 408), turn_go=(410, 420),     # it slumps, draws itself up, turns to fetch the lantern
    screen=421,                                                 # the Held screen; the three-note Held signature
)

# acts
ESTABLISH = (1, 48)          # wide push-in
REVEAL = (49, 96)            # the pumpkin hops in, camera follows
NOTICE = (97, 144)           # the pumpkin notices the lantern

# the pumpkin's hops: it enters at WALK_IN, hops every STEP frames, the last hop lands at WALK_STOP
WALK_IN = 44
STEP = 8                      # 3 hops a second: heavy and deliberate
WALK_STOP = 100
STEPS = list(range(WALK_STOP, WALK_IN, -STEP))[::-1]      # frames at which it lands: 52, 60, ... 100
TURN = (100, 112)             # turns its body towards the lantern
NOTICE_AT = 108               # it sees the lantern
LANTERN_BLOOM = (104, 124)    # the lantern's glow swells
EYES_BRIGHT = (110, 126)      # the candle inside flares: the carved face burns brighter
SETTLE = 132                  # a small happy bob, then stillness


def sec(frame):
    return (frame - 1) / FPS


def as_dict():
    return dict(ev={k: v for k, v in EV.items()}, acts=ACTS, film_end=FILM_END, fps=FPS, start=START, end=END, steps=STEPS, steps_s=[sec(f) for f in STEPS], walk_in=WALK_IN,
                walk_stop=WALK_STOP, notice_at=NOTICE_AT, notice_s=sec(NOTICE_AT), lantern_bloom=LANTERN_BLOOM,
                eyes_bright=EYES_BRIGHT, settle=SETTLE, duration_s=(END - START + 1) / FPS)


if __name__ == '__main__':
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out', 'timeline.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as f:
        json.dump(as_dict(), f, indent=1)
    print(out)
