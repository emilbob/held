// MetaMask end-to-end for Held's browser-wallet path ("Connect MetaMask", listed via EIP-6963), in a throwaway Chrome for Testing profile.
//   - real MetaMask 13.49.0 (official GitHub release, SHA256 verified), loaded unpacked
//   - a NEW 12-word testnet seed generated in memory for this run only (never printed, stored or reused)
//   - tests: connect, add Tempo Moderato network, pay, confirm delivery (release), and on a 2nd order: dispute
// Usage: node e2e/metamask.ts   (server must be running on :8787)
import { generateMnemonic, english, mnemonicToAccount } from 'viem/accounts'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { Target } from 'puppeteer-core'
import type { EIP1193Provider } from 'viem'
import { launchWithMetaMask, screen, sleep, log, clickTestId, clickText, here, APP, api, check, results, finish } from './lib.ts'

declare global { interface Window { ethereum?: EIP1193Provider } }
const mnemonic = generateMnemonic(english)
const address = mnemonicToAccount(mnemonic).address
const PASSWORD = 'HeldE2E-throwaway-' + Math.random().toString(36).slice(2)
mkdirSync(join(here, 'shots'), { recursive: true })

const { browser, id } = await launchWithMetaMask()
log('throwaway MetaMask account', address)

// ---------------------------------------------------------------- onboarding (import the fresh seed)
async function onboard() {
  await sleep(2500)
  const mm = (await browser.pages()).find((p) => p.url().includes(id)) || await browser.newPage()
  if (!mm.url().includes(id)) await mm.goto(`chrome-extension://${id}/home.html#onboarding/welcome`)
  const step = async (fn: () => Promise<unknown>) => { await fn(); await sleep(1800) }
  const waitFor = async (sel: string) => { for (let i = 0; i < 30; i++) { const e = await mm.$(sel); if (e) return e; await sleep(500) } throw new Error('onboarding: missing ' + sel) }
  const waitTid = async (tid: string) => { for (let i = 0; i < 30; i++) { if (await clickTestId(mm, tid)) return; await sleep(500) } throw new Error('onboarding: missing ' + tid) }
  await step(() => waitTid('onboarding-import-wallet'))
  await step(() => waitTid('onboarding-import-with-srp-button'))
  await step(async () => (await waitFor('textarea')).type(mnemonic))
  await step(() => waitTid('import-srp-confirm'))
  await step(async () => { await waitFor('input[type=password]'); for (const i of await mm.$$('input[type=password]')) await i.type(PASSWORD); for (const c of await mm.$$('input[type=checkbox]')) await c.click() })
  await step(() => waitTid('create-password-submit'))
  await step(() => waitTid('passkey-maybe-later-button'))
  for (let i = 0; i < 6 && !(await clickTestId(mm, 'onboarding-complete-done')); i++) { await clickText(mm, /^(Continue|I agree|Got it|No thanks)$/); await sleep(1500) }
  await sleep(2500)
  const s = await screen(mm)
  await mm.close().catch(() => {})
  return s
}

