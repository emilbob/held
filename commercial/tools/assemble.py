"""Cut the rendered shots into the commercial: grade, dissolves, end card, soundtrack, H.264.

  commercial/.venv/bin/python commercial/tools/assemble.py --src renders/final --out out/held-commercial.mp4
  commercial/.venv/bin/python commercial/tools/assemble.py --src renders/preview --step 2 --out out/preview.mp4
  commercial/.venv/bin/python commercial/tools/assemble.py --square --out out/held-commercial-square.mp4   (Instagram 1:1)

Frames are piped straight into ffmpeg (no intermediate files). With --step N, each rendered frame is held N times,
so a preview rendered on every other frame plays at the right speed.
"""
import argparse, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
REPO = os.path.normpath(os.path.join(ROOT, '..'))
LOGO = os.path.join(REPO, 'web', 'src', 'assets', 'held-logo.png')
SF = '/System/Library/Fonts/SFNS.ttf'
W, H, FPS = 1920, 1080, 24
BG = (11, 13, 16)          # the app's --bg
INK = (232, 234, 237)      # --ink
MUTED = (139, 147, 163)    # --muted
LIME = (213, 249, 79)      # --lime, the logo's colour

# (shot, first rendered frame, frames used, dissolve into the next shot in frames). s4n → s4m is the night passing:
# the same camera move in two lighting states, so the dissolve is a time-lapse on one frame.
CUT = [('s1', 1, 120, 0), ('s2', 1, 120, 0), ('s3', 1, 120, 0), ('s4n', 1, 84, 24), ('s4m', 61, 84, 0), ('s5', 1, 240, 18)]
FIRST = {shot: first for shot, first, _, _ in CUT}
END_FRAMES = 72
NIGHT = {'s1', 's2', 's3', 's4n'}
# --square: a 1080×1080 window cut from each 1920×1080 frame, centred at x. Through s4 the window drifts left so the
# parcel that arrives overnight (far left of frame) is in it by the morning: (film frame, centre x) keys, eased between.
SQUARE_X = {'s1': [(0, 900)], 's2': [(0, 960)], 's3': [(0, 960)], 's4n': [(360, 900), (444, 580)],
            's4m': [(360, 900), (444, 580)], 's5': [(0, 960)]}


def font(px, wght):
    f = ImageFont.truetype(SF, px)
    f.set_variation_by_axes([100, 28, 400, wght])
    return f


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


class Grade:
    """Lens vignette and a faint dither on every shot; at night also a gentle S-curve, cooler shadows and slightly
    calmer oranges, so the lamp's pool of warm light sits in a cooler room."""
    def __init__(self, w):
        yy, xx = np.mgrid[0:H, 0:w].astype(np.float32)
        r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / np.sqrt(2)
        self.vig = (1.0 - 0.22 * r ** 2.4)[..., None]
        self.rng = np.random.default_rng(3)

    def __call__(self, a, night=False):
        a = a.astype(np.float32)
        if night:
            x = a / 255.0
            lum = x @ np.array([0.2126, 0.7152, 0.0722], np.float32)
            x = lum[..., None] + (x - lum[..., None]) * 0.88                                 # calm the saturation
            x = x + 0.10 * (x - x * x) * (2 * x - 1) * 2                                      # S-curve
            shadow = np.clip(1 - lum / 0.35, 0, 1)[..., None]
            x = x + shadow * np.array([-0.012, -0.002, 0.020], np.float32)                     # cool the shadows
            a = np.clip(x, 0, 1) * 255.0
        a = a * self.vig
        a = a + self.rng.normal(0, 0.6, a.shape[:2] + (1,)).astype(np.float32)  # faint dither against banding; visible grain read as noise
        return np.clip(a, 0, 255)


