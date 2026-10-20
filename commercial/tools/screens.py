"""Screen image sequences for the film, from the real payment flow captured in capture/flow/ (capture/flow.mjs).

The page pixels are the live site's, untouched. Around them this adds only device chrome: on the laptop the macOS
menu bar (with the display's notch) and a Safari-style toolbar showing the real URL; on the phone a status bar and the
mobile browser's URL bar. Held is a website opened in a browser, and the film shows it that way.

Each shot gets one sequence per device (textures/seq/<shot>-<device>/f_####.png, one per film frame) that follows the
capture's real timing; where the app animates a change, the slow-motion capture plays at true speed. Identical frames are symlinks to one image in
textures/frames/, so a sequence costs only its distinct images.
Run: commercial/.venv/bin/python commercial/tools/screens.py
"""
import json, os, shutil
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FLOW = os.path.join(HERE, '..', 'capture', 'flow')
TEX = os.path.join(HERE, '..', 'textures')
FRAMES = os.path.join(TEX, 'frames')
SEQ = os.path.join(TEX, 'seq')
SF = '/System/Library/Fonts/SFNS.ttf'
INK = (232, 234, 237)     # the app's ink #e8eaed
DIM = (139, 147, 163)     # the app's grey #8b93a3
FIELD = (44, 47, 53)
FPS = 24
IDX = json.load(open(os.path.join(FLOW, 'index.json')))
T = {f['name']: f['t'] for f in IDX['frames']}


def font(px, weight=500):
    f = ImageFont.truetype(SF, px)
    f.set_variation_by_axes([100, 28, 400, weight])   # width, optical size, grade, weight
    return f


def lock(d, x, y, s, fill):
    """Padlock glyph, s = body height."""
    d.rounded_rectangle([x, y + s * 0.45, x + s * 0.8, y + s * 1.1], radius=s * 0.12, fill=fill)
    d.arc([x + s * 0.14, y, x + s * 0.66, y + s * 0.9], 180, 360, fill=fill, width=max(2, int(s * 0.13)))


def cursor(img, x, y, s=2):
    """Standard arrow pointer, black with a white outline, tip at (x, y)."""
    pts = [(0, 0), (0, 17), (4, 13), (7, 20), (9.5, 19), (6.5, 12), (12, 12)]
    ImageDraw.Draw(img).polygon([(x + px * s * 1.6, y + py * s * 1.6) for px, py in pts], fill=(0, 0, 0), outline=(255, 255, 255), width=int(2 * s))


def wifi(d, x, y, s, fill, bg):
    for r in (11, 7.5, 4):
        d.pieslice([x - r * s, y - r * s, x + r * s, y + r * s], 225, 315, fill=fill)
        if r > 4:
            rr = r - 2.2
            d.pieslice([x - rr * s, y - rr * s, x + rr * s, y + rr * s], 225, 315, fill=bg)


def battery(d, x, y, s, level=0.7):
    d.rounded_rectangle([x, y, x + 25 * s, y + 12 * s], radius=3.5 * s, outline=(150, 150, 150), width=s)
    d.rounded_rectangle([x + 2 * s, y + 2 * s, x + 2 * s + 21 * s * level, y + 10 * s], radius=2 * s, fill=(255, 255, 255))
    d.rounded_rectangle([x + 26 * s, y + 4 * s, x + 27.5 * s, y + 8 * s], radius=s, fill=(150, 150, 150))


# ---------------------------------------------------------------- laptop: MacBook Pro 14" display, 3024 × 1964

