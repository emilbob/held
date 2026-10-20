"""Original soundtrack for the commercial, synthesized from the cut's timeline (no samples, no libraries).

A smooth, modern cue at 80 BPM: a soft electric piano (two-operator FM at a low, decaying index, so the tone is round
with no hard edge) over a warm sine bass. Night: Bm9 and Gmaj9, quiet, a gentle arpeggiated pulse. Morning: it opens
to D major with a moving bass and a soft brushed swish on 2 and 4. End card: one long Dmaj9.
Sound: trackpad clicks on the token and on "Pay", a soft tap on the phone when the buyer releases the payment, room tone,
a few distant birds in the morning.
Run: commercial/.venv/bin/python commercial/tools/audio.py   ->  commercial/out/soundtrack.wav
"""
import os, wave
import numpy as np

SR = 48000
FPS = 24
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'out', 'soundtrack.wav')
rng = np.random.default_rng(11)

# the cut (tools/assemble.py CUT), in frames
S1, S2, S3, S4N, S4M, S5, END_F = 120, 120, 120, 84, 84, 168, 72
NIGHT_PASSES = (S1 + S2 + S3 + S4N - 24) / FPS              # the dissolve to morning ends here
S5_AT = S1 + S2 + S3 + S4N - 24 + S4M
END = (S5_AT + S5 - 18) / FPS
DUR = END + END_F / FPS
TOKEN_CLICK = 38 / FPS                                       # s1 frame 39: the click on the pathUSD option
PAY_CLICK = 72 / FPS                                         # s1 frame 73: the click on "Pay"
RELEASE_TAP = (S5_AT + 96) / FPS                             # s5 frame 97: the tap on "I got it: release payment"
BEAT = 60 / 80
BAR = 4 * BEAT

N = int(SR * DUR)
t = np.arange(N) / SR
L = np.zeros(N)
R = np.zeros(N)
MUSIC = (np.zeros(N), np.zeros(N))      # the cue's own bus, so it alone gets the reverb


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def add(sig, at, gain=1.0, pan=0.5, bus=None):
    l, r = bus or (L, R)
    i = int(at * SR)
    if i >= N:
        return
    sig = sig[:N - i]
    l[i:i + len(sig)] += sig * gain * np.cos(pan * np.pi / 2) * 1.414
    r[i:i + len(sig)] += sig * gain * np.sin(pan * np.pi / 2) * 1.414


def ep(note, dur, vel=1.0):
    """Electric piano: FM, modulator at the carrier's frequency, index falling from ~1.3 to 0.15 (bright strike,
    soft body), a slow decay, a rounded 8 ms attack and a gentle tremolo."""
    n = int(dur * SR)
    x = np.arange(n) / SR
    f = midi(note)
    index = (0.15 + 1.15 * vel * np.exp(-x * 4.0))
    v = np.sin(2 * np.pi * f * x + index * np.sin(2 * np.pi * f * x))
    env = np.minimum(1, x / 0.008) * (0.25 * np.exp(-x * 0.9) + 0.75 * np.exp(-x * 2.6))
    rel = np.clip((dur - x) / 0.25, 0, 1)
    return v * env * rel * (1 + 0.07 * np.sin(2 * np.pi * 4.3 * x)) * vel


def bass(note, dur):
    n = int(dur * SR)
    x = np.arange(n) / SR
    f = midi(note)
    v = np.sin(2 * np.pi * f * x) + 0.22 * np.sin(4 * np.pi * f * x)
    return v * np.minimum(1, x / 0.035) * np.clip((dur - x) / 0.3, 0, 1) * (0.6 + 0.4 * np.exp(-x * 1.5))


def brush(dur=0.32):
    """A soft brushed swish: band-limited noise that swells in and fades."""
    n = int(dur * SR)
    v = rng.normal(0, 1, n)
    V = np.fft.rfft(v)
    f = np.fft.rfftfreq(n, 1 / SR)
    V *= np.exp(-((np.log(np.maximum(f, 1)) - np.log(5000)) ** 2) / 0.5)
    v = np.fft.irfft(V, n)
    x = np.arange(n) / SR
    return v / np.abs(v).max() * np.sin(np.pi * x / x[-1]) ** 1.5


def reverb(x, secs=2.2, wet=0.3):
    """Convolution with a synthetic room: decaying noise, darker as it decays."""
    n = int(secs * SR)
    ir = rng.normal(0, 1, n) * np.exp(-np.arange(n) / (0.42 * SR))
    ir = np.convolve(ir, np.ones(40) / 40, 'same')
    ir /= np.sqrt((ir ** 2).sum())
    m = len(x) + n
    y = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[:len(x)]
    return x * (1 - wet) + y * wet


