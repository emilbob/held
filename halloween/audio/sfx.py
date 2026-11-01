"""Scene 01 sound effects, synthesized from the picture's timeline.

fire()      soft roar + crackles and the odd pop, panned where the fireplace sits in frame
wind()      gusting wind behind the glass (muffled), with a faint whistle and leaves skittering on each gust
room()      room tone and the mantel clock's quiet tick
steps()     the pumpkin's small wooden footfalls, one per landing frame in the timeline
shimmer()   the moment it notices the lantern: a soft rising air, then a cascade of glassy chimes
"""
import numpy as np
from dsp import SR, Bus, rng, t_axis, lp, hp, bp, resonator, pink, smooth_noise, adsr, midi


def fire(dur, pan_curve):
    r = rng(1)
    n = int(dur * SR)
    t = t_axis(dur)
    bus = Bus(dur)
    # the roar: band-limited pink noise breathing slowly
    roar = bp(pink(n, r), 90, 900, 2)
    breathe = 0.75 + 0.25 * smooth_noise(n, 1.5, r)
    roar *= breathe
    bus.add(roar * 0.22, 0, pan=pan_curve)
    # crackles: Poisson-timed tiny bursts of bright noise, a few louder ones, and two or three resonant pops
    rate = 11.0
    k = 0.0
    while True:
        k += r.exponential(1 / rate)
        if k >= dur:
            break
        ln = int(r.uniform(0.0015, 0.008) * SR)
        burst = r.standard_normal(ln) * np.exp(-np.arange(ln) / (ln * 0.25))
        burst = hp(burst, r.uniform(1500, 4000), 2)
        amp = r.lognormal(-1.3, 0.7)
        # clusters: a crackle often brings a quick second
        bus.add(burst * amp * 0.5, k, pan=float(np.clip(pan_curve[min(int(k * SR), n - 1)] + r.uniform(-0.08, 0.08), 0, 1)))
        if r.random() < 0.3:
            bus.add(burst[::-1] * amp * 0.3, k + r.uniform(0.01, 0.03), pan=float(pan_curve[min(int(k * SR), n - 1)]))
    for k in r.uniform(0.3, dur - 0.3, 3):
        ln = int(0.06 * SR)
        x = r.standard_normal(ln) * np.exp(-np.arange(ln) / (0.006 * SR))
        pop = resonator(x, r.uniform(250, 600), 6) * 0.6 + hp(x, 2000) * 0.3
        bus.add(pop * 0.45, k, pan=float(pan_curve[int(k * SR)]))
    return bus


def wind(dur):
    r = rng(2)
    n = int(dur * SR)
    bus = Bus(dur)
    gust = 0.55 + 0.45 * smooth_noise(n, 0.6, r)
    gust = np.clip(gust, 0.1, 1.0) ** 1.5
    for ch, seed in ((0, 21), (1, 22)):                  # decorrelated left/right
        rr = rng(seed)
        base = pink(n, rr)
        # the band moves up with the gust strength
        lo = lp(base, 700, 2)
        hi = bp(base, 600, 2200, 2)
        sig = lo * (0.6 + 0.4 * gust) + hi * gust * 0.6
        sig = lp(sig, 1800, 2) * gust                     # muffled by the glass
        if ch == 0:
            bus.L += sig * 0.25
        else:
            bus.R += sig * 0.25
    # a faint whistle on the strongest gusts (narrow resonance around a wandering pitch)
    f = 650 + 120 * smooth_noise(n, 0.4, r)
    ph = np.cumsum(2 * np.pi * f / SR)
    wh = np.sin(ph) * (r.standard_normal(n) * 0.3 + 1) * np.clip(gust - 0.55, 0, 1) ** 2
    bus.add(lp(wh, 1200) * 0.05, 0, pan=0.25)            # the window is on the left of the room
    # leaves skittering past the window on each gust: soft, dry, high bursts
    k = 0.0
    while k < dur:
        k += r.exponential(0.25)
        g = gust[min(int(k * SR), n - 1)]
        if r.random() > g:
            continue
        ln = int(r.uniform(0.02, 0.08) * SR)
        x = bp(r.standard_normal(ln), 2500, 7000) * np.hanning(ln) ** 2
        bus.add(lp(x, 4000) * 0.05 * g, k, pan=r.uniform(0.1, 0.4))
    return bus


