# The Great Halloween Trick — production plan

A 30-second 3D animated commercial for Held (720 frames, 24 fps, 1920×1080, Eevee), built in code with Blender and
Python. Tagline: **Don't get tricked this Halloween.** Scene 01 (0–6 s) exists; this plan extends it to the whole film.

## Decisions so far

| Date | Decision |
|---|---|
| Nov 2 | The pumpkin is a carved, candle-lit jack-o'-lantern, not a cartoon (the first version was "too cartoonish"). |
| Nov 2 | For the full script it gets thin, gnarled vine arms and legs. Its expressions come from **replacement faces**: several carved faces swapped between and within shots, the way stop-motion films swap faces, plus the candle inside (dim = unsure, flare = delight). |
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

| Act | Shot | Time | Frames | Picture | Pumpkin face | Sound |
|---|---|---|---|---|---|---|
| I | 01 | 0–2 s | 1–48 | Wide dolly into the living room | (hidden) | fire, wind, piano + celesta |
| I | 02 | 2–4 s | 49–96 | Pumpkin walks in, low tracking shot | curious | footsteps, pizzicato |
| I | 03 | 4–6 s | 97–144 | Stops, tilts, sees the lantern; lantern detail | curious → wonder | magical chime |
| II | 04 | 6–9 s | 145–216 | Over the shoulder at the laptop: the same lantern in a shop; Held checkout; pays | hopeful | clicks, soft confirm tone |
| II | 05 | 9–12 s | 217–288 | The ghost seller rises from behind the armchair, sees the payment, grins, starts to vanish in smoke | (reaction) | whoosh, giggle, sting |
| III | 06 | 12–15 s | 289–360 | The ghost tries to grab the coins / vanish; a soft amber "Held" seal stops them; it freezes, surprised | — | sudden musical pause |
| III | 07 | 15–19 s | 361–456 | Close on the ghost: confidence → reluctant determination. Clean interface: "Payment held · released when delivery is confirmed · or dispute for a refund" | — | three-note Held signature |
| IV | 08 | 19–22 s | 457–528 | Knock; the ghost returns with a wrapped package; pumpkin surprised | surprised | knock, package, float |
| IV | 09 | 22–25 s | 529–600 | It unwraps the glowing lantern; joy; taps "Confirm delivery"; status → "Released to seller" | delighted | paper, reveal, confirm chime |
| V | 10 | 25–28 s | 601–672 | Pumpkin waves the ghost over; they sit by the lantern; camera pulls back | delighted | laughter, bells, orchestra |
| V | 11 | 28–30 s | 673–720 | The room glows; dissolve to **HELD / DON'T GET TRICKED THIS HALLOWEEN.** | — | signature resolves to the final chord |

Continuity: one room, the same lantern (on the books → in the shop → in the package → between the two at the end; the
real one is moved off its stand for Acts II–IV), the laptop on a low footstool by the armchair, the door off-screen
right (we only hear the knock and see light change).

## Characters

**Pumpkin.** The current carved body and candle, plus:
- vine arms and legs: tapered, slightly twisted tubes with knots and small leaf scars, three-tendril hands, rigged with
  a small armature (shoulder, elbow, wrist; hip, knee) so it can walk, type, carry and wave;
- replacement faces, each a baked carved mesh with the same skin: *curious* (round eyes, small closed mouth),
  *wonder* (large round eyes, small "o"), *hopeful* (soft upturned eyes, gentle smile), *surprised* (tall eyes, big
  "O"), *delighted* (crescent eyes, wide smile). Gentler than today's stern grimace, which reads as menacing next to
  "innocent and optimistic" — to be reviewed as stills first.

**Ghost.** A small floating sheet ghost (about the pumpkin's height): a lathed cloth shape with a wavy, slowly rippling hem
(wave + displace modifiers, no cloth simulation), translucent ivory material (volume scatter inside, sheen and a soft
rim), eyes and mouth as dark soft-edged holes whose shapes are keyed for expression (sly, shocked, sulky, sheepish, happy).
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

1. **Pumpkin v2:** vine limbs + rig + the five faces → look-dev stills.
2. **Ghost:** model, material, expressions → stills next to the pumpkin.
3. **Props:** laptop with the Held screens, package; screen texts checked against the product rules above.
4. **Refactor** Scene 01 into set + shots 01–03 with the new pumpkin walking on its legs → Act I preview.
5. **Acts II–III** animation + sound → preview.
6. **Acts IV–V**, logo card, sonic signature → full-film preview.
7. Fixes, then the overnight final render, grade, assembly, QC (watch it whole, sync, continuity, messaging).