def laptop(name, clock, pointer=None):
    """The capture (1512 × 930 pt @2x) under a macOS menu bar (37 pt, notch) and a Safari toolbar (52 pt)."""
    s = 2
    page = Image.open(os.path.join(FLOW, name + '.png')).convert('RGB')
    W, H = 1512 * s, 982 * s
    mb, tb = 37 * s, 52 * s
    img = Image.new('RGB', (W, H), (0, 0, 0))
    img.paste(page.crop((0, 0, W, H - mb - tb)), (0, mb + tb))
    d = ImageDraw.Draw(img)
    # menu bar (dark mode)
    d.rectangle([0, 0, W, mb], fill=(24, 24, 26))
    x = 20 * s
    for i, item in enumerate(['Safari', 'File', 'Edit', 'View', 'History', 'Bookmarks', 'Window', 'Help']):
        f = font(13 * s, 700 if i == 0 else 500)
        d.text((x, mb / 2), item, font=f, fill=(255, 255, 255), anchor='lm')
        x += d.textlength(item, font=f) + 20 * s
    f = font(13 * s, 500)
    d.text((W - 20 * s, mb / 2), clock, font=f, fill=(255, 255, 255), anchor='rm')
    cw = d.textlength(clock, font=f)
    battery(d, W - 20 * s - cw - 48 * s, mb / 2 - 6 * s, s)
    wifi(d, W - 20 * s - cw - 72 * s, mb / 2 + 5 * s, s * 0.9, (255, 255, 255), (24, 24, 26))
    # the notch: 190 × 32 pt, centred, rounded at the bottom
    nw, nh = 190 * s, 32 * s
    d.rounded_rectangle([(W - nw) / 2, -20 * s, (W + nw) / 2, nh], radius=10 * s, fill=(0, 0, 0))
    # Safari toolbar (dark)
    y0 = mb
    d.rectangle([0, y0, W, y0 + tb], fill=(38, 38, 41))
    d.line([(0, y0 + tb - 1), (W, y0 + tb - 1)], fill=(12, 12, 14), width=2)
    for i, c in enumerate([(236, 95, 87), (245, 190, 79), (98, 197, 84)]):      # window controls
        cx = 22 * s + i * 20 * s
        d.ellipse([cx - 6 * s, y0 + tb / 2 - 6 * s, cx + 6 * s, y0 + tb / 2 + 6 * s], fill=c)
    d.rounded_rectangle([96 * s, y0 + tb / 2 - 7 * s, 114 * s, y0 + tb / 2 + 7 * s], radius=3 * s, outline=DIM, width=s)   # sidebar
    d.line([(102 * s, y0 + tb / 2 - 7 * s), (102 * s, y0 + tb / 2 + 7 * s)], fill=DIM, width=s)
    for i, ch in enumerate(['‹', '›']):
        d.text((140 * s + i * 30 * s, y0 + tb / 2 - 2 * s), ch, font=font(26 * s, 400), fill=INK if not i else DIM, anchor='mm')
    w = 560 * s
    fx = (W - w) / 2
    d.rounded_rectangle([fx, y0 + 10 * s, fx + w, y0 + tb - 10 * s], radius=8 * s, fill=FIELD)
    f = font(14 * s, 500)
    tw = d.textlength('getheld.xyz', font=f)
    lock(d, W / 2 - tw / 2 - 18 * s, y0 + tb / 2 - 7 * s, 12 * s, DIM)
    d.text((W / 2 + 4 * s, y0 + tb / 2), 'getheld.xyz', font=f, fill=INK, anchor='mm')
    d.text((W - 60 * s, y0 + tb / 2), '+', font=font(20 * s, 400), fill=DIM, anchor='mm')
    tx, ty = W - 32 * s, y0 + tb / 2                                              # tab overview: two squares
    d.rounded_rectangle([tx - 5 * s, ty - 7 * s, tx + 7 * s, ty + 5 * s], radius=2 * s, outline=DIM, width=s)
    d.rounded_rectangle([tx - 8 * s, ty - 4 * s, tx + 4 * s, ty + 8 * s], radius=2 * s, outline=DIM, width=s, fill=(38, 38, 41))
    if pointer:
        cursor(img, pointer[0] * s, (pointer[1] + 37 + 52) * s, s)
    # the display's rounded top corners
    mask = Image.new('L', (W, H), 255)
    md = ImageDraw.Draw(mask)
    md.rectangle([0, 0, W, 40 * s], fill=0)
    md.rounded_rectangle([0, 0, W - 1, H + 40 * s], radius=10 * s, fill=255)
    return Image.composite(img, Image.new('RGB', (W, H), (0, 0, 0)), mask)


# ---------------------------------------------------------------- phone: 1179 × 2556