def room(dur):
    r = rng(3)
    n = int(dur * SR)
    bus = Bus(dur)
    tone = lp(pink(n, r), 300, 2)
    bus.add(tone * 0.03, 0, pan=0.5)
    # the mantel clock: tick-tock once a second, very quiet, slightly different pitches
    for i, k in enumerate(np.arange(0.35, dur, 1.0)):
        ln = int(0.05 * SR)
        x = r.standard_normal(ln) * np.exp(-np.arange(ln) / (0.0015 * SR))
        tick = resonator(x, 3100 if i % 2 else 2700, 12) * 0.4 + resonator(x, 1250, 8) * 0.3
        bus.add(tick * 0.03, k, pan=0.55)
    return bus


def footstep(r, soft=1.0):
    """A tiny foot on old floorboards: a soft felt-like impact, the board's hollow knock (two damped modes), and the
    pumpkin's own body thump — light, round, never a click."""
    ln = int(0.18 * SR)
    t = np.arange(ln) / SR
    imp = r.standard_normal(ln) * np.exp(-t / 0.002)
    imp = lp(imp, 3500, 2)
    knock = resonator(imp, r.uniform(420, 520), 9) * 0.7 + resonator(imp, r.uniform(900, 1100), 14) * 0.35
    thump = np.sin(2 * np.pi * r.uniform(150, 175) * t) * np.exp(-t / 0.035) * 0.35   # hollow pumpkin body
    tap = hp(imp, 2000) * 0.08
    x = (knock + thump + tap) * soft
    return lp(x, 5000) * np.minimum(1, t / 0.0008)


def steps(dur, tl, pan_of_time):
    r = rng(4)
    bus = Bus(dur)
    times = tl['steps_s']
    for i, s in enumerate(times):
        soft = 0.75 + 0.25 * r.random()
        if i == len(times) - 1:
            soft *= 0.7                                    # the last step is a careful stop
        bus.add(footstep(r, soft) * 0.5, s, pan=pan_of_time(s))
    return bus


def chime(f, dur=2.4, bright=1.0, r=None):
    """A small glass/metal chime: inharmonic partials, the upper ones dying fast."""
    t = t_axis(dur)
    partials = ((1.0, 1.0, 1.0), (2.76, 0.35 * bright, 3.0), (5.40, 0.18 * bright, 6.0), (8.93, 0.08 * bright, 10.0))
    x = sum(a * np.sin(2 * np.pi * f * k * t + (r.uniform(0, 6) if r is not None else 0)) * np.exp(-t * d) for k, a, d in partials)
    return x * np.exp(-t * 1.6) * np.minimum(1, t / 0.002)


def shimmer(dur, at):
    """The notice: 0.5 s of soft air rising into it, then a quick upward cascade of chimes (a D major add9 spread)
    and a warm low bloom under it as the lantern swells."""
    r = rng(5)
    bus = Bus(dur)
    # rising air
    ln = int(0.9 * SR)
    t = np.arange(ln) / SR
    air = r.standard_normal(ln)
    air = bp(air, 1500, 9000, 2) * (t / t[-1]) ** 2.5 * np.exp(-np.maximum(0, t - 0.6) * 9)
    bus.add(air * 0.07, at - 0.6, pan=0.4)
    # cascade
    notes = [81, 86, 88, 90, 93, 98]                       # A5 D6 E6 F#6 A6 D7
    for i, nt in enumerate(notes):
        bus.add(chime(midi(nt), 2.6, 1.0, r) * 0.11 * (1 - i * 0.07), at + i * 0.055 + r.uniform(0, 0.01), pan=0.3 + 0.07 * i)
    # a second, softer sprinkle as the eyes brighten
    for i, nt in enumerate([93, 90, 98, 95]):
        bus.add(chime(midi(nt), 2.0, 0.7, r) * 0.05, at + 0.55 + i * 0.12, pan=0.65 - 0.08 * i)
    # warm bloom: low sine pair swelling with the lantern
    ln = int(2.2 * SR)
    t = np.arange(ln) / SR
    bloom = (np.sin(2 * np.pi * midi(50) * t) + 0.5 * np.sin(2 * np.pi * midi(57) * t)) * adsr(ln, 0.5, 0.3, 0.7, 1.2)
    bus.add(lp(bloom, 600) * 0.05, at - 0.15, pan=0.4)
    return bus
