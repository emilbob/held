"""Parcel artwork: the shipping label (fictional addresses, generic carrier layout) and the Held print on its side.
Run: commercial/.venv/bin/python commercial/tools/label.py
"""
import os, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'textures', 'label.png')
W, H = 1200, 800          # 15 × 10 cm at 8 px/mm
SF = '/System/Library/Fonts/SFNS.ttf'
MONO = '/System/Library/Fonts/SFNSMono.ttf'


def font(path, px, wght=None):
    f = ImageFont.truetype(path, px)
    if wght:
        try:
            f.set_variation_by_axes([100, 28, 400, wght])
        except Exception:
            pass
    return f


rnd = random.Random(7)
img = Image.new('RGB', (W, H), (246, 244, 238))
d = ImageDraw.Draw(img)
ink = (24, 24, 26)
d.rectangle([14, 14, W - 14, H - 14], outline=ink, width=5)
d.line([(14, 250), (W - 14, 250)], fill=ink, width=4)
d.line([(14, 520), (W - 14, 520)], fill=ink, width=4)
d.text((40, 36), 'FROM', font=font(SF, 26, 600), fill=ink)
d.multiline_text((40, 72), 'Sandbox Shop\nUnit 4, 21 Foundry Row\nLeeds LS1 4PQ', font=font(SF, 38, 500), fill=ink, spacing=8)
d.rectangle([860, 40, W - 40, 220], fill=ink)
d.text(((860 + W - 40) / 2, 130), 'P2', font=font(SF, 120, 800), fill=(246, 244, 238), anchor='mm')
d.text((40, 268), 'SHIP TO', font=font(SF, 26, 600), fill=ink)
d.multiline_text((40, 306), 'M. Okafor\n9 Linden Court, Flat 3\nYork YO1 7HZ', font=font(SF, 50, 600), fill=ink, spacing=10)
# barcode
x = 40
while x < W - 60:
    w = rnd.choice([3, 3, 5, 7, 9])
    d.rectangle([x, 545, x + w, 700], fill=ink)
    x += w + rnd.choice([3, 4, 6, 8])
d.text((W / 2, 735), '4R 1180 6612 0947 GB', font=font(MONO, 34), fill=ink, anchor='mm')
img = img.filter(ImageFilter.GaussianBlur(0.6))   # thermal print softness
img.save(OUT)
print('ok', OUT)

# Box print: the Held lockup as printed on the parcel's side (transparent background; the shader inks it).
# Mark in the brand lime, wordmark in near-black ink, as two-colour flexo print on kraft board.
LOGO = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'web', 'src', 'assets', 'held-logo.png')
mark = Image.open(LOGO).convert('RGBA')
lh = 300
mark = mark.resize((round(mark.width * lh / mark.height), lh), Image.LANCZOS)
fw = font(SF, 330, 800)
probe = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
ww = sum(probe.textlength(c, font=fw) - 0.02 * 330 for c in 'Held')
P = Image.new('RGBA', (int(mark.width + 70 + ww + 40), 420), (0, 0, 0, 0))
P.paste(mark, (20, 60), mark)
d = ImageDraw.Draw(P)
x = mark.width + 70
for c in 'Held':
    d.text((x, 210 + 14), c, font=fw, fill=(20, 20, 22, 255), anchor='lm')
    x += d.textlength(c, font=fw) - 0.02 * 330
out = os.path.join(os.path.dirname(OUT), 'box_print.png')
P.save(out)
print('ok', out, P.size)
