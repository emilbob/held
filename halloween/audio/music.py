"""Scene 01 score: soft felt piano, celesta, pizzicato strings and a string pad. Original, synthesized.

The tempo is locked to the pumpkin's trot: one footfall every 7 frames = an eighth note at 102.86 BPM, so the
pizzicato lands on its steps. Harmony: D dorian, mysterious but warm.
  0.0 s  Dm9 pad breathes in; a low piano D; the celesta asks a question (A5 C6 B5 ... G5)
  2.0 s  the trot: pizzicato on every step, climbing (Bbmaj7 → Gm9 at the 5th step)
  4.0 s  it stops: the pad thins to an A7sus, a held breath
  4.46 s it notices the lantern: D major add9 opens up; piano bell tones and a celesta answer
"""
import numpy as np
from dsp import SR, Bus, rng, t_axis, lp, hp, resonator, adsr, midi

EIGHTH = 7 / 24                                   # seconds: one trot step
QUARTER = 2 * EIGHTH


def piano(note, dur=3.0, vel=0.6, r=None):
    """Felt piano: stretched partials, velocity-dependent brightness, two-stage decay, two slightly detuned strings,
    a soft felt thud; then a gentle low-pass for the felt."""
    r = r or rng(note)
    t = t_axis(dur)
    f0 = midi(note)
    B = 0.00035
    x = np.zeros_like(t)
    for detune in (-0.6, 0.6):
        f = f0 * 2 ** (detune / 1200)
        for k in range(1, 16):
            fk = f * k * np.sqrt(1 + B * k * k)
            if fk > 9000:
                break
            amp = (1 / k ** 1.4) * (vel ** (0.4 * k))
            d_fast, d_slow = 3.0 + 0.9 * k, 0.45 + 0.12 * k
            env = 0.6 * np.exp(-t * d_fast) + 0.4 * np.exp(-t * d_slow)
            x += amp * env * np.sin(2 * np.pi * fk * t + r.uniform(0, 6.28))
    thud = lp(r.standard_normal(len(t)) * np.exp(-t / 0.004), 700) * 0.15
    x = x * np.minimum(1, t / 0.004) + thud
    return lp(x, 2200 + 2500 * vel) * vel


def celesta(note, dur=2.2, vel=0.6, r=None):
    r = r or rng(note + 300)
    t = t_axis(dur)
    f = midi(note)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t * 1.9)
         + 0.22 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 4.0)
         + 0.07 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 8.0)
         + 0.10 * np.sin(2 * np.pi * 5.4 * f * t) * np.exp(-t * 18.0))     # the bar's bright strike
    click = hp(r.standard_normal(len(t)) * np.exp(-t / 0.0007), 3000) * 0.05
    return (x * np.minimum(1, t / 0.0015) + click) * vel


def pizz(note, dur=1.0, vel=0.6, r=None):
    """Pizzicato string: Karplus-Strong pluck with a soft, low-passed excitation and a wooden body resonance."""
    r = r or rng(note + 600)
    n = int(dur * SR)
    f = midi(note)
    N = int(SR / f)
    frac = SR / f - N
    buf = lp(r.uniform(-1, 1, N + 2), 1200 + 2000 * vel, 1)[:N + 1]
    out = np.zeros(n)
    decay = 0.996 - 0.0009 * (note - 50) / 12
    for i in range(n):
        y = buf[i % (N + 1)]
        out[i] = y
        nxt = buf[(i + 1) % (N + 1)]
        buf[i % (N + 1)] = decay * ((1 - frac) * 0.5 * (y + nxt) + frac * y)
    t = np.arange(n) / SR
    body = resonator(out, 280, 3) * 0.3 + resonator(out, 520, 4) * 0.2
    x = (out + body) * np.exp(-t * 3.2) * np.minimum(1, t / 0.002)
    return lp(x, 3500) * vel


