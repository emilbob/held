"""The film's end card: the Held mark and wordmark, and the tagline, on a deep warm black — 1920×1080 PNG via headless
Chrome → ui/png/endcard.png. assemble.py dissolves the picture into it (timeline.EV['endcard'])."""
import subprocess, pathlib

HERE = pathlib.Path(__file__).resolve().parent.parent
LOGO = (HERE.parent / 'web/src/assets/held-logo.png').as_uri()
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

HTML = f'''<!doctype html><html><head><meta charset="utf-8"><style>
  html, body {{ margin: 0; width: 1920px; height: 1080px; overflow: hidden;
    background: radial-gradient(ellipse 60% 55% at 50% 52%, #1a120b 0%, #0b0907 60%, #050404 100%);
    font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #efe8dc }}
  .wrap {{ position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center }}
  .mark {{ display: flex; align-items: center; gap: 30px }}
  .mark img {{ height: 118px }}
  .mark span {{ font-size: 132px; font-weight: 800; letter-spacing: -0.03em; line-height: 1 }}
  .tag {{ margin-top: 54px; font-size: 30px; font-weight: 500; letter-spacing: 0.32em; color: #c9bba6 }}
</style></head><body><div class="wrap">
  <div class="mark"><img src="{LOGO}" alt=""><span>HELD</span></div>
  <div class="tag">DON&rsquo;T GET TRICKED THIS HALLOWEEN.</div>
</div></body></html>'''


def main():
    build = HERE / 'ui/build'
    build.mkdir(parents=True, exist_ok=True)
    f = build / 'endcard.html'
    f.write_text(HTML)
    out = HERE / 'ui/png/endcard.png'
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                    '--force-device-scale-factor=1', '--window-size=1920,1080', f'--screenshot={out}', f.as_uri()],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(out)


if __name__ == '__main__':
    main()