// ---------------------------------------------------------------- MetaMask approval UI
// MetaMask 13.x shows approvals in Chrome's side panel (sidepanel.html), which puppeteer can't wrap as a Page,
// so drive every MetaMask surface through a raw CDP session with Runtime.evaluate.
type ApproveResult = { txt?: string, clicked?: string }
const evalIn = async (t: Target, expr: string): Promise<ApproveResult> => {
  const s = await t.createCDPSession()
  try { return (await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value } finally { await s.detach().catch(() => {}) }
}
const APPROVE_TIDS = ['confirm-btn', 'confirmation-submit-button', 'confirm-footer-button', 'page-container-footer-next']
const APPROVE_TEXT = '^(Connect|Approve|Confirm|Switch network|Add network|Next|Got it|Continue)$'
const approveScript = `(() => {
  const txt = (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 220)
  // MetaMask security alerts (e.g. "Review alert" when a public site suggests a network) open a modal that must be
  // acknowledged. Log its full text so the warning a real user sees is on record, then acknowledge it.
  const dlg = document.querySelector('[role=dialog], .mm-modal-content')
  if (dlg) {
    const alertTxt = 'ALERT: ' + (dlg.innerText || '').replace(/\\s+/g, ' ').slice(0, 700)
    const cb = [...dlg.querySelectorAll('input[type=checkbox]')].find((c) => !c.checked)
    if (cb) { cb.click(); return { txt: alertTxt, clicked: 'alert: acknowledge checkbox' } }
    const b = [...dlg.querySelectorAll('button')].find((b) => /^(Confirm|Got it|Acknowledge|I understand|Continue)$/i.test((b.innerText || '').trim()) && !b.disabled)
    if (b) { b.click(); return { txt: alertTxt, clicked: 'alert: ' + b.innerText.trim() } }
    return { txt: alertTxt }
  }
  const tids = ${JSON.stringify(APPROVE_TIDS)}
  let el = tids.map((t) => document.querySelector('[data-testid="' + t + '"]')).find((e) => e && !e.disabled)
  if (!el) el = [...document.querySelectorAll('button')].find((b) => new RegExp(${JSON.stringify(APPROVE_TEXT)}, 'i').test((b.innerText || '').trim()) && !b.disabled)
  if (el) { el.click(); return { txt, clicked: el.dataset.testid || el.innerText.trim() } }
  return { txt }
})()`

// Approves whatever MetaMask shows (connect, add network, switch network, transaction) until `done()` is true.
async function approveMetaMask(what: string, done: () => Promise<boolean>, timeout = 90000) {
  const t = Date.now(); let last = '', clicks = 0
  while (Date.now() - t < timeout) {
    if (await done()) return clicks
    const surfaces = browser.targets().filter((x) => x.type() === 'page' && x.url().includes(id) && /sidepanel|notification|popup/.test(x.url()))
    for (const s of surfaces) {
      const r = await evalIn(s, approveScript).catch(() => null)
      if (!r) continue
      const where = s.url().replace(/^chrome-extension:\/\/[^/]+\//, '').replace(/[?#].*?\/([^/]+)\/.*$/, '#$1')
      if (r.txt && r.txt !== last) { log(`  metamask[${what}] ${where}: ${r.txt}`); last = r.txt }
      if (r.clicked) { clicks++; log(`  metamask[${what}]: clicked ${r.clicked}`); await sleep(2000) }
    }
    await sleep(800)
  }
  return clicks
}

const held = await browser.newPage()
// Held's buttons stay disabled until the previous tx receipt resolves, so retry the click until it's enabled.
const clickHeld = async (re: RegExp, timeout = 30000) => { const t = Date.now(); while (Date.now() - t < timeout) { const r = await clickText(held, re); if (r) return r; await sleep(500) } return null }
const walletText = () => held.$eval('.walletbox', (e) => (e as HTMLElement).innerText).catch(() => '')
const payText = () => held.$eval('.pay', (e) => (e as HTMLElement).innerText).catch(() => '')
// Click a Held button and approve in MetaMask. If the page says the testnet is busy (RPC rate limit, nothing sent),
// do what the message tells a buyer to do: wait a few seconds and try again.
async function actInHeld(what: string, button: RegExp, done: RegExp) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await clickHeld(button)
    await approveMetaMask(what, async () => done.test(await payText()) || /🔒|testnet is busy/.test(await payText()))
    if (!/testnet is busy/.test(await payText())) return
    log(`  ${what}: testnet busy (rate limited), retrying in ${5 * attempt}s`)
    await sleep(5000 * attempt)
  }
}
try {
  const ob = await onboard()
  check('MetaMask onboarded with a fresh throwaway seed', true, (ob.text || '').slice(0, 60))

  // Fund the throwaway account on testnet (pathUSD pays gas on Tempo).
  await api('/faucet', { address })
  const o1 = await api('/orders', { item: 'MetaMask test: notebook', amount: '2' })
  await held.goto(`${APP}/#/pay/${o1.id}`, { waitUntil: 'networkidle2' })
  await sleep(1000)
  const hasBtn = await held.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^Connect MetaMask$/.test(b.innerText.trim())))
  check('"Connect MetaMask" listed when MetaMask is installed', hasBtn)
  await clickHeld(/^Connect MetaMask$/)
  await approveMetaMask('connect+network', async () => /\(MetaMask\)/.test(await walletText()))
  const wb = await walletText()
  check('connect + add/switch to Tempo Moderato (chainId 42431)', /\(MetaMask\)/.test(wb) && wb.toLowerCase().includes(address.slice(2, 6).toLowerCase()), wb.split('\n')[1])
  const chainId = await held.evaluate(() => window.ethereum!.request({ method: 'eth_chainId' }))
  check('MetaMask is on Tempo Moderato', chainId === '0xa5bf', chainId)
  await held.screenshot({ path: join(here, 'shots/mm-1-connected.png') }).catch(() => {})

  await actInHeld('pay', /^Pay \$/, /Payment held/)
  check('pay with MetaMask -> held', /Payment held/.test(await payText()), (await payText()).match(/(🔒|Tempo's testnet is busy).*/)?.[0] || '')
  await held.screenshot({ path: join(here, 'shots/mm-2-held.png') }).catch(() => {})

  await actInHeld('release', /^I got it/, /merchant has been paid/i)
  let o = await api(`/orders/${o1.id}`)
  for (let i = 0; i < 15 && o.status !== 'released'; i++) { await sleep(1000); o = await api(`/orders/${o1.id}`) }
  check('confirm delivery (arbiter.release) signed in MetaMask -> released', o.status === 'released', o.status)
  await held.screenshot({ path: join(here, 'shots/mm-3-released.png') }).catch(() => {})

  const o2 = await api('/orders', { item: 'MetaMask test: logo', amount: '1' })
  // Full reload (hash-only navigation keeps React state from order 1).
  await held.goto(`${APP}/?o=${o2.id}#/pay/${o2.id}`, { waitUntil: 'networkidle2' })
  await sleep(1500)
  log('  order 2 page before pay:', (await payText()).replace(/\s+/g, ' ').slice(0, 200))
  if (!/\(MetaMask\)/.test(await walletText())) { await clickHeld(/^Connect MetaMask$/); await approveMetaMask('reconnect', async () => /\(MetaMask\)/.test(await walletText())) }
  await actInHeld('pay2', /^Pay \$/, /Payment held/)
  log('  order 2 page after pay:', (await payText()).replace(/\s+/g, ' ').slice(0, 300))
  await actInHeld('dispute', /open dispute/, /Dispute open/)
  o = await api(`/orders/${o2.id}`)
  for (let i = 0; i < 15 && o.status !== 'disputed'; i++) { await sleep(1000); o = await api(`/orders/${o2.id}`) }
  check('open dispute (arbiter.dispute) signed in MetaMask -> disputed', o.status === 'disputed', o.status)
  await held.screenshot({ path: join(here, 'shots/mm-4-disputed.png') }).catch(() => {})
  log('orders', o1.id, o2.id)
} catch (e) {
  log('ERROR', (e as Error).message)
  await held.screenshot({ path: join(here, 'shots/mm-error.png') }).catch(() => {})
  results.push(false)
} finally {
  await browser.close()
}
finish()
