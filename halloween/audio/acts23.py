"""Acts II–III sound (6–19 s): effects and music, placed on the beats in timeline.EV (via out/timeline.json).

Effects: two hop landings, trackpad clicks and the checkout's confirm tone, the candle's flare, the ghost rising (air),
its giggle (breathy, formant-filtered), the whoosh as it turns to go, the hiss of it dissolving, the badge's ping, the
snap back (a reversed rush and a cloth thump), its sigh.
Music: Act II mischief (staccato pizzicato in D minor, a reedy low line), a stab as the ghost leaves; Act III suspense
(tremolo strings), a full stop at the pause, low strings slumping and rising, then the three-note Held signature
(D5 G5 A5, warm electronic bells) over a soft D add9 pad — it resolves in the finale.
"""
import numpy as np
from dsp import SR, Bus, rng, t_axis, lp, hp, bp, resonator, adsr, midi, smooth_noise
import sfx, music


def sec(f):
    return (f - 1) / 24


# ---------------------------------------------------------------- effects

def click(r, soft=1.0):
    """A trackpad click: a tiny plastic tick and its body."""
    ln = int(0.04 * SR)
    t = np.arange(ln) / SR
    x = r.standard_normal(ln) * np.exp(-t / 0.0012)
    tick = resonator(hp(x, 1800), 3300, 10) * 0.5 + resonator(x, 900, 6) * 0.3
    return tick * soft


def tone(f, dur=0.5, vel=0.5):
    """A soft interface tone: sine with a little second harmonic, quick attack, smooth decay."""
    t = t_axis(dur)
    x = np.sin(2 * np.pi * f * t) + 0.18 * np.sin(4 * np.pi * f * t)
    return x * np.exp(-t * 6) * np.minimum(1, t / 0.004) * vel


def sweep(r, dur, f0, f1, q=1.2):
    """Noise through a band-pass whose centre glides from f0 to f1 (an air rush). State-variable filter."""
    n = int(dur * SR)
    x = r.standard_normal(n)
    fc = np.geomspace(f0, f1, n)
    y = np.zeros(n)
    low = band = 0.0
    damp = 1.0 / q
    for i in range(n):
        f = 2 * np.sin(np.pi * fc[i] / SR)
        low += f * band
        high = x[i] - low - damp * band
        band += f * high
        y[i] = band
    return y / (np.abs(y).max() + 1e-9)


def whoosh(r, dur, f0, f1, rise=0.3):
    t = t_axis(dur)
    env = np.minimum(1, t / (dur * rise)) * np.minimum(1, (dur - t) / (dur * (1 - rise)))
    return sweep(r, dur, f0, f1) * env ** 1.5


def giggle(r, n=4, start_f=420):
    """A ghost's breathy giggle: 'heh-heh-heh', each a short voiced puff (a buzzy pulse plus breath) through vowel
    formants, falling in pitch; soft, not cartoon."""
    out = np.zeros(int((n * 0.13 + 0.25) * SR))
    for k in range(n):
        dur = 0.095
        t = t_axis(dur)
        f0 = start_f * (1 - 0.06 * k) * (1 + 0.04 * np.sin(2 * np.pi * 7 * t))
        ph = np.cumsum(2 * np.pi * f0 / SR)
        buzz = np.sign(np.sin(ph)) * 0.3 + np.sin(ph)
        breath = r.standard_normal(len(t)) * 0.9
        src = buzz * 0.35 + breath
        v = resonator(src, 560, 6) + 0.7 * resonator(src, 1700, 9) + 0.25 * resonator(src, 2600, 12)
        env = np.sin(np.pi * np.minimum(1, t / dur)) ** 1.4
        i = int(k * 0.13 * SR)
        out[i:i + len(t)] += v * env
    return lp(out / (np.abs(out).max() + 1e-9), 3500)


def sigh(r, dur=0.9):
    """A long breathy exhale, falling."""
    t = t_axis(dur)
    x = r.standard_normal(len(t))
    v = resonator(x, 520, 5) * np.interp(t, [0, dur], [1, 0.6]) + 0.6 * resonator(x, 1100, 7)
    env = np.minimum(1, t / 0.15) * np.exp(-np.maximum(0, t - 0.25) * 3.2)
    return lp(v * env, 2400) / 6


def thump(r):
    """A soft cloth thump: low body and a little flap of fabric."""
    t = t_axis(0.35)
    body = np.sin(2 * np.pi * (85 - 30 * t) * t) * np.exp(-t / 0.08)
    flap = lp(r.standard_normal(len(t)), 1500) * np.exp(-t / 0.03) * 0.5
    return body + flap


