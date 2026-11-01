"""Frames + sound → MP4. Run: .venv/bin/python tools/assemble.py --src renders/preview --out out/scene01_preview.mp4"""
import argparse, os, subprocess
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
ap = argparse.ArgumentParser()
ap.add_argument('--src', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--audio', default=os.path.join(ROOT, 'out', 'scene01_audio.wav'))
ap.add_argument('--crf', default='16')
a = ap.parse_args()
os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '24', '-start_number', '1', '-i', os.path.join(a.src, 'f%04d.png')]
if os.path.exists(a.audio):
    cmd += ['-i', a.audio, '-c:a', 'aac', '-b:a', '256k', '-shortest']
cmd += ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'slow', '-crf', a.crf, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', a.out]
subprocess.run(cmd, check=True)
print(a.out)