def strings(notes, dur, attack=0.7, release=1.2, vel=0.5, seed=0, bright=1800):
    """String pad: per note an ensemble of five detuned saws with gentle vibrato, low-passed, slow swell."""
    r = rng(seed)
    t = t_axis(dur + release)
    x = np.zeros_like(t)
    for nt in notes:
        for v in range(5):
            cents = r.uniform(-9, 9)
            f = midi(nt) * 2 ** (cents / 1200)
            vib = 1 + 0.0035 * np.sin(2 * np.pi * r.uniform(4.6, 5.6) * t + r.uniform(0, 6)) * np.minimum(1, t / 0.8)
            ph = np.cumsum(2 * np.pi * f * vib / SR) + r.uniform(0, 6)
            saw = sum(np.sin(k * ph) / k for k in range(1, 12) if f * k < 7000)
            x += saw
    x = lp(x, bright, 2) / (len(notes) * 5)
    return x * adsr(len(t), attack, 0.2, 0.9, release, sustain_len=max(0, dur - attack - 0.2))


def score(dur, tl):
    r = rng(7)
    bus = Bus(dur)
    steps = tl['steps_s']
    notice = tl['notice_s']
    # --- the room: Dm9 pad and a low piano D
    bus.add(strings([50, 57, 60, 64, 65], steps[0] + 0.6, attack=1.1, release=0.9, seed=1), 0.0, 0.32, 0.5)
    bus.add(piano(38, 4.0, 0.35, r) + piano(45, 4.0, 0.3, r), 0.05, 0.5, 0.45)
    # celesta question: A5 C6 B5 . G5 (quarters, the last one held)
    for i, (nt, k) in enumerate(((81, 1), (84, 2), (83, 3), (79, 4.5))):
        bus.add(celesta(nt, 2.2, 0.5, r), 0.15 + k * QUARTER * 0.62, 0.55, 0.62)
    # --- the trot: Bbmaj7 then Gm9 under pizzicato on every step
    bus.add(strings([46, 53, 57, 62], steps[4] - steps[0] + 0.2, attack=0.35, release=0.5, seed=2, vel=0.5), steps[0] - 0.1, 0.24, 0.5)
    bus.add(strings([43, 50, 53, 57, 58], steps[-1] - steps[4] + 0.6, attack=0.3, release=0.5, seed=3), steps[4] - 0.05, 0.24, 0.5)
    line = [62, 65, 69, 65, 67, 70, 74, 72]               # D4 F4 A4 F4 | G4 Bb4 D5 C5: tiptoeing upwards
    for i, s in enumerate(steps):
        nt = line[i % len(line)]
        bus.add(pizz(nt, 1.0, 0.55 + 0.05 * (i % 2), r), s, 0.62, 0.42 + 0.03 * (i % 3))
        if i in (0, 4):
            bus.add(pizz(nt - 24 + (0 if i == 0 else -3), 1.4, 0.7, r), s, 0.5, 0.45)      # bass on the changes
    bus.add(piano(58, 2.5, 0.3, r) + piano(62, 2.5, 0.28, r), steps[0], 0.35, 0.55)
    # --- the stop: a held breath (A7sus4 thin pad)
    bus.add(strings([57, 62, 64, 67], notice - steps[-1] + 0.5, attack=0.25, release=0.45, seed=4, vel=0.4, bright=1400),
            steps[-1] + 0.05, 0.2, 0.5)
    # --- wonder: D major add9 opens; piano bells; the celesta answers the opening question, resolved
    bus.add(strings([50, 57, 62, 66, 69, 76], dur - notice + 0.2, attack=0.6, release=1.5, seed=5, bright=2400), notice - 0.05, 0.34, 0.5)
    bus.add(piano(38, 3.0, 0.4, r), notice, 0.5, 0.45)
    for k, nt in enumerate((74, 78, 81)):
        bus.add(piano(nt, 3.0, 0.42, r), notice + 0.02 + k * 0.03, 0.3, 0.58)
    for k, nt in enumerate((78, 81, 83, 86)):             # F#5 A5 B5 D6
        bus.add(celesta(nt, 2.2, 0.45, r), notice + 0.75 + k * EIGHTH, 0.5, 0.65)
    return bus
