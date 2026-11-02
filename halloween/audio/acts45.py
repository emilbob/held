"""Acts IV–V sound (19–30 s), on the beats in timeline.EV.

Effects: three knocks at the door (off right), the ghost's air as it floats in, the package set down (a hollow
cardboard thud), the pumpkin's hops, the twine whisking off, the lid lifting (a papery scrape), four cardboard walls
flopping open, the lantern's reveal (a warm cascade), the trackpad click and the release chime, the ghost's soft
laugh at the end.
Music: the knock cuts Act III's pad; a curious pizzicato as the ghost comes in; a warm D-major swell on the reveal
(strings, piano, celesta); a gentle resolution for the two of them by the lantern, with bells; and Held's signature
(D5 G5 A5) resolving onto a full D major chord as the end card comes up.
"""
import numpy as np
from dsp import SR, Bus, rng, t_axis, lp, hp, resonator, adsr, midi
import sfx, music, acts23
from acts23 import sec, click, tone, whoosh, giggle, thump


def knock(r):
    """A knuckle on a wooden door: a short hard impact through the door panel's modes."""
    ln = int(0.25 * SR)
    t = np.arange(ln) / SR
    imp = r.standard_normal(ln) * np.exp(-t / 0.0015)
    door = resonator(imp, r.uniform(180, 200), 7) * 0.8 + resonator(imp, r.uniform(420, 460), 10) * 0.45 + \
        resonator(imp, 950, 14) * 0.2
    return lp(door + hp(imp, 2500) * 0.05, 4000)


def cardboard(r, soft=1.0):
    """A hollow cardboard thud (a box set down, a wall flopping flat)."""
    ln = int(0.3 * SR)
    t = np.arange(ln) / SR
    imp = lp(r.standard_normal(ln), 2500) * np.exp(-t / 0.004)
    box = resonator(imp, r.uniform(140, 170), 5) * 0.7 + resonator(imp, r.uniform(380, 450), 8) * 0.35
    rustle = hp(r.standard_normal(ln), 2500) * np.exp(-t / 0.03) * 0.08
    return (box + rustle) * soft


def paper(r, dur=0.35):
    """Paper/cardboard sliding: band-limited crackly noise."""
    t = t_axis(dur)
    x = r.standard_normal(len(t)) * (0.5 + 0.5 * (r.random(len(t)) < 0.02) * 6)
    return lp(hp(x, 1500), 7000) * np.sin(np.pi * t / dur) ** 1.5 * 0.2


def cascade(at, bus, notes, gain=0.1, step=0.07, r=None):
    for i, nt in enumerate(notes):
        bus.add(sfx.chime(midi(nt), 2.6, 0.8, r) * (1 - i * 0.06), at + i * step, gain, 0.35 + 0.06 * i)


def effects(dur, tl):
    ev = tl['ev']
    r = rng(41)
    bus = Bus(dur)
    for f in ev['knocks']:
        bus.add(knock(r), sec(f), 0.35, pan=0.85)
    a, b = ev['enter']
    bus.add(whoosh(r, sec(b) - sec(a), 350, 1200, rise=0.5) * 0.045, sec(a), pan=0.75)
    bus.add(cardboard(r) * 0.5, sec(ev['set_down'][1]), pan=0.62)
    for (a, b) in [ev['hop_pkg'], ev['hop_back']] + list(ev['hops_v']):
        bus.add(sfx.footstep(r, 0.85) * 0.5, sec(b), pan=0.5)
    bus.add(sfx.footstep(r, 0.6) * 0.4, sec(ev['joy'][1]), pan=0.5)
    a, b = ev['twine']
    bus.add(hp(whoosh(r, sec(b) - sec(a), 1800, 5000, rise=0.3), 1500) * 0.05, sec(a), pan=0.6)
    bus.add(paper(r, 0.5), sec(ev['lid'][0]), 0.6, pan=0.6)
    a, b = ev['walls']
    for k in range(4):
        bus.add(paper(r, 0.25), sec(a + k) + 0.02, 0.4, pan=0.45 + 0.1 * k)
        bus.add(cardboard(r, 0.6) * 0.35, sec(b + k - 1), pan=0.45 + 0.1 * k)
    cascade(sec(ev['walls'][1]) + 0.05, bus, [74, 78, 81, 86, 90, 93], gain=0.09, r=r)       # D F# A D F# A: the reveal
    bus.add(click(r), sec(ev['confirm']), 0.5, pan=0.5)
    s = sec(ev['confirm']) + 0.08
    for k, nt in enumerate((81, 86, 90)):                                             # A5 D6 F#6: released
        bus.add(tone(midi(nt), 0.9, 0.45), s + k * 0.1, 0.3, 0.5)
    laugh = giggle(r, n=5, start_f=330)
    bus.add(laugh * 0.05, sec(ev['settle'][0]) + 0.1, pan=0.62)
    return bus


