// Tempo Wallet end-to-end in a throwaway Chrome for Testing profile, with a CDP virtual WebAuthn authenticator
// standing in for Touch ID. Creates a real Tempo Wallet passkey account on wallet.tempo.xyz (testnet), then drives
// Held's buyer page: connect -> pay -> confirm delivery (release), and a second order: pay -> dispute.
// Usage: node e2e/tempo-wallet.mjs   (server must be running on :8787)
import puppeteer from 'puppeteer-core'
import { mkdirSync, readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const here = new URL('./', import.meta.url).pathname
const APP = process.env.APP || 'http://localhost:8787'
const find = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.name === 'Google Chrome for Testing' && !e.isDirectory()) return p; if (e.isDirectory()) { const r = find(p); if (r) return r } } }
const executablePath = find(join(here, '.cft'))
mkdirSync(join(here, 'shots'), { recursive: true })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath, headless: process.env.HEADFUL ? false : 'new',
  userDataDir: mkdtempSync(join(tmpdir(), 'held-tempo-wallet-')), // fresh throwaway profile every run
  args: ['--no-first-run', '--no-default-browser-check', '--window-size=1280,900'],
  defaultViewport: { width: 1280, height: 900 },
})
const results = []
const check = (name, pass, detail = '') => { results.push(pass); log(pass ? 'PASS' : 'FAIL', name, detail) }

// Attach a virtual authenticator to every page target (Tempo Wallet opens a new popup per request). A real device's
// keychain is shared across windows, so mirror that: remember every passkey created and add it to each new authenticator.
const creds = new Map() // credentialId -> credential
const authSessions = []
async function syncCreds() {
  for (const { s, id } of authSessions) {
    const r = await s.send('WebAuthn.getCredentials', { authenticatorId: id }).catch(() => null)
    for (const c of r?.credentials || []) creds.set(c.credentialId, c)
  }
}
setInterval(syncCreds, 500).unref()
async function addAuthenticator(target) {
  if (target.type() !== 'page') return
  try {
    const s = await target.createCDPSession()
    await s.send('WebAuthn.enable')
    const { authenticatorId: id } = await s.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
    for (const c of creds.values()) await s.send('WebAuthn.addCredential', { authenticatorId: id, credential: c }).catch(() => {})
    authSessions.push({ s, id })
  } catch {}
}
browser.on('targetcreated', addAuthenticator)