def phone(name, clock):
    s = 3
    page = Image.open(os.path.join(FLOW, name + '.png')).convert('RGB')
    W, H = 393 * s, 852 * s
    status, bottom = 54 * s, 82 * s
    img = Image.new('RGB', (W, H), (11, 13, 16))
    img.paste(page.crop((0, 0, W, H - status - bottom)), (0, status))
    d = ImageDraw.Draw(img)
    bar = (18, 21, 26)          # the page header's colour, as the browser tints the status bar
    d.rectangle([0, 0, W, status], fill=bar)
    d.text((52 * s, 30 * s), clock, font=font(17 * s, 600), fill=(255, 255, 255), anchor='mm')
    bx = 300 * s
    for i in range(4):
        h = (4 + i * 2.6) * s
        d.rounded_rectangle([bx + i * 5 * s, 35 * s - h, bx + i * 5 * s + 3 * s, 35 * s], radius=s, fill=(255, 255, 255))
    wifi(d, 334 * s, 36 * s, s, (255, 255, 255), bar)
    battery(d, 352 * s, 24.5 * s, s)
    y0 = H - bottom
    d.rectangle([0, y0, W, H], fill=(24, 26, 30))
    d.rounded_rectangle([14 * s, y0 + 8 * s, W - 14 * s, y0 + 52 * s], radius=14 * s, fill=FIELD)
    f = font(16 * s, 500)
    tw = d.textlength('getheld.xyz', font=f)
    lock(d, W / 2 - tw / 2 - 18 * s, y0 + 23 * s, 13 * s, DIM)
    d.text((W / 2 + 4 * s, y0 + 30 * s), 'getheld.xyz', font=f, fill=INK, anchor='mm')
    d.rounded_rectangle([W / 2 - 67 * s, H - 9 * s, W / 2 + 67 * s, H - 4 * s], radius=3 * s, fill=(240, 240, 240))  # home indicator
    mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, H - 1], radius=47 * s, fill=255)     # the display's corners
    return Image.composite(img, Image.new('RGB', (W, H), (0, 0, 0)), mask)


# ---------------------------------------------------------------- sequences

made = {}


def frame_file(device, name, clock, pointer=None):
    key = (device, name, clock, tuple(round(p) for p in pointer) if pointer else None)
    if key not in made:
        fn = f'{device}-{name}-{clock.replace(":", "").replace(" ", "")}' + (f'-p{key[3][0]}x{key[3][1]}' if pointer else '') + '.png'
        im = laptop(name, clock, pointer) if device == 'laptop' else phone(name, clock)
        im.save(os.path.join(FRAMES, fn))
        made[key] = fn
    return made[key]


def write_seq(shot, device, per_frame):
    """per_frame: list over film frames of (capture name, clock, pointer)."""
    d = os.path.join(SEQ, f'{shot}-{device}')
    os.makedirs(d, exist_ok=True)
    for i, spec in enumerate(per_frame, 1):
        os.symlink(os.path.join('..', '..', 'frames', frame_file(device, *spec)), os.path.join(d, f'f_{i:04d}.png'))


