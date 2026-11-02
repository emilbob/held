# The Great Halloween Trick — production plan

A 30-second 3D animated commercial for Held (720 frames, 24 fps, 1920×1080, Eevee), built in code with Blender and
Python. Tagline: **Don't get tricked this Halloween.** Scene 01 (0–6 s) exists; this plan extends it to the whole film.

## Decisions so far

| Date | Decision |
|---|---|
| Nov 2 | The pumpkin is a carved, candle-lit jack-o'-lantern, not a cartoon (the first version was "too cartoonish"). |
| Nov 2 | Tried and **rejected**: vine arms and legs with swapped, gentler carved faces ("too cartoonish"). The pumpkin stays exactly as in `out/scene01_preview_jack.mp4`: **no limbs, the one stern carved face, hops on its base.** |
| Nov 2 | So it acts like a real object come to life: through the **candle** (dim = doubt, steady = calm, flare = delight or alarm), **body language** (hops, rocks, tilts, slow turns, a shiver) and **staging**. It never grows limbs or a second face. The ghost must be just as grounded. |
| Nov 2 | Act I music stays warm (piano, celesta, pizzicato), as the brief says; no horror music. |

## Product message (checked against the Held README)

What Held actually does, and so what the film may show:

- The buyer pays to a per-order address; the payment is **held**, not in the seller's wallet.
- It is released to the seller when the **buyer confirms delivery**, or by anyone after the protection window.
- Inside the window the buyer can **dispute**; the shop's resolver then refunds the buyer or pays the seller. The money can
  only ever go to those two places.

So in the film: the ghost sees the payment arrive but **can't take it** ("Held until delivery is confirmed"). It is not
insurance and nothing is guaranteed; the screen text says "held", "confirm delivery", "or dispute for a refund", never
"protected forever" or "guaranteed". All interface shots use the real Held checkout look, re-created as clean textures.

## Shot list

| Act | Shot | Time | Frames | Picture | Pumpkin (candle) | Sound |
|---|---|---|---|---|---|---|
| I | 01 | 0–2 s | 1–48 | Wide dolly into the living room | (hidden) | fire, wind, piano + celesta |
| I | 02 | 2–4 s | 49–96 | Pumpkin hops in, low tracking shot | candle steady | hop thuds, pizzicato |
| I | 03 | 4–6 s | 97–144 | Stops, turns, tips back towards the lantern; lantern detail | candle flares | magical chime |
| II | 04 | 6–9 s | 145–216 | The laptop lies open on the floor rug. The pumpkin hops up to it; the lantern in a shop, the Held checkout; it tips forward and its base presses the trackpad: "Pay" | candle steady, then a flare on the tap | soft knock of the tap, confirm tone |
| II | 05 | 9–12 s | 217–288 | The ghost seller rises from behind the armchair, sees the payment, grins, starts to vanish in smoke | (reaction) | whoosh, giggle, sting |
| III | 06 | 12–15 s | 289–360 | The ghost tries to grab the coins / vanish; a soft amber "Held" seal stops them; it freezes, surprised | — | sudden musical pause |
| III | 07 | 15–19 s | 361–456 | Close on the ghost: confidence → reluctant determination. Clean interface: "Payment held · released when delivery is confirmed · or dispute for a refund" | — | three-note Held signature |
| IV | 08 | 19–22 s | 457–528 | Knock; the ghost floats back in with a wrapped package and sets it down; the pumpkin rocks back in surprise | candle flickers, then flares | knock, package, float |
| IV | 09 | 22–25 s | 529–600 | The ghost pulls the ribbon (the pumpkin can't): the paper falls open, the lantern glows; the pumpkin hops to the laptop and presses "Confirm delivery"; status → "Released to seller" | candle flares warm and stays bright | paper, reveal, confirm chime |
| V | 10 | 25–28 s | 601–672 | The pumpkin turns to the ghost, then hops aside to make room by the lantern; the ghost hesitates, then settles beside it; camera pulls back | calm, bright | soft laughter, bells, orchestra |
| V | 11 | 28–30 s | 673–720 | The room glows; dissolve to **HELD / DON'T GET TRICKED THIS HALLOWEEN.** | — | signature resolves to the final chord |

Continuity: one room, the same lantern (on the books → in the shop → in the package → between the two at the end; the
real one is moved off its stand for Acts II–IV), the laptop on a low footstool by the armchair, the door off-screen
right (we only hear the knock and see light change).

## Characters

**Pumpkin.** Exactly as in `out/scene01_preview_jack.mp4`: hollow carved jack-o'-lantern, stern face, candle inside,
no limbs. It moves by hopping, rocking and turning on its base; the candle carries the emotion.

**Ghost.** Grounded, not cartoonish, to match the pumpkin: a small floating sheet (about one and a half times the
pumpkin's height), aged ivory linen draped over nothing, a frayed, slowly rippling hem (wave + displace modifiers, no
cloth simulation), slightly translucent (volume scatter inside, sheen, a soft rim of moonlight). Its face is two dark
eye holes cut in the cloth and nothing else; it acts with its whole body (lean, sag, puff up, turn away), and the holes
only narrow or widen a little.
Floats on a slow sine bob; vanishing smoke = a few emissive, fading noise-textured cards, not a simulation.

## Project structure (target)

```
blender/
  lib.py materials.py room.py outside.py fire.py props.py lantern.py     the set (exists)
  pumpkin.py         carved body, replacement faces, vine limbs, rig          (extend)
  ghost.py           ghost mesh, material, expression keys, smoke cards       (new)
  laptop.py          laptop + screen material that shows interface images     (new)
  package.py         wrapped box, ribbon, paper                               (new)
  set.py             builds the whole room once (from today's shot01.build)   (new)
  shots/s01.py … s11.py   each shot: blocking, animation, camera, lights      (new; s01–s03 = today's scene)
  film.py            CLI: --shot N | --act N | --frames a-b | --still f | --view
ui/                  the Held screens as HTML → PNG (headless Chrome), used on the laptop
timeline.py          every shot's frame range and every sound event, for picture and sound
audio/               dsp, sfx, music, mix (exist), extended per act
tools/assemble.py    shots → film.mp4 with audio, grade and the logo card
```

Each shot renders on its own into `renders/<shot>/`, so a fix re-renders only that shot.

## Render budget (measured on this MacBook Air)

- Preview, 720p, 64 samples: ~12 s/frame → whole film ~2.5 h.
- Final, 1080p, 96 samples: ~37 s/frame → whole film ~7.5 h (overnight).

## Milestones (each ends with stills or a preview for review)

1. ~~Pumpkin v2 (limbs + faces)~~ rejected Nov 2; the pumpkin is final as it is.
2. **Ghost:** model, material, expressions → stills next to the pumpkin.
3. **Props:** laptop with the Held screens, package; screen texts checked against the product rules above.
4. **Refactor** Scene 01 into set + shots 01–03 (picture unchanged) → Act I preview.
5. **Acts II–III** animation + sound → preview.
6. **Acts IV–V**, logo card, sonic signature → full-film preview.
7. Fixes, then the overnight final render, grade, assembly, QC (watch it whole, sync, continuity, messaging).
