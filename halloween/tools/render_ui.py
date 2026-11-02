"""The laptop's screens: the shop and the real Held checkout states, as HTML using the Held app's own stylesheet and
wording (web/src/styles.css, Pay.tsx, ui.tsx), screenshotted with headless Chrome into ui/png/<name>.png.

  python3 tools/render_ui.py

Screens: shop (the ghost's shop, the lantern, "Pay with Held"), checkout (awaiting payment), held (payment held, the
confirm/dispute buttons), released (delivery confirmed, paid to merchant). Text is zoomed so it reads on a laptop in
frame. The product photo is a render of the film's own lantern (ui/lantern.png).
"""
import os, subprocess, pathlib

HERE = pathlib.Path(__file__).resolve().parent.parent
HELD = HERE.parent
CSS = (HELD / 'web/src/styles.css').as_uri()
LOGO = (HELD / 'web/src/assets/held-logo.png').as_uri()
LANTERN = (HERE / 'ui/lantern.png').as_uri()
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
W, H = 1440, 900

SHOP = 'Wraith &amp; Wick'
ITEM = 'Gothic iron lantern'
PRICE = '$48.00'
ORDER = '1031'

HEAD = f'''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="{CSS}">
<style>
  html, body {{ height: 100%; overflow: hidden }}
  body {{ zoom: 1.45 }}
  main {{ margin-top: 22px }}
  .pay .card {{ margin-bottom: 12px }}
  .pay {{ margin: 0 auto !important; max-width: 640px }}
</style></head><body>'''
HEADER = f'''<header><span class="logo"><img src="{LOGO}" alt="">Held</span><span class="tag">Buyer protection for stablecoin payments</span></header>'''


def steps(at):
    labels = ['Pay', 'Held until delivery', 'Paid to merchant' if at == 3 else 'Settled']
    return '<ol class="steps">' + ''.join(
        f'<li class="{"done" if i < at else "now" if i == at else ""}">{l}</li>' for i, l in enumerate(labels)) + '</ol>'


def checkout(at, badge, body, wallet):
    return HEAD + HEADER + f'''<main><div class="pay">
<div class="card checkout">{steps(at)}
  <div class="merchant">{SHOP} · Order #{ORDER}</div>
  <h1>{ITEM}</h1>
  <div class="big">{PRICE} <small>in stablecoins</small></div>
  {badge}
  {body}
</div>
{wallet}
</div></main></body></html>'''


WALLET_LINE = '<p class="payingfrom">Paying from <b>0x7a3f…c41e</b> <span class="muted">(Tempo Wallet)</span></p>'

PAGES = {
    'shop': f'''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="{CSS}">
<style>
  html, body {{ height: 100%; overflow: hidden; background: #f3eee6; color: #1d1a16;
    font-family: Georgia, 'Times New Roman', serif }}
  body {{ zoom: 1.45 }}
  .bar {{ padding: 16px 34px; border-bottom: 1px solid #ddd3c4; font-size: 22px; letter-spacing: .04em }}
  .bar small {{ font-family: -apple-system, sans-serif; font-size: 12px; color: #7d7364; margin-left: 12px; letter-spacing: 0 }}
  .prod {{ display: flex; gap: 30px; padding: 26px 34px; align-items: flex-start }}
  .prod > img {{ width: 420px; height: 280px; object-fit: cover; border-radius: 6px }}
  .prod h1 {{ font-weight: 400; font-size: 30px; margin: 4px 0 6px }}
  .price {{ font-size: 22px; margin: 0 0 14px }}
  .desc {{ font-size: 14px; line-height: 1.55; color: #4a433a; max-width: 330px; margin: 0 0 18px }}
  .held-btn {{ display: inline-flex; align-items: center; gap: 9px; background: #0b0d10; color: #e8eaed; border-radius: 9px;
    padding: 11px 18px; font: 600 15px -apple-system, sans-serif }}
  .held-btn img {{ height: 20px }}
  .held-btn b {{ color: #D5F94F }}
  .s-note {{ font: 12px -apple-system, sans-serif; color: #7d7364; margin-top: 9px }}
</style></head><body>
<div class="bar">{SHOP}<small>Lanterns &amp; curiosities</small></div>
<div class="prod"><img src="{LANTERN}" alt="">
  <div><h1>{ITEM}</h1><p class="price">{PRICE}</p>
  <p class="desc">Hand-forged iron, seeded amber glass, pointed slots in the cap. Lit, it throws a warm, slow light.</p>
  <span class="held-btn"><img src="{LOGO}" alt="">Pay with <b>Held</b></span>
  <p class="s-note">Your payment is held until you confirm delivery.</p></div>
</div></body></html>''',

    'checkout': checkout(0, '<span class="badge grey">Awaiting payment</span>',
                         '''<p class="protect"><b>Protected by Held.</b> Your payment is held onchain for 7 days or until you
  confirm delivery. If something goes wrong, open a dispute: the funds can only go back to you or to the merchant.</p>''',
                         f'''<div class="card walletbox"><h2>Your wallet</h2><div class="actions">{WALLET_LINE}
  <button class="primary">Pay {PRICE}</button></div></div>'''),

    'held': checkout(1, '<span class="badge lime">Held: protected</span>',
                     f'''<div class="protect held"><b>Payment held: you're protected.</b> {PRICE} is locked by the Tempo protocol,
  not by the merchant.<br /> Protection window: <b>6d 23h</b> left.</div>''',
                     '''<div class="card walletbox"><h2>Your wallet</h2><div class="actions">
  <button class="primary">I got it: release payment</button>
  <button class="danger">Something went wrong: open dispute</button></div></div>'''),

    'released': checkout(3, '<span class="badge green">Paid to merchant</span>',
                         '<div class="protect done"><b>Delivery confirmed.</b> The merchant has been paid.</div>', ''),
}


def main():
    build = HERE / 'ui/build'
    png = HERE / 'ui/png'
    build.mkdir(parents=True, exist_ok=True)
    png.mkdir(parents=True, exist_ok=True)
    for name, html in PAGES.items():
        f = build / f'{name}.html'
        f.write_text(html)
        out = png / f'{name}.png'
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                        f'--window-size={W},{H}', f'--screenshot={out}', f.as_uri()], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(out)


if __name__ == '__main__':
    main()
