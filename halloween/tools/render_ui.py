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


# ---------------------------------------------------------------- the ghost's phone: the merchant's Held dashboard

PW_, PH_ = 1080, 2340            # portrait phone screen
PHONE_HEAD = f'''<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="{CSS}">
<style>
  html {{ height: 100%; overflow: hidden; background: #000 }}
  body {{ zoom: 2.55; height: 100%; margin: 0; background: #000 }}
  .scr {{ height: 100%; border-radius: 50px; overflow: hidden; background: var(--bg) }}
  .sbar {{ display: flex; align-items: center; justify-content: space-between; height: 44px; padding: 0 26px 0 34px;
    font: 600 15px -apple-system, 'Helvetica Neue', sans-serif; color: var(--ink) }}
  .pill {{ width: 112px; height: 32px; border-radius: 16px; background: #000; margin-top: 4px }}
  .ind {{ display: flex; align-items: center; gap: 5px }}
  .bars {{ display: flex; align-items: flex-end; gap: 1.5px; height: 11px }}
  .bars i {{ width: 3px; background: var(--ink); border-radius: 1px }}
  .bat {{ width: 23px; height: 11px; border: 1.2px solid var(--muted); border-radius: 3.5px; padding: 1.2px; box-sizing: border-box }}
  .bat i {{ display: block; height: 100%; width: 78%; background: var(--ink); border-radius: 1.5px }}
  header {{ padding: 10px 14px }}
  main {{ margin: 14px auto; padding: 0 12px }}
  .stat {{ background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; margin-bottom: 12px }}
  .stat label {{ font-size: 12px }}
  .stat b {{ display: block; font-size: 30px; font-weight: 800; margin-top: 2px }}
  .stat.held b {{ color: var(--lime) }}
  .ordercard .row {{ display: flex; align-items: center; gap: 6px 10px; flex-wrap: wrap }}
  .ordercard .amount {{ font-weight: 700; font-size: 16px }}
  .ordercard .actions {{ flex-direction: column; align-items: stretch }}
  .ordercard .actions button {{ width: 100% }}
  .pressed {{ filter: brightness(1.6); border-color: var(--muted) !important }}
  .refusal {{ margin-top: 10px; background: #201517; border: 1px solid var(--red); border-radius: 10px; padding: 9px 11px;
    font-size: 14px; line-height: 1.4; color: var(--ink) }}
  .refusal b {{ color: var(--red) }}
  .done {{ margin-top: 10px; background: #12221a; border: 1px solid var(--green); border-radius: 10px; padding: 9px 11px; font-size: 14px }}
</style></head><body>'''


SBAR = '''<div class="sbar"><span>9:41</span><div class="pill"></div><div class="ind"><div class="bars"><i style="height:4px"></i>
<i style="height:6px"></i><i style="height:8px"></i><i style="height:11px"></i></div><div class="bat"><i></i></div></div></div>'''


def phone(held_total, badge, meta, actions, after='', balance='$0.00'):
    return PHONE_HEAD + '<div class="scr">' + SBAR + HEADER.replace('<span class="tag">Buyer protection for stablecoin payments</span>', '') + f'''<main>
  <div class="stat"><label>{SHOP} · Balance</label><b>{balance}</b></div>
  <div class="stat held"><label>Held for buyers</label><b>{held_total}</b></div>
  <div class="card order ordercard">
    <div class="row"><div class="oid">#{ORDER}</div><div class="item">{ITEM}</div><div class="amount">{PRICE}</div>{badge}</div>
    <div class="meta">{meta}</div>
    {actions}
    {after}
  </div>
</main></div></body></html>'''


EARLY = '<span class="sep" style="margin:6px 0 0">Test the guarantee:</span>'
PHONE = {
    'phone_held': phone(PRICE, '<span class="badge lime">Held: protected</span>', 'Paid by <b>0x7a3f…c41e</b> · window closes in <b>6d 23h</b>',
                        f'<div class="actions"><button>Refund buyer</button>{EARLY}<button class="ghost">Try to pay yourself early</button></div>'),
    'phone_busy': phone(PRICE, '<span class="badge lime">Held: protected</span>', 'Paid by <b>0x7a3f…c41e</b> · window closes in <b>6d 23h</b>',
                        f'<div class="actions"><button disabled>Refund buyer</button>{EARLY}<button class="ghost pressed">…</button></div>'),
    'phone_refused': phone(PRICE, '<span class="badge lime">Held: protected</span>', 'Paid by <b>0x7a3f…c41e</b> · window closes in <b>6d 23h</b>',
                           f'<div class="actions"><button>Refund buyer</button>{EARLY}<button class="ghost">Try to pay yourself early</button></div>',
                           '<div class="refusal"><b>Refused.</b> Only the buyer can pay the merchant before the protection window ends.</div>'),
    'phone_paid': phone('$0.00', '<span class="badge green">Paid to merchant</span>', 'Paid by <b>0x7a3f…c41e</b> · delivery confirmed',
                        '', '<div class="done"><b>Delivery confirmed.</b> You have been paid.</div>', balance=PRICE),
}

# the print on the package: Held's mark and wordmark, in ink on transparent (applied to the kraft as a decal)
STAMP = f'''<!doctype html><html><head><meta charset="utf-8"><style>
  html, body {{ margin: 0; width: 1000px; height: 1000px; background: transparent; overflow: hidden }}
  .s {{ display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 30px; height: 100%;
    font: 800 270px/1 -apple-system, 'Helvetica Neue', Helvetica, sans-serif; letter-spacing: -0.02em; color: #15120e }}
  .s img {{ height: 430px }}
</style></head><body><div class="s"><img src="{LOGO}" alt="">HELD</div></body></html>'''


def shoot(html, name, w, h, transparent=False):
    build = HERE / 'ui/build'
    png = HERE / 'ui/png'
    build.mkdir(parents=True, exist_ok=True)
    png.mkdir(parents=True, exist_ok=True)
    f = build / f'{name}.html'
    f.write_text(html)
    out = png / f'{name}.png'
    extra = ['--default-background-color=00000000'] if transparent else []
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
                    '--force-device-scale-factor=1', *extra, f'--window-size={w},{h}', f'--screenshot={out}', f.as_uri()],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(out)


def main():
    for name, html in PAGES.items():
        shoot(html, name, W, H)
    for name, html in PHONE.items():
        shoot(html, name, PW_, PH_)
    shoot(STAMP, 'package_stamp', 1000, 1000, transparent=True)


if __name__ == '__main__':
    main()