def load(src, shot, i, step):
    """The shot's i-th frame in the cut (1-based); with a stepped preview, the nearest rendered frame at or before it."""
    j = FIRST[shot] + ((i - 1) // step) * step
    p = os.path.join(src, shot, f'f_{j:04d}.png')
    im = Image.open(p).convert('RGB')
    if im.size != (W, H):
        im = im.resize((W, H), Image.LANCZOS)
    return np.asarray(im)


def square_x(shot, f):
    keys = SQUARE_X[shot]
    if len(keys) == 1:
        return keys[0][1]
    (f0, x0), (f1, x1) = keys
    return x0 + (x1 - x0) * ease((f - f0) / (f1 - f0))


def end_card(t, W=W):
    """Held end card at time t (s) into it: mark and wordmark, then the line, then what it is and where."""
    im = Image.new('RGB', (W, H), BG)
    logo = Image.open(LOGO).convert('RGBA')
    lh = 104
    logo = logo.resize((round(logo.width * lh / logo.height), lh), Image.LANCZOS)
    f_word = font(118, 800)
    d = ImageDraw.Draw(im)
    word_w = d.textlength('Held', font=f_word) - 0.02 * 118 * 3       # letter-spacing -0.02em, as in the app header
    gap = 26
    total = logo.width + gap + word_w
    x0 = (W - total) / 2
    cy = 410

    def put(layer_fn, alpha, dy):
        layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        layer_fn(layer, dy)
        r, g, b, a = layer.split()
        a = a.point(lambda v: int(v * alpha))
        layer.putalpha(a)
        im.paste(layer, (0, 0), layer)

    a1 = ease(t / 0.7)
    dy1 = 10 * (1 - a1)

    def mark(layer, dy):
        layer.paste(logo, (int(x0), int(cy - lh / 2 + dy)), logo)
        dd = ImageDraw.Draw(layer)
        x = x0 + logo.width + gap
        for ch in 'Held':
            dd.text((x, cy + dy + 6), ch, font=f_word, fill=(*INK, 255), anchor='lm')
            x += dd.textlength(ch, font=f_word) - 0.02 * 118
    put(mark, a1, dy1)
    a2 = ease((t - 0.55) / 0.6)
    put(lambda L, dy: ImageDraw.Draw(L).text((W / 2, 560 + dy), 'Pay with confidence.', font=font(60, 650), fill=(*INK, 255), anchor='mm'),
        a2, 8 * (1 - a2))
    a3 = ease((t - 0.95) / 0.6)
    put(lambda L, dy: ImageDraw.Draw(L).text((W / 2, 640 + dy), 'Buyer protection for stablecoin payments.', font=font(34, 450),
                                             fill=(*MUTED, 255), anchor='mm'), a3, 6 * (1 - a3))
    put(lambda L, dy: ImageDraw.Draw(L).text((W / 2, 712 + dy), 'getheld.xyz', font=font(34, 600), fill=(*LIME, 255), anchor='mm'),
        a3, 6 * (1 - a3))
    return np.asarray(im).astype(np.float32)


def frames(src, step):
    """Yield, per film frame, the shot layers visible in it: (shot, frame within shot, shot start, shot length)."""
    timeline = []
    t = 0
    for shot, _, n, dissolve in CUT:
        timeline.append((shot, t, n))
        t += n - dissolve
    timeline.append(('end', t, END_FRAMES))
    total = t + END_FRAMES
    for f in range(total):
        layers = []
        for shot, start, n in timeline:
            if start <= f < start + n:
                layers.append((shot, f - start, start, n))
        yield f, layers, timeline, total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', default=os.path.join(ROOT, 'renders', 'final'))
    ap.add_argument('--step', type=int, default=1)
    ap.add_argument('--out', default=os.path.join(ROOT, 'out', 'held-commercial.mp4'))
    ap.add_argument('--audio', default=os.path.join(ROOT, 'out', 'soundtrack.wav'))
    ap.add_argument('--square', action='store_true', help='1080×1080 for Instagram, cropped per SQUARE_X')
    ap.add_argument('--stills', help='write these film frames (comma list) as JPEGs next to --out instead of encoding')
    a = ap.parse_args()
    src = a.src if os.path.isabs(a.src) else os.path.join(ROOT, a.src)
    out = a.out if os.path.isabs(a.out) else os.path.join(ROOT, a.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    ow = H if a.square else W
    grade = Grade(ow)
    want = set(int(x) for x in a.stills.split(',')) if a.stills else None
    ff = None
    if not want:
        cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{ow}x{H}', '-r', str(FPS), '-i', '-']
        if os.path.exists(a.audio):
            cmd += ['-i', a.audio, '-c:a', 'aac', '-b:a', '256k', '-shortest']
        cmd += ['-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
                '-tune', 'film', '-movflags', '+faststart', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', out]
        ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = 0
    for f, layers, timeline, total in frames(src, a.step):
        if want is not None and f not in want:
            continue
        acc = None
        for shot, i, start, length in layers:
            if shot == 'end':
                img = end_card(i / FPS, ow)
            else:
                img = load(src, shot, i + 1, a.step)
                if a.square:
                    x0 = int(round(square_x(shot, f) - H / 2))
                    img = img[:, x0:x0 + H]
                img = grade(img, night=shot in NIGHT)
            # dissolve: an incoming shot fades over the outgoing one during the overlap
            prev = [l for l in timeline if l[1] < start and l[1] + l[2] > start]
            w = ease((i + 1) / (prev[0][1] + prev[0][2] - start + 1)) if prev else 1.0
            acc = img if acc is None else acc * (1 - w) + img * w
        frame = Image.fromarray(acc.astype(np.uint8))
        if want is not None:
            frame.save(out.replace('.mp4', f'_{f:04d}.jpg'), quality=92)
        else:
            ff.stdin.write(frame.tobytes())
        n += 1
    if ff:
        ff.stdin.close()
        ff.wait()
    print(f'{n} frames ({n / FPS:.2f} s) ->', out)


main()
