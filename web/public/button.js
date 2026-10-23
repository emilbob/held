/* Held "Pay with Held" button for any website (Webflow, Wix, Squarespace, WordPress, plain HTML): https://getheld.xyz
 *
 *   <div data-held-link="https://getheld.xyz/#/buy/Ab3xYz"></div>
 *   <script src="https://getheld.xyz/button.js" async></script>
 *
 * Optional: data-held-label="Buy the poster"  data-held-theme="light"  data-held-tagline="false"
 *           data-held-target="_self" (open in the same tab)  data-held-radius="0"
 * The button shows the link's live price and greys out when the merchant turns the link off. It renders in a shadow
 * root, so the site's own CSS can't restyle it. Same look and rules as the Framer component (src/framer/HeldPayButton.tsx).
 */
(function () {
  'use strict'
  var LIME = '#D5F94F'
  var THEMES = {
    dark: { background: '#0b0d10', color: '#fff', border: LIME, accent: LIME },
    light: { background: '#fff', color: '#0b0d10', border: '#0b0d10', accent: '#4d5a00' },
  }

  // "https://getheld.xyz/#/buy/Ab3xYz" -> the site it lives on and the link id. Anything else is not a checkout link.
  function parse(link) {
    try {
      var url = new URL(String(link).trim())
      var m = url.hash.match(/^#\/buy\/([A-Za-z0-9_-]+)$/)
      return m && url.protocol === 'https:' ? { origin: url.origin, id: m[1] } : null
    } catch (e) {
      return null
    }
  }
  // Prices are stored in base units (6 decimals).
  function usd(base) {
    return (Number(base) / 1e6).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  }

  function render(host, target, info, missing) {
    var d = host.dataset
    var c = THEMES[d.heldTheme] || THEMES.dark
    var off = missing || (info && info.active === false)
    var radius = isFinite(parseFloat(d.heldRadius)) ? parseFloat(d.heldRadius) : 10
    var label = (d.heldLabel || '').trim()
    var text = off ? 'No longer available' : label || (info ? 'Pay ' + usd(info.amount) + ' with Held' : 'Pay with Held')
    var root = host.shadowRoot || host.attachShadow({ mode: 'open' })

    var el = document.createElement(off ? 'span' : 'a')
    el.className = 'b'
    if (!off) {
      el.href = target.origin + '/#/buy/' + target.id
      el.target = d.heldTarget === '_self' ? '_self' : '_blank'
      el.rel = 'noopener'
      if (info) el.title = info.item + ', paid through Held: your payment is protected until you confirm delivery.'
    }
    var img = document.createElement('img')
    img.src = target.origin + '/held-favicon.png'
    img.width = 20
    img.height = 20
    img.alt = ''
    el.appendChild(img)
    el.appendChild(document.createTextNode(text))
    if (d.heldTagline !== 'false' && !off) {
      var tag = document.createElement('span')
      tag.className = 't'
      tag.textContent = 'buyer protected'
      el.appendChild(tag)
    }

    var style = document.createElement('style')
    style.textContent =
      ':host{display:inline-block}' +
      '.b{all:initial;box-sizing:border-box;display:inline-flex;align-items:center;gap:10px;padding:12px 20px;white-space:nowrap;' +
      'border-radius:' + radius + 'px;background:' + c.background + ';border:1px solid ' + c.border + ';color:' + c.color + ';' +
      "font:600 15px/1.2 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;text-decoration:none;" +
      'cursor:' + (off ? 'default' : 'pointer') + ';opacity:' + (off ? 0.5 : 1) + '}' +
      'a.b:hover{filter:brightness(1.12)}a.b:focus-visible{outline:2px solid ' + LIME + ';outline-offset:2px}' +
      'img{display:block;width:20px;height:20px}' +
      '.t{font-weight:400;font-size:12px;color:' + c.accent + '}'
    root.replaceChildren(style, el)
  }

  function mount(host) {
    if (host.dataset.heldReady) return
    host.dataset.heldReady = '1'
    var target = parse(host.dataset.heldLink || '')
    if (!target) {
      console.warn('[Held] data-held-link is not a Held checkout link. Copy one from your Held dashboard (Checkout links).', host)
      return
    }
    render(host, target, null, false) // usable at once; the price fills in when it arrives
    fetch(target.origin + '/api/links/' + target.id)
      .then(function (r) {
        if (r.status === 404) return { missing: true }
        return r.ok ? r.json().then(function (l) { return { info: l } }) : null
      })
      .then(function (res) {
        if (res) render(host, target, res.info || null, !!res.missing)
      })
      .catch(function () {}) // offline or blocked: the button still opens the link, and Held's page says the rest
  }

  function scan() {
    var hosts = document.querySelectorAll('[data-held-link]')
    for (var i = 0; i < hosts.length; i++) mount(hosts[i])
  }
  scan()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan)
  // Site builders sometimes add sections after load (tabs, popups, CMS lists): pick up buttons added later too.
  if (window.MutationObserver) {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) if (records[i].addedNodes.length) return scan()
    }).observe(document.documentElement, { childList: true, subtree: true })
  }
})()
