"""The film's timeline: one source of truth for picture and sound. Frames are 1-based at 24 fps (frame 1 = 0.0 s).

The pumpkin's landings are derived here so the animation (animate.py hops) and the footsteps (audio/sfx.py) agree.
Run as a script to write out/timeline.json for the audio tools (which don't import bpy).
"""
import json, os

FPS = 24
START, END = 1, 144           # Act I (Scene 01)
FILM_END = 1320               # the whole film: 55 s (Nov 3: 30 s was too fast to follow; every Held screen now holds
                              # 2–3 s, long enough to read)

# every shot of the film: name → (first frame, last frame); the acts' modules cut to a camera at each first frame.
SHOTS = {
    's01_establish': (1, 48), 's02_reveal': (49, 96), 's03_discovery': (97, 144),
    's04a_to_laptop': (145, 216), 's04b_checkout': (217, 396),
    's05a_rise': (397, 440), 's05b_phone_up': (441, 488), 's05c_phone_held': (489, 560), 's05d_glee': (561, 600),
    's06a_vanish': (601, 640), 's06b_refused': (641, 712), 's06c_snap': (713, 752), 's07_realization': (753, 840),
    's08_return': (841, 936), 's09a_unwrap': (937, 990), 's09b_joy': (991, 1012), 's09c_confirm': (1013, 1104),
    's09d_phone_paid': (1105, 1152),
    's10_friendship': (1153, 1236), 's11_finale': (1237, 1320),
}
ACTS = {1: (1, 144), 2: (145, 600), 3: (601, 840), 4: (841, 1152), 5: (1153, 1320)}

# Acts II–V story beats (frames), shared by the animation (act2–act5.py) and the sound (audio/acts23.py, acts45.py)
EV = dict(
    # Act II: the purchase. Screens: shop until tap1, checkout until tap2, then "Payment held".
    turn=(147, 156), hops=[(157, 165), (166, 174)],            # the pumpkin turns from the lantern, hops to the laptop
    tap1=262, tap2=336,                                         # it presses "Pay with Held", then "Pay $48.00"
    # Act II: the trick. The ghost's phone (the merchant's Held dashboard): held, then its tap on "pay yourself early".
    rise=(400, 432), phone_up=(441, 456),                       # the ghost rises; its phone floats up before it
    tap_early=540,                                              # it taps "Try to pay yourself early"
    glee=(561, 577), leave=580,                                 # it wriggles with glee, turns to slip away in smoke
    # Act III: refused.
    attempt=(601, 640), refused=641, signature=653,             # dissolving; the phone: refused; Held's three notes
    snap=713,                                                   # it snaps back whole
    sag=(760, 785), resolve=(795, 805), turn_go=(808, 820),     # it slumps, draws itself up, goes to fetch the lantern
    # Act IV: the delivery.
    knocks=[844, 849, 854], startle=845, turn_door=(852, 864),  # knock knock knock; the pumpkin starts, turns
    enter=(862, 896), set_down=(896, 904), hop_pkg=(906, 914),  # the ghost floats in with the package, sets it down
    twine=(940, 954), cover=(950, 972), glow=(962, 978),        # the twine floats off, the cover lifts off the lantern
    joy=(991, 1001), hop_back=(1004, 1012),                     # the pumpkin's joy; back to the laptop
    confirm=1044,                                               # "I got it: release payment" → Paid to merchant
    phone_paid=1105,                                            # the ghost's phone: paid
    # Act V
    turn_ghost=(1153, 1162), hops_v=[(1164, 1172), (1173, 1181)],   # it turns to the ghost, hops to the lantern's side
    hesitate=(1182, 1194), join=(1194, 1212), settle=(1212, 1220),  # the ghost hesitates, then joins it
    endcard=1262,                                               # the room dissolves into the Held end card (12 frames)
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
