"""Mix Scene 01's sound: music (hall reverb) + sound effects (small room reverb) → out/scene01_audio.wav.
Also writes the stems (out/stems/*.wav) for later re-balancing in an editor.
Run: .venv/bin/python audio/mix.py   (after blender/timeline.py has written out/timeline.json)
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsp import SR, Bus, OUT, timeline, reverb_ir, reverb, write_wav, hp
import sfx, music

TAIL = 0.0          # seconds of decay past the picture (0: the scene's own length)


def main():
    tl = timeline()
    dur = tl['duration_s'] + TAIL
    n = int(dur * SR)
    t = np.arange(n) / SR
    # where the fireplace sits left-right in frame over the camera move (0 = left): right of centre in the wide,
    # dead centre behind the pumpkin at the end
    fire_pan = np.interp(t, [0, 2, 4.2, 6], [0.58, 0.6, 0.55, 0.52])
    # the pumpkin enters from the right and trots to the centre
    step_pan = lambda s: float(np.interp(s, [1.9, 4.1], [0.68, 0.5]))
    fx = Bus(dur)
    sfx.fire(dur, fire_pan).mix_into(fx, 1.9)
    sfx.wind(dur).mix_into(fx, 1.2)
    sfx.room(dur).mix_into(fx, 1.0)
    sfx.steps(dur, tl, step_pan).mix_into(fx, 2.2)
    fx.L, fx.R = hp(fx.L, 80), hp(fx.R, 80)              # no rumble: the room's sounds are small sounds
    fx = reverb(fx, reverb_ir(0.6, 0.4, seed=11), wet=0.12)
    magic = reverb(sfx.shimmer(dur, tl['notice_s']), reverb_ir(2.8, 0.7, seed=12), wet=0.4)
    mus = reverb(music.score(dur, tl), reverb_ir(2.6, 0.5, seed=13), wet=0.33)
    # the fire and wind dip a little when the wonder arrives, so the moment has room
    duck = np.interp(t, [0, tl['notice_s'] - 0.3, tl['notice_s'] + 0.4, dur], [1, 1, 0.72, 0.72])
    master = Bus(dur)
    master.L = fx.L * duck * 1.0 + mus.L * 0.85 + magic.L * 1.0
    master.R = fx.R * duck * 1.0 + mus.R * 0.85 + magic.R * 1.0
    master.L, master.R = hp(master.L, 40, 3), hp(master.R, 40, 3)
    # a 30 ms fade-in and a short fade-out so the scene cuts cleanly
    fade = np.minimum(1, t / 0.03) * np.minimum(1, (dur - t) / 0.25)
    master.L *= fade
    master.R *= fade
    stems = os.path.join(OUT, 'stems')
    for name, b in (('sfx', fx), ('magic', magic), ('music', mus)):
        write_wav(os.path.join(stems, f'scene01_{name}.wav'), b.stereo(), peak_db=-3)
    print(write_wav(os.path.join(OUT, 'scene01_audio.wav'), master.stereo(), peak_db=-1.0))


if __name__ == '__main__':
    main()
