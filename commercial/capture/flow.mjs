// Commercial UI capture, as a flow: one real sandbox purchase on getheld.xyz (Tempo testnet, test funds only),
// recorded state by state so the screens in the film play the real payment process.
// The buyer has the order open on a laptop (1512×930 @2x) and on a phone (393×716 @3x) in the same browser profile,
// so both are the same wallet and both pages follow the order live. (Phone: 393 × 716 pt, the visible page area.)
//   laptop: checkout link opening ("Creating your protected order…") → the token → hover on Pay → "Sending…" → held,
//           countdown ticking (1 shot/s), the pointer resting on "I got it: release payment" and backing off
//   phone:  held, countdown ticking, a short scroll → "I got it: release payment" tapped → "Confirming…" → confirmed
// Every frame is saved with its capture time in flow/index.json. The run removes its checkout links from the shared
// Sandbox Shop when it is done. Run from the repo root: node commercial/capture/flow.mjs
import { createRequire } from 'module'
import { readdirSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const here = new URL('./', import.meta.url).pathname
const e2e = join(here, '../../e2e/')
const puppeteer = createRequire(e2e)('puppeteer-core')
const OUT = join(here, 'flow')
rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
const APP = 'https://getheld.xyz'
const ITEM = 'Walnut desk tray', PRICE = '64', WARM = 'Wallet warm-up'
const LAPTOP = { width: 1512, height: 930, deviceScaleFactor: 2 }
const PHONE = { width: 393, height: 716, deviceScaleFactor: 3, isMobile: true, hasTouch: true }   // the page area between a phone's status bar and URL bar

function findChrome(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.name === 'Google Chrome for Testing' && !e.isDirectory()) return p
    if (e.isDirectory()) { const r = findChrome(p); if (r) return r }
  }
  return null
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const text = (p) => p.evaluate(() => document.body.innerText)
async function waitText(p, re, ms = 120000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { if (re.test(await text(p))) return; await sleep(500) }
  throw new Error('timeout waiting for ' + re + '\n---\n' + (await text(p)).slice(0, 800))
}
// Centre and box (CSS px) of the first enabled, visible button matching re.
async function buttonBox(p, re) {
  for (let i = 0; i < 60; i++) {
    const b = await p.evaluate((src) => {
      const el = [...document.querySelectorAll('button')].find((x) => new RegExp(src).test(x.innerText.trim()) && !x.disabled && x.offsetParent)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }
    }, re.source)
    if (b) return b
    await sleep(1000)
  }
  throw new Error('no button ' + re)
}

const index = { capturedAt: new Date().toISOString(), app: APP, item: ITEM, price: PRICE, frames: [] }
const T0 = Date.now()
async function shot(p, name, meta = {}) {
  const t = (Date.now() - T0) / 1000
  await p.screenshot({ path: join(OUT, name + '.png') })
  index.frames.push({ name, t, ...meta })
}

// Slow motion for the UI's own animations (a status label decodes into place, the badge pulses): a virtual clock
// behind performance.now and requestAnimationFrame, plus the CSS animation playback rate. Screenshots in slow motion
// carry the page's animation time (vt, ms) so they play back at true speed. Date.now runs on the same clock, so the
// countdown slows with it; the chain does not.
const CLOCK = `(() => {
  const rn = performance.now.bind(performance), raf = window.requestAnimationFrame.bind(window), dn = Date.now
  let k = 1, rb = 0, vb = 0, drb = dn(), dvb = drb
  const v = (r) => vb + (r - rb) * k
  performance.now = () => v(rn())
  Date.now = () => Math.floor(dvb + (dn() - drb) * k)
  window.requestAnimationFrame = (cb) => raf((ts) => cb(v(ts)))
  // back at normal speed the clock rejoins real time, so the laptop's and the phone's countdowns agree again
  window.__slow = (f) => { if (f === 1) { vb = rb = rn(); dvb = drb = dn() } else { vb = v(rn()); rb = rn(); dvb = Date.now(); drb = dn() } k = f }
})()`
async function slow(p, f) {
  const cdp = await p.createCDPSession()
  await cdp.send('Animation.enable')
  await cdp.send('Animation.setPlaybackRate', { playbackRate: f })
  await cdp.detach()
  await p.evaluate((f) => window.__slow(f), f)
}
const vtime = (p) => p.evaluate(() => performance.now())
// Shots in slow motion until `until` holds, then `tail` ms (real) more.
async function slowShots(p, prefix, until, tail, meta = {}) {
  let doneAt = null
  for (let i = 0; i < 400; i++) {
    const vt = await vtime(p)
    const done = await until()
    await shot(p, `${prefix}_${String(i).padStart(3, '0')}`, { vt, done, ...meta })
    if (done && !doneAt) doneAt = Date.now()
    if (doneAt && Date.now() - doneAt > tail) break
  }
}

