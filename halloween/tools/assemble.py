"""Frames + sound → MP4.
  .venv/bin/python tools/assemble.py --src renders/act1 --out out/act1_preview.mp4
  .venv/bin/python tools/assemble.py --src renders/act23 --start 145 --audio out/film_audio.wav --out out/act23_preview.mp4
--start: the first frame number in --src; the audio is cut to begin at that frame's time."""
import argparse, os, subprocess
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
ap = argparse.ArgumentParser()
ap.add_argument('--src', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--audio', default=os.path.join(ROOT, 'out', 'scene01_audio.wav'))
ap.add_argument('--crf', default='16')
ap.add_argument('--start', type=int, default=1)
ap.add_argument('--end', type=int, help='last frame (needed with --endcard)')
ap.add_argument('--endcard', help='an image to dissolve into at --endcard-from and hold to the end')
ap.add_argument('--endcard-from', type=int)
ap.add_argument('--fade', type=int, default=12, help='dissolve length in frames')
a = ap.parse_args()
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '24', '-start_number', str(a.start), '-i', os.path.join(a.src, 'f%04d.png')]
vf = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'
maps = []
if a.endcard:
    hold = (a.end - a.endcard_from + 1) / 24
    cmd += ['-loop', '1', '-framerate', '24', '-t', f'{hold:.4f}', '-i', a.endcard]
    off = (a.endcard_from - a.start) / 24
    vf = None
    fc = (f'[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,format=yuv420p[v0];'
          f'[1:v][v0]scale2ref[card][v0r];[card]setsar=1,format=yuv420p[c];'
          f'[v0r][c]xfade=transition=fade:duration={a.fade / 24:.4f}:offset={off:.4f}[v]')
    maps = ['-filter_complex', fc, '-map', '[v]']
if os.path.exists(a.audio):
    ai = 2 if a.endcard else 1
    cmd += ['-ss', f'{(a.start - 1) / 24:.4f}', '-i', a.audio]
    maps += (['-map', f'{ai}:a'] if a.endcard else [])
    cmd += maps + ['-c:a', 'aac', '-b:a', '256k', '-shortest']
else:
    cmd += maps
if vf:
    cmd += ['-vf', vf]
cmd += ['-c:v', 'libx264', '-preset', 'slow', '-crf', a.crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', a.out]
subprocess.run(cmd, check=True)
print(a.out)