def buzz(r, dur=0.5):
    """A phone's refusal buzz: two short low vibrations."""
    t = t_axis(dur)
    env = ((t < 0.16) | ((t > 0.24) & (t < 0.40))).astype(float)
    env = lp(env, 60)
    x = np.sin(2 * np.pi * 150 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 37 * t))
    return lp(x * env, 900)


def effects(dur, tl):
    ev = tl['ev']
    r = rng(31)
    bus = Bus(dur)
    for (a, b) in ev['hops']:                                         # the hops' landings
        bus.add(sfx.footstep(r, 0.9) * 0.5, sec(b), pan=0.48)
    for f in (ev['tap1'], ev['tap2']):
        bus.add(click(r), sec(f), 0.5, pan=0.5)
    bus.add(tone(midi(81), 0.35, 0.4), sec(ev['tap1']) + 0.06, 0.25, 0.52)                       # the checkout opens
    s2 = sec(ev['tap2']) + 0.08
    bus.add(tone(midi(81), 0.5, 0.45), s2, 0.3, 0.52)                                           # paid and held: A5 → D6
    bus.add(tone(midi(86), 0.8, 0.45), s2 + 0.11, 0.3, 0.52)
    bus.add(lp(whoosh(r, 0.6, 200, 900), 1200) * 0.05, sec(ev['tap2']) + 0.02, pan=0.5)         # the candle flares
    # the ghost: rising air; its phone floats up; the tap; the giggle; the whoosh as it turns; the hiss of dissolving
    a, b = ev['rise']
    bus.add(whoosh(r, sec(b) - sec(a) + 0.3, 300, 1400, rise=0.7) * 0.05, sec(a), pan=0.62)
    a, b = ev['phone_up']
    bus.add(lp(whoosh(r, sec(b) - sec(a) + 0.2, 600, 2200, rise=0.6), 2500) * 0.03, sec(a), pan=0.6)
    bus.add(click(r, 0.7), sec(ev['tap_early']), 0.45, pan=0.6)
    bus.add(giggle(r) * 0.07, sec(ev['glee'][0]) + 0.05, pan=0.6)
    bus.add(whoosh(r, 0.7, 2500, 500, rise=0.25) * 0.09, sec(ev['leave']), pan=0.6)
    rf = sec(ev['refused'])
    hiss = whoosh(r, rf - sec(ev['leave']) - 0.1, 1500, 5000, rise=0.85)
    bus.add(hp(hiss, 1200) * 0.04, sec(ev['leave']) + 0.2, pan=0.6)
    # refused: the phone buzzes, a low falling two-note
    bus.add(buzz(r) * 0.18, rf, pan=0.55)
    bus.add(tone(midi(69), 0.5, 0.45), rf + 0.05, 0.25, 0.55)
    bus.add(tone(midi(62), 0.9, 0.45), rf + 0.2, 0.25, 0.55)
    # snap back: a reversed rush into a thump
    rush = whoosh(r, 0.35, 5000, 400, rise=0.9)
    bus.add(rush * 0.08, sec(ev['snap']) - 0.3, pan=0.6)
    bus.add(thump(r) * 0.3, sec(ev['snap']) + 0.04, pan=0.6)
    bus.add(sigh(r) * 0.5, sec(ev['sag'][0]) + 0.1, pan=0.58)
    bus.add(lp(whoosh(r, 0.9, 400, 1800, rise=0.4), 2000) * 0.04, sec(ev['turn_go'][0]), pan=0.65)   # it floats off
    return bus


# ---------------------------------------------------------------- music

def reed(note, dur, vel=0.5):
    """A soft, reedy low line (bassoon-ish): band-limited square, filtered, with breathy attack."""
    t = t_axis(dur)
    f = midi(note)
    ph = 2 * np.pi * f * t * (1 + 0.003 * np.sin(2 * np.pi * 5 * t))
    x = sum(np.sin(k * ph) / k for k in range(1, 14, 2) if f * k < 5000)
    x = lp(x, 900 + 600 * vel, 2)
    return x * adsr(len(t), 0.03, 0.08, 0.7, 0.12) * vel


def signature(at, bus, gain=0.24):
    """Held's three-note signature: D5 G5 A5, warm electronic bells (sine + soft FM), the last one held."""
    for k, (nt, d) in enumerate(((74, 0.5), (79, 0.5), (81, 1.6))):
        t = t_axis(d + 0.8)
        f = midi(nt)
        mod = np.sin(2 * np.pi * f * 2 * t) * 1.2 * np.exp(-t * 4)
        x = np.sin(2 * np.pi * f * t + mod) * np.exp(-t * (1.6 if k < 2 else 0.9)) * np.minimum(1, t / 0.006)
        bus.add(x, at + k * 0.2, gain, 0.45 + 0.05 * k)