const browser = await puppeteer.launch({ executablePath: findChrome(join(e2e, '.cft')), headless: true, args: ['--no-first-run'] })
let m = null
// Remove this run's (and earlier runs') checkout links from the shared Sandbox Shop.
async function cleanup() {
  if (!m) return
  await m.reload({ waitUntil: 'networkidle2' }); await sleep(2500)
  for (let i = 0; i < 60; i++) {
    const ok = await m.evaluate((names) => {
      const l = [...document.querySelectorAll('.card.links .link')].find((x) => names.includes(x.querySelector('.item')?.textContent))
      if (!l) return false
      ;[...l.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Remove')?.click()
      return true
    }, [ITEM, WARM])
    if (!ok) break
    await sleep(300)
    await m.evaluate(() => [...document.querySelectorAll('.removeask button')].find((b) => b.innerText.trim() === 'Remove link')?.click())
    await sleep(1500)
  }
  log('cleanup: links removed')
}
try {
  log('merchant: checkout link')
  const mctx = await browser.createBrowserContext()
  m = await mctx.newPage()
  await m.setViewport(LAPTOP)
  await m.goto(APP + '/#/sandbox', { waitUntil: 'networkidle2' })
  await m.evaluate(() => localStorage.setItem('held.walletKind.merchant', 'sandbox'))
  await m.goto(APP + '/#/merchant', { waitUntil: 'networkidle2' })
  await waitText(m, /Held for buyers/); await sleep(1500)
  async function makeLink(item, price) {
    await m.click('.card.links input[aria-label="Product"]', { clickCount: 3 })
    await m.type('.card.links input[aria-label="Product"]', item, { delay: 20 })
    await m.click('.card.links input[aria-label="Price in USD"]', { clickCount: 3 })
    await m.type('.card.links input[aria-label="Price in USD"]', price, { delay: 20 })
    const create = await buttonBox(m, /^Create link$/)
    await m.mouse.click(create.cx, create.cy)
    await sleep(2500)
    const id = await m.evaluate((item) => {
      const l = [...document.querySelectorAll('.card.links .link')].find((x) => x.querySelector('.item')?.textContent === item)
      return l?.querySelector('code.addr')?.textContent.split('/buy/')[1]
    }, item)
    if (!id) throw new Error('link not created: ' + item)
    return id
  }
  const warmId = await makeLink(WARM, '1')
  const linkId = await makeLink(ITEM, PRICE)
  log('  links', warmId, linkId)

  // The buyer's test wallet is created and funded on a throwaway $1 link first, so the real checkout opens the way a
  // returning buyer sees it: wallet already connected. (A link remembers the order it made, hence a separate link.)
  log('buyer: wallet warm-up')
  const ctx = await browser.createBrowserContext()
  const L = await ctx.newPage()
  await L.evaluateOnNewDocument(CLOCK)
  await L.setViewport(LAPTOP)
  await L.goto(APP + '/#/buy/' + warmId)
  await waitText(L, /Awaiting payment/)
  { const b = await buttonBox(L, /^Test wallet in this browser$/); await L.mouse.click(b.cx, b.cy) }
  await waitText(L, /Pay \$1\.00/); await sleep(4000)

  log('laptop: open the checkout link')
  await L.mouse.move(1150, 300)
  await L.goto(APP + '/#/buy/' + linkId)
  for (let i = 0; i < 120; i++) {
    const ready = new RegExp(`Pay \\$${PRICE}\\.00`).test(await text(L))
    await shot(L, `L_open_${String(i).padStart(3, '0')}`, { ready })
    if (ready) break
    await sleep(100)
  }
  await waitText(L, new RegExp(`Pay \\$${PRICE}\\.00`)); await sleep(4000)
  const hash = await L.evaluate(() => location.hash)
  log('buyer: phone opens the same order')
  const Ph = await ctx.newPage()
  await Ph.evaluateOnNewDocument(CLOCK)
  await Ph.setViewport(PHONE)
  await Ph.goto(APP + '/' + hash, { waitUntil: 'networkidle2' })
  await waitText(Ph, /Awaiting payment/); await sleep(3000)
  await shot(Ph, 'P_awaiting')

  // Input goes to the tab in front (headless Chrome pauses rendering in background tabs, so a mouse move there stalls)
  log('laptop: pointer to the token, to Pay, click, sending, held')
  await L.bringToFront()
  await L.mouse.move(1150, 300)
  await sleep(400)
  await shot(L, 'L_awaiting')
  const pill = await buttonBox(L, /^pathUSD/)
  index.tokenButton = pill
  await L.mouse.move(pill.cx, pill.cy, { steps: 8 }); await sleep(300)
  await shot(L, 'L_hover_token', { pointer: [pill.cx, pill.cy] })
  await L.mouse.click(pill.cx, pill.cy); await sleep(300)
  await shot(L, 'L_token_chosen', { pointer: [pill.cx, pill.cy] })
  const pay = await buttonBox(L, new RegExp(`^Pay \\$${PRICE}\\.00`))
  index.payButton = pay
  await L.mouse.move(pay.cx + 40, pay.cy, { steps: 8 }); await sleep(300)
  await shot(L, 'L_hover', { pointer: [pay.cx + 40, pay.cy] })
  await slow(L, 0.1)
  await L.mouse.click(pay.cx + 40, pay.cy)
  await slowShots(L, 'L_pay', async () => /Payment held/.test(await text(L)), 9000, { pointer: [pay.cx + 40, pay.cy] })
  await slow(L, 1)
  await waitText(L, /Payment held/)
  await waitText(Ph, /Payment held/)
  // One shot per second on both, the countdown ticking. Laptop: at 8 s the pointer moves onto "I got it: release
  // payment" (its real hover state) and at 11 s backs off. Phone: at 3 s a short smooth scroll down the page.
  log('both: held, countdown ticking')
  const relL = await buttonBox(L, /^I got it: release payment$/)
  index.laptopReleaseButton = relL
  let ptr = [pay.cx + 40, pay.cy]
  for (let i = 0; i < 14; i++) {
    const s0 = Date.now()
    if (i === 8) { ptr = [relL.cx + 60, relL.cy]; await L.bringToFront(); await L.mouse.move(...ptr, { steps: 6 }) }
    if (i === 11) { ptr = [pay.cx + 40, pay.cy + 60]; await L.bringToFront(); await L.mouse.move(...ptr, { steps: 6 }) }
    await shot(L, `L_held_${String(i).padStart(2, '0')}`, { pointer: ptr })
    if (i === 3) {
      await Ph.bringToFront()
      for (let k = 1; k <= 10; k++) {
        await Ph.evaluate((d) => window.scrollBy(0, d), Math.round(9 * Math.sin((k / 10) * Math.PI) * 1.6))
        await shot(Ph, `P_scroll_${String(k).padStart(2, '0')}`)
      }
    }
    await shot(Ph, `P_held_${String(i).padStart(2, '0')}`)
    await sleep(Math.max(0, 1000 - (Date.now() - s0)))
  }
  index.phoneScroll = await Ph.evaluate(() => window.scrollY)

  log('phone: release')
  await Ph.bringToFront()
  const rel = await buttonBox(Ph, /^I got it: release payment$/)
  index.releaseButton = rel
  await slow(Ph, 0.1)
  await Ph.touchscreen.tap(rel.cx, rel.cy)
  await slowShots(Ph, 'P_rel', async () => /Delivery confirmed/.test(await text(Ph)), 9000)
  await slow(Ph, 1)
  await sleep(1500)
  await shot(Ph, 'P_released')
  await waitText(L, /Delivery confirmed/, 60000).catch(async () => { await L.reload({ waitUntil: 'networkidle2' }); await waitText(L, /Delivery confirmed/) })
  await sleep(1500)
  await shot(L, 'L_released')
} catch (e) {
  console.error('FAILED:', e.message)
  process.exitCode = 1
} finally {
  await cleanup().catch((e) => console.error('cleanup failed:', e.message))
  writeFileSync(join(OUT, 'index.json'), JSON.stringify(index, null, 2))
  log('frames', index.frames.length)
  await browser.close()
}