def ease(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


PTR = {f['name']: f.get('pointer') for f in IDX['frames']}


def family(*prefixes):
    """Capture frames whose names start with any of the prefixes, in capture order."""
    return sorted((n for n in T if n.startswith(prefixes)), key=lambda n: T[n])


def realtime(names, n_frames, start=None, speed=1.0):
    """Play capture frames at their real capture times (optionally faster), from `start` or the first one."""
    t0 = T[start or names[0]]
    return [max((n for n in names if T[n] <= t0 + i * speed / FPS), key=lambda n: T[n], default=names[0]) for i in range(n_frames)]


def with_pointer(names, glide=8):
    """Each frame's pointer is where the real mouse was for that capture; where it moved between captures, it glides
    there over the `glide` frames before the change."""
    out = []
    for i, n in enumerate(names):
        p = PTR.get(n)
        for j in range(1, glide + 1):
            if i + j < len(names) and PTR.get(names[i + j]) != p and PTR.get(names[i + j]) and p:
                q = PTR[names[i + j]]
                k = ease(1 - (j - 1) / glide)
                p = (p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k)
                break
        out.append((n, p))
    return out


META = {f['name']: f for f in IDX['frames']}


def transition(prefix, n_wait, n_after):
    """A slow-motion capture (flow.mjs slowShots): the wait before the status changes ("Sending…", "Confirming…": only a
    dimmed button, so it is compressed into n_wait frames), then the change itself (the label decoding into place,
    the badge's pulse) at true speed, by the page's own animation clock."""
    fs = [META[n] for n in family(prefix)]
    wait = [f['name'] for f in fs if not f['done']]
    after = [f for f in fs if f['done']]
    out = [wait[min(len(wait) - 1, i * len(wait) // n_wait)] for i in range(n_wait)]
    v0 = after[0]['vt']
    for i in range(n_after):
        out.append(max((f for f in after if f['vt'] - v0 <= i * 1000 / FPS), key=lambda f: f['vt'])['name'])
    return out


def glide(a, b, n):
    return [(a[0] + (b[0] - a[0]) * ease(i / (n - 1)), a[1] + (b[1] - a[1]) * ease(i / (n - 1))) for i in range(n)]


shutil.rmtree(SEQ, ignore_errors=True)
shutil.rmtree(FRAMES, ignore_errors=True)
os.makedirs(FRAMES)
TOKEN = IDX['tokenButton']
PAY = IDX['payButton']
REST, AT_TOKEN, AT_PAY = (1150, 300), (TOKEN['cx'], TOKEN['cy']), (PAY['cx'] + 40, PAY['cy'])
MAC = 'Tue 20 Oct  23:41'
LAP = lambda seq: [(n, MAC, p) for n, p in seq]
PHN = lambda names, clock: [(n, clock, None) for n in names]

# s1 (120 f): the checkout link opens ("Creating your protected order…"); the pointer goes to the pathUSD option
# (hover, click), then to "Pay $64.00" (hover, click at f73); "Sending…" (the testnet confirmation's wait, compressed),
# then the page turns to held and "Held: protected" decodes into place. The phone beside it is asleep.
s1 = [(n, REST) for n in realtime(family('L_open_'), 15)]
s1 += [('L_awaiting', p) for p in [REST] * 2 + glide(REST, AT_TOKEN, 15)]
s1 += [('L_hover_token', AT_TOKEN)] * 6
s1 += [('L_token_chosen', p) for p in [AT_TOKEN] * 6 + glide(AT_TOKEN, AT_PAY, 20)]
s1 += [('L_hover', AT_PAY)] * (72 - len(s1))
s1 += [(n, AT_PAY) for n in transition('L_pay_', 26, 120 - len(s1) - 26)]
write_seq('s1', 'laptop', LAP(s1))
# s2 (120 f): the phone, held, the countdown ticking; two seconds in, a short scroll brings up the wallet and the
# buttons. The laptop behind it ticks along. (The phone's page polls a beat slower than the laptop's: its first
# 'held' capture, P_held_00, can still show the awaiting page.)
phone_held = family('P_held_', 'P_scroll_')
write_seq('s2', 'phone', PHN(realtime(phone_held, 120, start='P_held_01'), '23:42'))
laptop_held = family('L_held_')
write_seq('s2', 'laptop', LAP(with_pointer(realtime(laptop_held, 120, start='L_held_01'))))
# s3 (120 f): the laptop, held, the next five seconds: the pointer drifts onto "I got it: release payment" and rests
# there (the button's real hover state). Not yet: the parcel hasn't arrived.
write_seq('s3', 'laptop', LAP(with_pointer(realtime(laptop_held, 120, start='L_held_05'))))
write_seq('s3', 'phone', PHN(realtime(phone_held, 120, start='P_held_06'), '23:42'))
# s4n (84 f): the desk at night, wide; on the laptop the pointer backs off the button. (s4m, the same frame next
# morning: the laptop asleep and the phone dark, so no sequences.)
write_seq('s4n', 'laptop', LAP(with_pointer(realtime(laptop_held, 84, start='L_held_10'))))
# s5 (168 f, morning): the phone wakes at f62 (see shots.py) on the order, still held; at f97 the buyer taps
# "I got it: release payment": "Confirming…" (the wait compressed), then "Paid to merchant" decodes into place and
# "Delivery confirmed".
s5p = realtime(phone_held, 96, start='P_held_07')
s5p += transition('P_rel_', 30, 168 - 96 - 30)
write_seq('s5', 'phone', PHN(s5p, '08:17'))
print('ok', len(made), 'distinct screens,', sum(len(os.listdir(os.path.join(SEQ, d))) for d in os.listdir(SEQ)), 'frames')
