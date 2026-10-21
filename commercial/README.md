# Held — "Until it arrives" (33 s commercial)

A photoreal 3D commercial for Held, built in code with Blender (Cycles) and Python, rendered on an Apple M4 (Metal GPU).
Everything here is self-contained; nothing in the app (`web/`, `server/`, `contracts/`) was changed.

**Status:** see [What was actually completed](#what-was-actually-completed).

## The film

One buyer, one desk, one night and the next morning. The buyer pays for a walnut desk tray ($64.00) on a laptop at
night, waits while the payment is held, and releases it on their phone when the parcel arrives. No captions: the
screens tell it. Every page on them is the live site, recorded during one real sandbox purchase.

| # | Time | Where | What the screen shows |
|---|---|---|---|
| s1 | 0–5 s | Night, the desk wide, the laptop | The checkout link opens, the pointer picks **pathUSD** and goes to **Pay $64.00** (both buttons' real hover states), **Sending…**, then **Held: protected** decodes in. The phone is asleep |
| s2 | 5–10 s | Night, close on the phone beside the laptop | The same order, held, the protection window counting down; a short scroll |
| s3 | 10–15 s | Night, close on the laptop's screen | **Held until delivery**, "locked by the Tempo protocol, not by the merchant". The pointer drifts onto **I got it: release payment** and rests there: not yet |
| s4n → s4m | 15–21 s | The desk wide, night dissolving into morning | One unbroken camera move: lamp on and the held order on screen, then (1 s dissolve at 17.5 s) the same frame next morning: lamp off, sun through the window, the laptop asleep, the mug moved, the parcel on the desk |
| s5 | 21–31 s | Morning, the parcel, then the phone | Close on the parcel and its Held print; the camera rises to the phone as it wakes. The buyer taps **I got it: release payment** → **Confirming…** → **Paid to merchant**. The camera settles at 28 s and holds, so it reads |
| — | 30.25–33.25 s | End card | Held · **Pay with confidence.** · Buyer protection for stablecoin payments. · getheld.xyz |

33.25 s in all (798 frames at 24 fps; s5 dissolves into the end card over 0.75 s).

### Where the film follows the product rather than the brief

- **The UI is the live site, not a mock-up.** `capture/flow.mjs` makes one real purchase in the public Sandbox Shop
  (Tempo testnet, test funds) and has the order open on a laptop (1512×930 @2x) and on a phone (393×716 @3x, the
  visible page area) in the same browser profile, so both are the same wallet and both pages follow the order live.
  Every state is screenshotted as it happens, with its time (`capture/flow/index.json`). The app animates status
  changes (labels decode into place, badges pulse, buttons fade in); to catch those frame by frame, the capture runs
  the page's clock (`performance.now`, `requestAnimationFrame`, `Date.now`, CSS animations) at 1/10 speed around each
  change and records each shot's page time, so `tools/screens.py` plays them back at true speed. The app's code and
  the chain are untouched; the waits for the chain ("Sending…", "Confirming…") are compressed. The page pixels are
  used as captured; around them `tools/screens.py` adds only device chrome (the macOS menu bar with the notch and a
  Safari-style toolbar showing `getheld.xyz`; a phone status bar and URL bar) and draws the pointer, which a
  screenshot never contains. The pages say "Tempo testnet" and "Sandbox Shop" because that is what the live site
  shows today. The run removes its checkout links from the shared Sandbox Shop when it ends.
- **Release is the buyer's act, not automatic.** The buyer presses "I got it: release payment"; only then does the
  page say "Paid to merchant". Held does not verify delivery and the film never implies it does.
- **Night → morning reads as "the parcel arrived next morning"**: the same framing on one camera move, dissolving
  between the two lighting states, with the parcel appearing in the morning.
- **The Held print on the parcel** is the commercial's branding (Held is the payment layer, not the shop).
- **The laptop is styled on a MacBook Pro 14"** (proportions, notch, keyboard layout) without the Apple logo.
- **Known liberty:** the sandbox's protection window is 5 minutes, so the countdowns read "4:5x left" in a story that
  spans a night (a real shop's default is 7 days).

## Layout

```
capture/flow.mjs         one real sandbox purchase, laptop and phone, recorded state by state → capture/flow/*.png + index.json
tools/screens.py         per-shot screen sequences (chrome, pointer, real timing) → textures/seq/<shot>-<device>/
tools/label.py           the parcel's shipping label (fictional addresses) and Held print → textures/
tools/fetch_assets.py    CC0 models/textures/HDRIs → assets/ (+ assets/CREDITS.md)
blender/scene.py         the buyer's room and desk: furniture, laptop, phone, parcel, lamp, night and morning light
blender/shots.py         the shots (home, screens per frame, camera keys), render CLI
tools/audio.py           original synthesized soundtrack → out/soundtrack.wav
tools/assemble.py        grade (night split-tone, vignette, faint dither), dissolves, end card, H.264 → out/held-commercial.mp4
renders/                 tests/ (look development), preview/ (half-res animatic frames), final/ (full-res frames)
out/                     the assembled films
```

## Running it

Requires Blender 5.2 (`blender` on PATH), FFmpeg, Node 20 (capture only) and Python 3.

```sh
cd commercial
python3 -m venv .venv && .venv/bin/pip install pillow numpy
node capture/flow.mjs                                   # uses e2e/'s puppeteer + Chrome for Testing
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
and a faint dither against banding (visible film grain read as noise, so it was removed). Delivery: H.264 High,
CRF 14, yuv420p, BT.709, AAC 256 kb/s.

## Asset credits

All third-party assets are CC0 (public domain) from [Poly Haven](https://polyhaven.com) and
[ambientCG](https://ambientcg.com); the full list with links is in `assets/CREDITS.md`. Models: potted_plant_02,
standing_picture_frame_02, stationery_supplies (pen cup), modern_arm_chair_01.
Textures: oak_veneer_01, wood_floor, plastered_wall (relief only), poly_wool_herringbone,
rough_linen, Cardboard002. HDRIs: hansaplatz (night), konigsallee (morning). Everything else (the room, the desk, the
laptop, the phone, the parcel with its tape, label and print, the lamp, mug and books) is modelled in
`blender/scene.py`. The Held logo is the app's own (`web/src/assets/held-logo.png`). Type is the system font (SF), as in
the app. The soundtrack is original, synthesized by `tools/audio.py`: a smooth 80 BPM cue, a soft electric piano (FM)
over a warm sine bass (Bm9 and Gmaj9 at night, opening to D major with a soft brushed swish in the morning, one long Dmaj9
on the end card), plus the trackpad clicks, the buyer's tap on the phone, room tone and distant birds.

## Rendering the final

```sh
zsh commercial/render_final.sh        # every shot at 1920×1080, 160 samples, then out/held-commercial.mp4
```

It runs under `caffeinate` (the Mac must not sleep; sleep or throttling once slowed a preview shot 7×), logs to
`renders/final/render.log`, and resumes if interrupted (finished shots are skipped, frames on disk are kept).
Measured on the M4: about 46 s per full-quality frame (s3 about 23 s), so about 9.5 hours of rendering for the 768
frames. Keep the charger in and the lid open: on battery the Mac drained and went into low-power sleep, and closing
the lid sleeps it regardless of `caffeinate` (the Oct 20–21 render took 19 h wall time because of both).

**On another machine** (e.g. a PC with an NVIDIA GPU, much faster): copy the `commercial/` folder including
`assets/` and `textures/` (`textures/seq/` holds symlinks into `textures/frames/`; copy with links preserved, or rerun
`tools/screens.py`, which needs the SF font, i.e. macOS), install Blender 5.2, and in `blender/scene.py`
`render_settings()` change `compute_device_type = 'METAL'` and `d.type == 'METAL'` to `'OPTIX'` (or `'CUDA'`).

## What was actually completed

As of Oct 21, 2026:
- **Done:** the final film, `out/held-commercial.mp4` (1920×1080, 24 fps, 33.25 s, H.264 + AAC, about 45 MB):
  every shot rendered at full quality (160 samples) by `render_final.sh`, then assembled. The first assembly used
  visible film grain, which read as noise; it was replaced with a faint dither and re-assembled from the same frames
  (the grainy cut is kept as `out/held-commercial-grain.mp4`).
- The approved half-resolution preview was `out/held-commercial-preview-v6.mp4` (v4-fixed with the last shot held 3 s
  longer so "Paid to merchant" reads). Earlier previews in `out/` (v2–v5) are superseded; v5 was a two-sided
  seller/buyer version that was rejected.
- The X post and making-of thread are in `out/x-post.txt`.
