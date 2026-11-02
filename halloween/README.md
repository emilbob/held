# Held — Halloween film

A 3D animated Halloween commercial for Held, built in code with Blender (Eevee) and Python on a MacBook Air M4.
Scene 01, "The Perfect Halloween" (0–6 s), is the first piece: everything here is built so later scenes reuse it.

## Visual plan, Scene 01

**Look.** A feature-animation interior at night: one warm, lived-in sitting room lit almost only by fire and
candles, with a cool moonlit window as the counter-colour. Palette: deep green-teal walls and dark wood (cool,
quiet), against amber fire, brass and orange pumpkins (warm, the subject). Contrast comes from light, not
saturation: dark corners, soft falloff, a faint haze so light has volume. Grounded, tactile materials (brick, worn
wood, velvet, wax, brass) at real scale; the pumpkin is the only stylised element, and the room's realism makes it
believable.

**Room layout** (metres; the camera looks towards +Y, the back wall):

```
            back wall y = 2.2
   ┌──────────────┬───────────────────────────────┐
   │  WINDOW      │   FIREPLACE (x ≈ 0.75)        │
   │  moon, bare  │   brick, mantel: clock,       │
   │  tree, wind, │   candles, dried flowers,     │
   │  leaves      │   pumpkins; hearth pumpkins   │
   │                 LANTERN   ← pumpkin ←  ARMCHAIR│  (chair faces the fire, its back to the camera;
   │              (-0.3, 0.5)   hops      (1.35,0.1)│   the pumpkin waits hidden in front of it)
   │                                   RUG          │
   └────────────────────────────────────────────────┘
                         camera
```

**Shots (one continuous camera move, 144 frames at 24 fps):**

| Time | Frames | Picture | Sound |
|---|---|---|---|
| 0–2 s | 1–48 | Wide, eye height. Slow push into the room; fire, candles, the window's moonlight and moving leaves. | Fire crackle, wind, room tone; piano and celesta enter |
| 2–4 s | 49–96 | The camera sinks and swings left past the armchair; the jack-o'-lantern hops out from behind it, along the hearth. | A heavy wooden thud on each landing; pizzicato on every hop |
| 4–6 s | 97–144 | Low 3/4 close on the pumpkin as it stops and turns: the lantern in the left foreground blooms and the candle inside the pumpkin flares, its carved face burning brighter. | A soft magical shimmer, the music opens up |

**Character.** A carved jack-o'-lantern (≈ 22 cm tall), serious rather than cute: ten ribs, deep aged-orange skin
with pale striations and a few bruises, a gnarled stem on a cut lid. The body is made hollow (solidify), the stern face
(slanted eyes, a triangle nose, a jagged grimace) and the lid's kerf are cut with boolean cutters, and the result is
baked into one mesh. A candle burns inside: its light is what makes the carving glow, and it flares when the pumpkin
sees the lantern. No limbs: it hops on its base, leaning into each hop and rocking to rest. Rig: root → body.

**The lantern.** A hexagonal wrought-iron lantern with amber seeded glass and crescent-moon cut-outs in its cap, a
candle inside. Glows softly from the start; blooms when the pumpkin notices it.

**Rendering.** Eevee (ray-traced reflections, soft shadows, volumetric haze, bloom via compositor glare),
AgX colour. Fire and candle flames are animated emissive shaders with flickering lights, no simulations. Previews at
1280×720, final 1920×1080, 24 fps.

**Sound.** All original, synthesized in Python (numpy/scipy) from the same timeline as the picture: fire crackle,
wind, footsteps, room tone, a shimmer cue; music for felt piano, celesta, pizzicato strings and a soft string pad.

## Layout

The whole film (see PLAN.md) is one set, one cast, and one module per act; each act renders on its own.

```
blender/film.py        entry point: builds stage + cast + every act, renders (--act N / --frames / --still / --view / --save)
blender/stage.py       the one room: builds the set, haze, world, fill lights, Eevee + compositor settings, look-dev VIEWS
blender/cast.py        the cast and story props, built once; show() brings them on and off stage
blender/act1.py        Act I (shots 01–03, frames 1–144): camera, lantern key and moon rim lights, calls animate.py
blender/animate.py     Act I animation: the pumpkin's hops and reaction, keep_on_floor, the lantern's bloom, the camera move
blender/timeline.py    frame numbers for picture and sound: every shot (SHOTS), every act (ACTS), Act I's events
blender/pumpkin.py     decorative pumpkins and the jack-o'-lantern: carved mesh, materials, candle, rig
blender/ghost.py       the ghost: linen sheet, eye holes, void, hem ripple
blender/story_props.py the laptop (one screen per Held page, set_screen) and the wrapped package
blender/lib.py, materials.py, room.py, outside.py, fire.py, props.py, lantern.py     helpers and the set's pieces
blender/lookdev_*.py   stills of the ghost and the props for review
ui/                    the laptop's pages: tools/render_ui.py (real Held checkout HTML → ui/png via headless Chrome)
audio/                 dsp.py (toolkit), sfx.py, music.py, mix.py → out/scene01_audio.wav (+ out/stems/)
tools/fetch_assets.py  CC0 assets (Poly Haven) → assets/ + assets/CREDITS.md
tools/assemble.py      frames + audio → mp4
renders/               tests/ (stills), act1/ … (one folder per act)
```

## Commands

```sh
python3 -m venv .venv && .venv/bin/pip install numpy scipy                   # once
.venv/bin/python -I tools/fetch_assets.py                                   # once
python3 tools/render_ui.py                                                  # the laptop's pages
blender -b --factory-startup -P blender/film.py -- --still 120 --out renders/tests/s120.png
blender -b --factory-startup -P blender/film.py -- --act 1 --out renders/act1 --pct 66              # 720p preview of Act I
blender -b --factory-startup -P blender/film.py -- --still 60 --view fire --out renders/tests/fire.png   # look-dev cameras: face fire hero lantern mantel window
python3 blender/timeline.py && .venv/bin/python audio/mix.py
.venv/bin/python tools/assemble.py --src renders/act1 --out out/act1_preview.mp4
```
