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
a = ap.parse_args()
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '24', '-start_number', str(a.start), '-i', os.path.join(a.src, 'f%04d.png')]
if os.path.exists(a.audio):
    cmd += ['-ss', f'{(a.start - 1) / 24:.4f}', '-i', a.audio, '-c:a', 'aac', '-b:a', '256k', '-shortest']
cmd += ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'slow', '-crf', a.crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', a.out]
subprocess.run(cmd, check=True)
print(a.out)
