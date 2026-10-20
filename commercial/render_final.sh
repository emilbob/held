#!/bin/zsh
# Final render of the commercial: every shot at 1920×1080, full quality, then the assembled MP4.
# Runs under caffeinate so the Mac doesn't sleep (sleep or throttling slowed one preview shot 7×).
# Resumable: a shot whose frames all exist is skipped, and Blender skips frames already on disk (use_overwrite off).
# Run from anywhere:  zsh held/commercial/render_final.sh        log: commercial/renders/final/render.log
set -e
cd "${0:A:h}"
mkdir -p renders/final
exec > >(tee -a renders/final/render.log) 2>&1
echo "== final render started $(date)"
caffeinate -dims -w $$ &
find renders/final -name "*.png" -size 0 -delete   # an interrupted frame leaves an empty placeholder
SAMPLES=${SAMPLES:-160}
for spec in s1:1-120 s2:1-120 s3:1-120 s4n:range s4m:range s5:1-240; do
  shot=${spec%%:*}; frames=${spec##*:}
  want=$(case $shot in s4n|s4m) echo 84;; s5) echo 240;; *) echo 120;; esac)
  have=$(ls renders/final/$shot 2>/dev/null | grep -c '\.png$' || true)
  if [ "$have" -ge "$want" ]; then echo "== $shot done ($have frames), skipped"; continue; fi
  echo "== $shot: $have/$want frames on disk, rendering ($(date +%T))"
  blender -b --factory-startup -P blender/shots.py -- --shot $shot --out renders/final/$shot --frames $frames \
    --samples $SAMPLES --no-overwrite 2>&1 | grep -E "Error|Trace|RENDER_TIME" || true
  echo "== $shot finished $(date +%T): $(ls renders/final/$shot | grep -c '\.png$') frames"
done
.venv/bin/python tools/audio.py
.venv/bin/python tools/assemble.py --src renders/final --out out/held-commercial.mp4
echo "== done $(date): out/held-commercial.mp4"
