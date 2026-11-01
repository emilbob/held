"""Small DSP toolkit for the film's sound: everything is synthesized here (no samples, no libraries beyond numpy/scipy)."""
import json, os, wave
import numpy as np
from scipy import signal

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'out'))


def timeline():
    with open(os.path.join(OUT, 'timeline.json')) as f:
        return json.load(f)


def rng(seed):
    return np.random.default_rng(seed)


def t_axis(dur):
    return np.arange(int(dur * SR)) / SR


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def lp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'low', fs=SR, output='sos'), x)


def hp(x, f, order=2):
    return signal.sosfilt(signal.butter(order, f, 'high', fs=SR, output='sos'), x)


def bp(x, f0, f1, order=2):
    return signal.sosfilt(signal.butter(order, (f0, f1), 'band', fs=SR, output='sos'), x)


def resonator(x, f, q):
    """Two-pole resonant band-pass (a struck body's mode)."""
    b, a = signal.iirpeak(f, q, fs=SR)
    return signal.lfilter(b, a, x)


def pink(n, r):
    """Pink-ish noise: white noise shaped by -3 dB/oct in the frequency domain."""
    w = r.standard_normal(n)
    W = np.fft.rfft(w)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    p = np.fft.irfft(W / np.sqrt(f), n)
    return p / (np.abs(p).max() + 1e-9)


def smooth_noise(n, rate_hz, r):
    """A slowly wandering control signal in [-1, 1] (low-passed noise)."""
    k = max(2, int(n * rate_hz / SR) + 2)
    pts = r.uniform(-1, 1, k)
    x = np.interp(np.linspace(0, k - 1, n), np.arange(k), pts)
    return lp(x, max(rate_hz, 0.05), 1)


def adsr(n, a, d, s, r_, sustain_len=None):
    """Envelope with times in seconds; sustain_len (s) fixes when the release starts (default: end - release)."""
    A, D, R = int(a * SR), int(d * SR), int(r_ * SR)
    S = (n - A - D - R) if sustain_len is None else int(sustain_len * SR)
    S = max(S, 0)
    env = np.concatenate([np.linspace(0, 1, max(A, 1)), np.linspace(1, s, max(D, 1)), np.full(S, s), np.linspace(s, 0, max(R, 1))])
    if len(env) < n:
        env = np.concatenate([env, np.zeros(n - len(env))])
    return env[:n]


def pan_gains(p):
    """Equal-power pan, p in [0, 1] (0 = left)."""
    return np.cos(p * np.pi / 2), np.sin(p * np.pi / 2)


class Bus:
    """A stereo buffer with add-at-time, constant or moving pan."""

    def __init__(self, dur):
        self.n = int(dur * SR)
        self.L = np.zeros(self.n)
        self.R = np.zeros(self.n)

    def add(self, sig, at=0.0, gain=1.0, pan=0.5):
        i = int(round(at * SR))
        if i >= self.n or len(sig) == 0:
            return
        if i < 0:
            sig = sig[-i:]
            i = 0
        sig = sig[:self.n - i] * gain
        if np.ndim(pan) == 0:
            gl, gr = pan_gains(pan)
        else:
            p = np.asarray(pan)[i:i + len(sig)]
            gl, gr = pan_gains(p)
        self.L[i:i + len(sig)] += sig * gl
        self.R[i:i + len(sig)] += sig * gr

    def add_stereo(self, l, r, at=0.0, gain=1.0):
        i = int(round(at * SR))
        m = min(len(l), self.n - i)
        self.L[i:i + m] += l[:m] * gain
        self.R[i:i + m] += r[:m] * gain

    def mix_into(self, other, gain=1.0):
        other.L += self.L * gain
        other.R += self.R * gain

    def stereo(self):
        return np.stack([self.L, self.R])


def reverb_ir(seconds=2.2, bright=0.5, seed=3, predelay=0.012):
    """A synthetic stereo hall impulse response: decorrelated noise, exponentially decaying, darkening over time
    (the high end dies faster), with a few sparse early reflections."""
    r = rng(seed)
    n = int(seconds * SR)
    t = np.arange(n) / SR
    out = []
    for ch in range(2):
        noise = r.standard_normal(n)
        lo = lp(noise, 2500 + 4000 * bright, 2)
        hi = noise - lo
        env_lo = np.exp(-t * 6.9 / seconds)
        env_hi = np.exp(-t * 6.9 / (seconds * 0.35))
        ir = lo * env_lo + hi * env_hi * 0.5
        ir *= np.minimum(1, t / 0.03)                     # soft onset of the diffuse tail
        for k in range(6):                                # early reflections
            d = int(r.uniform(0.007, 0.05) * SR)
            ir[d] += r.uniform(0.3, 0.7) * (1 if r.random() > 0.5 else -1)
        pd = int(predelay * SR)
        ir = np.concatenate([np.zeros(pd), ir])
        out.append(ir / np.sqrt(np.sum(ir ** 2)))
    return out


def reverb(bus, ir, wet=0.3):
    l = signal.fftconvolve(bus.L, ir[0])[:bus.n]
    r = signal.fftconvolve(bus.R, ir[1])[:bus.n]
    out = Bus(bus.n / SR)
    out.L = bus.L * (1 - wet) + l * wet
    out.R = bus.R * (1 - wet) + r * wet
    return out


def soft_limit(x, ceiling=0.89):
    return ceiling * np.tanh(x / ceiling)


def write_wav(path, stereo, peak_db=-1.0):
    x = stereo / (np.abs(stereo).max() + 1e-9) * 10 ** (peak_db / 20)
    x = soft_limit(x, 10 ** (peak_db / 20) * 1.02)
    pcm = (np.clip(x.T, -1, 1) * 32767).astype('<i2')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    return path
