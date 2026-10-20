# Held — "Until it arrives" (30 s commercial)

A photoreal 3D commercial for Held, built in code with Blender (Cycles) and Python, rendered on an Apple M4 (Metal GPU).
Everything here is self-contained; nothing in the app (`web/`, `server/`, `contracts/`) was changed.

**Status:** see [What was actually completed](#what-was-actually-completed).

## The film

Both sides of one sale, cross-cut: the **buyer** in their living room (the phone) and the **seller** in their studio
(the shop's dashboard on a laptop). No captions: the screens tell it. Every page on them is the live site, recorded
during one real sale.

| # | Time | Where | What the screen shows |
|---|---|---|---|
| b1 | 0–4.5 s | Buyer, night, the phone on the coffee table | The checkout link opens ("Creating your protected order…"), a scroll down to **Pay $64.00**, the tap, **Sending…**, **Held: protected** decodes into place |
| s2 | 4.5–9.5 s | Seller, night, the dashboard | The order arrives, **Held: protected**. The pointer clicks **Try to pay yourself early** → **🔒 This wallet is not allowed to do that.** |
| s3 | 9.5–12.5 s | Seller, night | The parcel, packed: the Held print on its side, the label on top, the dashboard behind it |
| b4 | 12.5–18.5 s | Buyer, night → morning | The living room, wide, the phone glowing on the table; the same frame dissolves into the next morning, the parcel on the table |
| b6 | 18.5–24.5 s | Buyer, morning | Close on the parcel; the camera rises to the phone as it wakes: **I got it: release payment** → **Confirming…** → **Paid to merchant**, **Delivery confirmed** |
| s7 | 24.5–27.5 s | Seller, morning | **Paid to merchant** · **you received $63.36 (Held's fee $0.64)** |
| — | 27.5–30 s | End card | Held · **Pay with confidence.** · Buyer protection for stablecoin payments. · getheld.xyz |

### Where the film follows the product rather than the brief

- **The UI is the live site, not a mock-up.** `capture/twosides.mjs` makes one real sale in the public Sandbox Shop
  (Tempo testnet, test funds): seller and buyer in separate browsers. The seller's dashboard is captured at a 14"
  laptop's viewport (1512×930 @2x), the buyer's page at a phone's visible page area (393×716 @3x). Every state is
  screenshotted as it happens, with its time (`capture/flow/index.json`). The app animates status changes (labels decode
  into place, badges pulse, buttons fade in); to catch those frame by frame, the capture runs the page's clock
  (`performance.now`, `requestAnimationFrame`, `Date.now`, CSS animations) at 1/10 speed around each change and records
  each shot's page time, so `tools/screens.py` plays them back at true speed. The app's code and the chain are untouched;
  the waits for the chain ("Sending…", "Confirming…", the dashboard's next poll) are compressed. The page pixels are used
  as captured; around them `tools/screens.py` adds only device chrome (the macOS menu bar with the notch and a
  Safari-style toolbar showing `getheld.xyz`; a phone status bar and URL bar) and draws the seller's pointer, which a
  screenshot never contains. The pages say "Tempo testnet", "Sandbox Shop" and "test wallet in this browser" because
  that is what the live site shows today. The run removes its checkout links from the shared Sandbox Shop when it ends.
- **"Try to pay yourself early"** is the sandbox's real test button: the merchant's own wallet calls `release` on the
  arbiter inside the protection window and the contract refuses it.
- **Release is the buyer's act, not automatic.** The buyer presses "I got it: release payment"; only then does the
  seller see "Paid to merchant". Held does not verify delivery and the film never implies it does.
- **The parcel carries the story between the two homes:** packed on the seller's desk at night, on the buyer's table
  in the morning. The Held print on the box is the commercial's branding (Held is the payment layer, not the shop).
- **The laptop is styled on a MacBook Pro 14"** (proportions, notch, keyboard layout) without the Apple logo.
- **Known liberties:** the sandbox's protection window is 5 minutes, so the countdowns read "4:5x left" in a story
  that spans a night (a real shop's default is 7 days). In the seller's night shot the small "window closes in" figure
  jumps from 4:59 to 4:43 as the pointer reaches the button (that hover was recorded after the slow-motion window).

## Layout

```
capture/twosides.mjs     one real sandbox sale, seller and buyer, recorded state by state → capture/flow/*.png + index.json
tools/screens.py         per-shot screen sequences (chrome, pointer, real timing) → textures/seq/<shot>-<device>/
tools/label.py           the parcel's shipping label (fictional addresses) and Held print → textures/
tools/fetch_assets.py    CC0 models/textures/HDRIs → assets/ (+ assets/CREDITS.md)
blender/scene.py         the seller's studio and the buyer's living room: furniture, laptop, phone, parcel, lamp, light
blender/shots.py         the shots (home, screens per frame, camera keys), render CLI
tools/audio.py           original synthesized soundtrack → out/soundtrack.wav
tools/assemble.py        grade (night split-tone, vignette, grain), dissolves, end card, H.264 → out/held-commercial.mp4
renders/                 tests/ (look development), preview/ (half-res animatic frames), final/ (full-res frames)
out/                     the assembled films
```

## Running it

Requires Blender 5.2 (`blender` on PATH), FFmpeg, Node 20 (capture only) and Python 3.

```sh
cd commercial
python3 -m venv .venv && .venv/bin/pip install pillow numpy
node capture/twosides.mjs                               # uses e2e/'s puppeteer + Chrome for Testing
.venv/bin/python tools/screens.py && .venv/bin/python tools/label.py
.venv/bin/python -I tools/fetch_assets.py
# one still
blender -b -P blender/shots.py -- --shot s1 --frame 60 --out renders/tests/s1_60.png
# a shot (full res)
blender -b -P blender/shots.py -- --shot s1 --frames 1-120 --samples 160 --out renders/final/s1
# the .blend for any shot, to open in Blender's UI
blender -b -P blender/shots.py -- --shot s1 --save blender/s1.blend
.venv/bin/python tools/audio.py
.venv/bin/python tools/assemble.py --src renders/final --out out/held-commercial.mp4
```

## Render settings

Cycles on the Metal GPU, 1920×1080, 24 fps, adaptive sampling (threshold 0.015), OpenImageDenoise with albedo +
normal passes, 10 bounces, caustics off, indirect clamp 8, persistent data. AgX view transform, Medium High Contrast
look; camera white balance 4300 K at night (between the 2700 K lamp and the screens) and 5600 K in the morning,
+0.6 EV in the morning. Lenses: 35–85 mm on a 36 mm sensor, f/2.8–5.6, 9-blade aperture.
Grade in assembly: at night a gentle S-curve, 12% less saturation and cooler shadows; on every shot a lens vignette
and luminance-weighted film grain. Delivery: H.264 High, CRF 14, yuv420p, BT.709,
AAC 256 kb/s.

## Asset credits

All third-party assets are CC0 (public domain) from [Poly Haven](https://polyhaven.com) and
[ambientCG](https://ambientcg.com); the full list with links is in `assets/CREDITS.md`. Models: potted_plant_02,
standing_picture_frame_02, stationery_supplies (pen cup), modern_arm_chair_01, coffee_table_round_01,
mid_century_lounge_chair. Textures: oak_veneer_01, wood_floor, plastered_wall (relief only), poly_wool_herringbone,
rough_linen, Cardboard002. HDRIs: hansaplatz (night), konigsallee (morning). Everything else (both rooms, the desk, the
sofa, the laptop, the phone, the parcel with its tape, label and print, the lamp, mug and books) is modelled in
`blender/scene.py`. The Held logo is the app's own (`web/src/assets/held-logo.png`). Type is the system font (SF), as in
the app. The soundtrack is original, synthesized by `tools/audio.py`: a smooth 80 BPM cue, a soft electric piano (FM)
over a warm sine bass (Bm9 and Gmaj9 at night, opening to D major with a soft brushed swish in the morning, one long Dmaj9
on the end card), plus the buyer's taps on the phone, the seller's trackpad click, room tone and distant birds.

## Rendering the final

```sh
zsh commercial/render_final.sh        # every shot at 1920×1080, 160 samples, then out/held-commercial.mp4
```

It runs under `caffeinate` (the Mac must not sleep; sleep or throttling once slowed a preview shot 7×), logs to
`renders/final/render.log`, and resumes if interrupted (finished shots are skipped, frames on disk are kept).
Measured on the M4: about 45–55 s per full-quality frame, so about 10–11 hours for the ~770 frames.

**On another machine** (e.g. a PC with an NVIDIA GPU, much faster): copy the `commercial/` folder including
`assets/` and `textures/` (`textures/seq/` holds symlinks into `textures/frames/`; copy with links preserved, or rerun
`tools/screens.py`, which needs the SF font, i.e. macOS), install Blender 5.2, and in `blender/scene.py`
`render_settings()` change `compute_device_type = 'METAL'` and `d.type == 'METAL'` to `'OPTIX'` (or `'CUDA'`).

## What was actually completed

As of Oct 20, 2026:
- **Done:** the real UI capture (`capture/flow.mjs`, sandbox order on getheld.xyz), the screen sequences, both lighting
  states of the room, all six shots, the end card, the soundtrack, the assembly, and a half-resolution preview of the
  whole film: `out/held-commercial-preview-v6.mp4` (33.25 s; every second frame rendered at 960×540, 32 samples,
  then upscaled). It is v4-fixed with the last shot held 3 s longer so "Paid to merchant" reads, and it is approved
  for the final render.
- **Not done yet:** the final full-quality render (`render_final.sh`). `out/held-commercial.mp4` does not exist until it
  has run.
- Earlier previews in `out/` (v2–v5) are superseded; v5 was a two-sided seller/buyer version that was rejected.