const api = async (path, body) => (await fetch(APP + '/api' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json()
const text = (page, sel) => page.$eval(sel, (e) => e.innerText).catch(() => '')
async function clickText(frameOrPage, re, timeout = 20000) {
  const t = Date.now()
  while (Date.now() - t < timeout) {
    const ok = await frameOrPage.evaluate((src) => {
      const r = new RegExp(src, 'i')
      const el = [...document.querySelectorAll('button, a, [role=button]')].find((b) => r.test(b.innerText || b.getAttribute('aria-label') || '') && !b.disabled)
      if (el) { el.click(); return true }
      return false
    }, re.source).catch(() => false)
    if (ok) return true
    await sleep(400)
  }
  return false
}
// Approve whatever the wallet popup asks (sign up / confirm), logging each screen so UI changes are easy to debug.
async function approveWallet(page, what, timeout = 60000) {
  const t = Date.now()
  const labels = /^(create account|continue|confirm|approve|pay( \$[\d,.]+)?|send|sign|sign transaction|submit|allow)$/i
  let clicks = 0, lastText = ''
  while (Date.now() - t < timeout) {
    if (await what.done?.()) return clicks
    const surfaces = [...page.frames().filter((f) => /wallet\.tempo\.xyz/.test(f.url())),
      ...(await browser.pages()).filter((p) => /wallet\.tempo\.xyz/.test(p.url()))]
    for (const s of surfaces) {
      const state = await s.evaluate(() => ({ text: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
        hasLabel: !!document.querySelector('input') && !document.querySelector('input').value })).catch(() => null)
      if (!state || !state.text) continue
      if (state.text !== lastText) { log(`  wallet popup: ${state.text}`); lastText = state.text }
      if (state.hasLabel && /Create account/.test(state.text)) {
        const inp = await s.$('input'); await inp.type('held-e2e-' + Date.now().toString(36))
      }
      const clicked = await s.evaluate((src) => {
        const r = new RegExp(src, 'i')
        const el = [...document.querySelectorAll('button')].find((b) => r.test((b.innerText || '').trim()) && !b.disabled && b.offsetParent !== null)
        if (el) { el.click(); return el.innerText.trim() }
        return null
      }, labels.source).catch(() => null)
      if (clicked) { clicks++; log(`  wallet: clicked "${clicked}"`); await sleep(2000) }
    }
    await sleep(700)
  }
  return clicks
}

const page = await browser.newPage()
await addAuthenticator(page.target())
try {
  // ORDER 1: connect Tempo Wallet -> pay -> confirm delivery
  const o1 = await api('/orders', { item: 'Tempo Wallet test: notebook', amount: '2' })
  await page.goto(`${APP}/#/pay/${o1.id}`, { waitUntil: 'networkidle2' })
  await clickText(page, /Pay with Tempo Wallet/)
  const connected = { done: async () => /Tempo Wallet\)/.test(await text(page, '.walletbox')), toString: () => 'connect' }
  await approveWallet(page, connected, 90000)
  await page.screenshot({ path: join(here, 'shots/tw-1-connected.png') }).catch(() => {})
  const wb = await text(page, '.walletbox')
  check('Tempo Wallet connects (passkey account created)', /Tempo Wallet\)/.test(wb), wb.split('\n')[1])

  // wait for faucet top-up
  for (let i = 0; i < 30 && !/\$[1-9][\d,]*\.\d\d pathUSD/.test(await text(page, '.walletbox')); i++) await sleep(1000)
  await clickText(page, /^Pay \$/)
  await approveWallet(page, { done: async () => /Payment held/.test(await text(page, '.pay')) }, 90000)
  await page.screenshot({ path: join(here, 'shots/tw-2-held.png') }).catch(() => {})
  check('pay with Tempo Wallet -> held', /Payment held/.test(await text(page, '.pay')))

  await clickText(page, /I got it/)
  await approveWallet(page, { done: async () => /merchant has been paid/i.test(await text(page, '.pay')) || /🔒/.test(await text(page, '.pay')) }, 90000)
  await page.screenshot({ path: join(here, 'shots/tw-3-released.png') }).catch(() => {})
  let o = await api(`/orders/${o1.id}`)
  for (let i = 0; i < 15 && o.status !== 'released'; i++) { await sleep(1000); o = await api(`/orders/${o1.id}`) }
  check('confirm delivery (arbiter.release) signed by Tempo Wallet -> released', o.status === 'released', o.status + ' ' + (await text(page, '.result')))

  // ORDER 2: same wallet -> pay -> dispute
  const o2 = await api('/orders', { item: 'Tempo Wallet test: logo', amount: '1' })
  await page.goto(`${APP}/#/pay/${o2.id}`, { waitUntil: 'networkidle2' })
  await sleep(1500)
  if (!/Tempo Wallet\)/.test(await text(page, '.walletbox'))) {
    await clickText(page, /Pay with Tempo Wallet/)
    await approveWallet(page, connected, 60000)
  }
  await clickText(page, /^Pay \$/)
  await approveWallet(page, { done: async () => /Payment held/.test(await text(page, '.pay')) }, 90000)
  await clickText(page, /open dispute/)
  await approveWallet(page, { done: async () => /Dispute open/.test(await text(page, '.pay')) || /🔒/.test(await text(page, '.pay')) }, 90000)
  await page.screenshot({ path: join(here, 'shots/tw-4-disputed.png') }).catch(() => {})
  o = await api(`/orders/${o2.id}`)
  for (let i = 0; i < 15 && o.status !== 'disputed'; i++) { await sleep(1000); o = await api(`/orders/${o2.id}`) }
  check('open dispute (arbiter.dispute) signed by Tempo Wallet -> disputed', o.status === 'disputed', o.status)
  const payer = o.payments[0]?.payer
  log('Tempo Wallet account', payer, '| orders', o1.id, o2.id)
} catch (e) {
  log('ERROR', e.message)
  await page.screenshot({ path: join(here, 'shots/tw-error.png') }).catch(() => {})
  results.push(false)
} finally {
  await browser.close()
}
const bad = results.filter((x) => !x).length
log(`${results.length - bad}/${results.length} checks passed`)
process.exit(bad ? 1 : 0)