def score(dur, tl):
    ev = tl['ev']
    r = rng(51)
    bus = Bus(dur)
    beat = 8 / 24
    # the ghost floats in: curious pizzicato, D mixolydian, light
    a = sec(ev['enter'][0])
    for i, nt in enumerate([62, 66, 69, 67, 66, 64, 62, 60, 62]):
        bus.add(music.pizz(nt, 0.7, 0.5, r), a + i * beat * 0.75, 0.42, 0.45 + 0.04 * (i % 3))
    bus.add(music.strings([50, 57, 62], sec(ev['walls'][0]) - a, attack=0.6, release=0.6, seed=31, bright=1200), a, 0.18)
    # the reveal: a warm D major swell, piano and celesta
    rv = sec(ev['walls'][1])
    bus.add(music.strings([38, 50, 57, 62, 66, 69, 74], sec(ev['turn_ghost'][0]) - rv + 0.6, attack=0.7, release=1.0,
                          seed=32, bright=2600), rv - 0.3, 0.32)
    bus.add(music.piano(38, 3.0, 0.5, r) + music.piano(50, 3.0, 0.4, r), rv, 0.45)
    for k, nt in enumerate((74, 78, 81, 86)):
        bus.add(music.celesta(nt, 2.2, 0.45, r), rv + 0.35 + k * beat * 0.5, 0.45, 0.6)
    # Act V: a gentle resolution with bells — G major, then back home
    v = sec(ev['turn_ghost'][0])
    bus.add(music.strings([43, 55, 62, 66, 71], 1.8, attack=0.6, release=0.8, seed=33, bright=2000), v, 0.26)
    bus.add(music.strings([45, 57, 61, 64, 69], 1.6, attack=0.5, release=0.8, seed=34, bright=2000), v + 1.8, 0.26)
    mel = [(74, 0.0), (76, 0.5), (78, 1.0), (81, 1.6), (79, 2.4), (78, 2.9)]          # D E F# A G F#
    for nt, t0 in mel:
        bus.add(music.piano(nt, 2.0, 0.42, r), v + 0.2 + t0, 0.36, 0.55)
    for k, nt in enumerate((86, 90, 93)):                                             # bells as it settles
        bus.add(sfx.chime(midi(nt), 2.4, 0.7, r), sec(ev['settle'][0]) + k * 0.16, 0.05, 0.5 + 0.08 * k)
    # the end card: the signature, resolving onto D major
    ec = sec(ev['endcard'])
    acts23.signature(ec - 0.45, bus, gain=0.26)
    bus.add(music.strings([38, 50, 57, 62, 66, 69, 74], dur - ec + 0.2, attack=0.35, release=1.2, seed=35, bright=2400),
            ec + 0.15, 0.3)
    bus.add(music.piano(38, 3.0, 0.55, r) + music.piano(62, 3.0, 0.4, r) + music.piano(66, 3.0, 0.38, r) +
            music.piano(69, 3.0, 0.38, r), ec + 0.17, 0.4)
    return bus
