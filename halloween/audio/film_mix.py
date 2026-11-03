"""Mix the whole film's sound (0–30 s) → out/film_audio.wav, with stems in out/stems/film_*.wav.

The room (fire, wind, room tone) runs under everything. Act I's music and cues (music.score, sfx.steps, sfx.shimmer)
are Scene 01's, unchanged; its last chord fades into Act II. Acts II–III come from acts23.py, Acts IV–V from acts45.py.
Run: python3 blender/timeline.py && .venv/bin/python audio/film_mix.py
"""
import os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dsp import SR, Bus, OUT, timeline, reverb_ir, reverb, write_wav, hp
import sfx, music, acts23, acts45

ACT1 = 6.0


def main():
    tl = timeline()
    dur = tl['film_end'] / 24
    n = int(dur * SR)
    t = np.arange(n) / SR
    fire_pan = np.interp(t, [0, 2, 4.2, 6, dur], [0.58, 0.6, 0.55, 0.52, 0.5])
    step_pan = lambda s: float(np.interp(s, [1.9, 4.1], [0.68, 0.5]))
    fx = Bus(dur)
    sfx.fire(dur, fire_pan).mix_into(fx, 1.9)
    sfx.wind(dur).mix_into(fx, 1.2)
    sfx.room(dur).mix_into(fx, 1.0)
    sfx.steps(dur, tl, step_pan).mix_into(fx, 2.2)
    acts23.effects(dur, tl).mix_into(fx, 1.3)
    acts45.effects(dur, tl).mix_into(fx, 1.3)
    fx.L, fx.R = hp(fx.L, 60), hp(fx.R, 60)
    fx = reverb(fx, reverb_ir(0.6, 0.4, seed=11), wet=0.14)
    magic = reverb(sfx.shimmer(dur, tl['notice_s']), reverb_ir(2.8, 0.7, seed=12), wet=0.4)
    # Act I's score, its tail fading into Act II
    a1 = music.score(ACT1 + 1.0, tl)
    fade1 = np.ones(a1.n)
    i0, i1 = int((ACT1 - 0.2) * SR), int((ACT1 + 0.8) * SR)
    fade1[i0:i1] = np.linspace(1, 0, i1 - i0)
    fade1[i1:] = 0
    a1.L *= fade1
    a1.R *= fade1
    mus = Bus(dur)
    mus.add_stereo(a1.L, a1.R)
    acts23.score(dur, tl).mix_into(mus, 1.7)          # (written quieter than Act I's score: level them)
    acts45.score(dur, tl).mix_into(mus, 1.7)
    mus = reverb(mus, reverb_ir(2.6, 0.5, seed=13), wet=0.33)
    ev = tl['ev']
    sec = acts23.sec
    # the room ducks for the wonder in Act I, comes back, and drops away for the pause in Act III
    p0, s0 = sec(ev['refused']), sec(ev['snap'])
    ec = sec(ev['endcard'])
    duck = np.interp(t, [0, tl['notice_s'] - 0.3, tl['notice_s'] + 0.4, ACT1 - 0.2, ACT1 + 0.5, p0 - 0.1, p0 + 0.05,
                         s0, s0 + 0.3, ec - 0.2, ec + 0.6, dur],
                     [1, 1, 0.72, 0.72, 0.9, 0.9, 0.45, 0.45, 0.85, 0.85, 0.2, 0.2])   # the room fades under the end card
    master = Bus(dur)
    master.L = fx.L * duck + mus.L * 0.85 + magic.L
    master.R = fx.R * duck + mus.R * 0.85 + magic.R
    master.L, master.R = hp(master.L, 40, 3), hp(master.R, 40, 3)
    fade = np.minimum(1, t / 0.03) * np.minimum(1, (dur - t) / 0.6)
    master.L *= fade
    master.R *= fade
    for name, b in (('sfx', fx), ('magic', magic), ('music', mus)):
        write_wav(os.path.join(OUT, 'stems', f'film_{name}.wav'), b.stereo(), peak_db=-3)
    print(write_wav(os.path.join(OUT, 'film_audio.wav'), master.stereo(), peak_db=-1.0))


if __name__ == '__main__':
    main()