def score(dur, tl):
    ev = tl['ev']
    r = rng(17)
    bus = Bus(dur)
    beat = 8 / 24
    a2 = tl['acts']['2'][0]
    s0 = sec(a2)
    t1, t2 = sec(ev['tap1']), sec(ev['tap2'])
    rise = sec(ev['rise'][0])
    # Act II, the purchase: curious and warm. Dm under the shop, Bbmaj7 under the checkout, an open D add9 once held.
    bus.add(music.strings([50, 57, 62, 65], t1 - s0 + 0.3, attack=0.4, release=0.8, seed=21, bright=1300), s0, 0.22, 0.5)
    bus.add(music.strings([46, 53, 57, 62], t2 - t1 + 0.3, attack=0.5, release=0.8, seed=27, bright=1300), t1, 0.22, 0.5)
    bus.add(music.strings([50, 57, 62, 64, 69], rise - t2 + 0.6, attack=0.5, release=1.0, seed=28, bright=1600), t2, 0.2,
            0.5)
    for i, nt in enumerate([62, 65, 69, 67, 65, 64]):
        bus.add(music.pizz(nt, 0.8, 0.5, r), s0 + 0.05 + i * beat, 0.45, 0.45 + 0.04 * (i % 3))
    for i, nt in enumerate([65, 69, 70, 69, 67, 65]):                     # the checkout: the line climbs
        bus.add(music.pizz(nt, 0.8, 0.45, r), t1 + 0.4 + i * beat * 1.5, 0.4, 0.5 + 0.04 * (i % 2))
    bus.add(music.celesta(86, 2.0, 0.35, r), t1 + 0.1, 0.25, 0.55)
    bus.add(music.celesta(86, 2.0, 0.35, r) + music.celesta(90, 2.0, 0.3, r), t2 + 0.25, 0.3, 0.55)
    # the trick: a sneaky staccato line, low reed answering, twice (rise, then the phone)
    for t0 in (rise, sec(ev['phone_up'][1])):
        sneak = [50, 53, 52, 57, 50, 53, 56, 57, 58, 57, 56, 55]          # D F E A | D F G# A | Bb A G# G
        for i, nt in enumerate(sneak):
            bus.add(music.pizz(nt, 0.6, 0.6, r), t0 + i * beat * 0.75, 0.48, 0.4 + 0.05 * (i % 2))
        for k, (nt, d) in enumerate(((38, 0.45), (41, 0.45), (40, 0.45), (45, 0.9))):
            bus.add(reed(nt, d, 0.55), t0 + 0.75 + k * beat * 1.5, 0.33, 0.55)
    bus.add(music.pizz(69, 0.8, 0.7, r) + music.pizz(74, 0.8, 0.6, r), sec(ev['tap_early']) + 0.02, 0.45)
    # the stab as it turns to slip away
    stab = sec(ev['leave'])
    bus.add(music.strings([38, 50, 53, 57, 62], 0.35, attack=0.01, release=0.3, seed=22, vel=0.8, bright=2600), stab, 0.45)
    bus.add(music.piano(38, 2.0, 0.6, r) + music.piano(50, 2.0, 0.5, r), stab, 0.4)
    # Act III: tremolo suspense under the dissolve, cut dead by the refusal
    a = sec(ev['attempt'][0]) - 0.3
    p = sec(ev['refused'])
    trem = music.strings([69, 74, 75], p - a, attack=0.5, release=0.05, seed=23, vel=0.5, bright=3000)
    tt = np.arange(len(trem)) / SR
    trem *= 0.6 + 0.4 * np.sin(2 * np.pi * 11 * tt)
    trem[int((p - a) * SR):] = 0
    bus.add(trem, a, 0.3, 0.5)
    # Held's signature on the refusal, over a soft open pad until the snap
    sg = sec(ev['signature'])
    sn = sec(ev['snap'])
    bus.add(music.strings([50, 57, 62, 64, 69], sn - sg + 0.2, attack=0.5, release=0.6, seed=26, bright=1800), sg, 0.18)
    signature(sg, bus)
    # the snap: a low hit; slump and resolve: low strings sinking, then rising
    bus.add(music.piano(26, 2.5, 0.7, r) + music.piano(38, 2.5, 0.5, r), sn + 0.02, 0.45)
    rs = sec(ev['resolve'][0])
    bus.add(music.strings([45, 52, 57, 60], rs - sn, attack=0.6, release=0.4, seed=24, bright=900), sn + 0.4, 0.3, 0.5)
    end3 = tl['acts']['3'][1] / 24
    bus.add(music.strings([47, 54, 59, 62], end3 - rs + 0.3, attack=0.4, release=0.5, seed=25, bright=1300), rs, 0.28, 0.5)
    return bus