# ---------------------------------------------------------------- the cue
# (bar chord voicing, bass note). Night: Bm9, Gmaj9. Morning: Dmaj9, A/C#, Gmaj9, D/F#.
NIGHT = [([59, 62, 66, 69, 73], 35), ([55, 59, 62, 66, 69], 31)]
MORNING = [([62, 66, 69, 73, 76], 38), ([61, 64, 69, 73, 76], 37), ([55, 59, 62, 66, 69], 31), ([62, 66, 69, 74, 78], 42)]
at = 0.4
bar = 0
while at < END - 0.2:
    morning = at >= NIGHT_PASSES - BEAT
    chord, root = (MORNING if morning else NIGHT)[bar % (4 if morning else 2)]
    lvl = 0.06 if morning else 0.03
    if at < 2.0:
        lvl *= 0.4 + 0.6 * (at - 0.4) / 1.6
    for k, nn in enumerate(chord):                   # the chord, softly rolled
        add(ep(nn, BAR + 0.4, 0.55), at + k * 0.018, lvl * 0.75, pan=0.3 + 0.1 * k, bus=MUSIC)
    for e in range(1, 8):                            # a gentle pulse: chord tones on the eighths, very soft
        nn = chord[[1, 3, 2, 4, 1, 3, 2, 4][e]] + (12 if morning and e % 4 == 3 else 0)
        add(ep(nn, BEAT * 0.9, 0.35), at + e * BEAT / 2, lvl * (0.55 if e % 2 else 0.7), pan=0.25 + 0.5 * (e % 2), bus=MUSIC)
    add(bass(root, BAR), at, 0.10 if morning else 0.06, bus=MUSIC)
    if morning:
        for b in (1, 3):
            add(brush(), at + b * BEAT - 0.08, 0.018, pan=0.55, bus=MUSIC)
    bar += 1
    at += BAR
# end card: one long Dmaj9 and a low D
for k, nn in enumerate([50, 57, 62, 66, 69, 73, 76]):
    add(ep(nn, 3.0, 0.6), END + 0.05 + k * 0.022, 0.07, pan=0.3 + 0.07 * k, bus=MUSIC)
add(bass(38, 3.0), END + 0.05, 0.12, bus=MUSIC)
L += reverb(MUSIC[0])
R += reverb(MUSIC[1])

# ---------------------------------------------------------------- sound
noise = rng.normal(0, 1, N)
fr = np.fft.rfftfreq(N, 1 / SR)
pink = np.fft.irfft(np.fft.rfft(noise) / np.maximum(1, np.sqrt(fr)), N)
pink /= np.abs(pink).max()
band = lambda x, lo, hi: np.fft.irfft(np.fft.rfft(x) * ((fr >= lo) & (fr <= hi)), N)
xf = np.clip((t - NIGHT_PASSES + 1.0) / 1.0, 0, 1)
room = band(pink, 30, 900) * 0.010 * (1 - xf) + band(pink, 60, 4000) * 0.007 * xf
L += room
R += np.roll(room, 240)


def click(at, gain):
    n = int(0.012 * SR)
    c = rng.normal(0, 1, n) * np.exp(-np.arange(n) / (0.0018 * SR))
    add(np.convolve(c, np.ones(6) / 6, 'same'), at, gain)
click(TOKEN_CLICK, 0.05)                             # the trackpad: the token, then Pay
click(TOKEN_CLICK + 0.08, 0.025)
click(PAY_CLICK, 0.08)
click(PAY_CLICK + 0.085, 0.04)


def tap(at, gain):
    """A fingertip on phone glass: a soft, low thump."""
    n = int(0.05 * SR)
    x = np.arange(n) / SR
    add(np.sin(2 * np.pi * 180 * x) * np.exp(-x * 90) + 0.3 * rng.normal(0, 1, n) * np.exp(-x * 400), at, gain)
tap(RELEASE_TAP, 0.07)
for k in range(8):                                   # distant birds, from the moment it is morning
    at = NIGHT_PASSES - 0.6 + k * rng.uniform(0.9, 1.6)
    if at > END - 0.5:
        break
    n = int(rng.uniform(0.08, 0.15) * SR)
    x = np.arange(n) / SR
    f0, f1 = rng.uniform(3200, 4200), rng.uniform(4400, 5600)
    add(np.sin(2 * np.pi * (f0 * x + (f1 - f0) * x * x / (2 * x[-1]))) * np.sin(np.pi * x / x[-1]) ** 2, at, 0.004, pan=rng.uniform(0.2, 0.8))

# ---------------------------------------------------------------- master
fade = np.clip(t / 0.4, 0, 1) * np.clip((DUR - t) / 1.0, 0, 1)
st = np.stack([L, R], axis=1) * fade[:, None]
st = np.tanh(st * 1.6) / 1.6
st *= 10 ** (-1 / 20) / np.abs(st).max()
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with wave.open(OUT, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((st * 32767).astype('<i2').tobytes())
print('ok', OUT, f'{DUR:.2f} s')
