// Shared helpers for the browser e2e tests: throwaway Chrome for Testing (+ unpacked MetaMask), fresh temp profile per run.
// The seed phrase is generated fresh per run, lives only in memory and in the throwaway profile, and is never written
// to the repo or reused.
import puppeteer, { type Page } from 'puppeteer-core'
import { readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Order } from '../shared/api.ts'
import { merchantSession } from '../scripts/test-merchant.ts'

export const here = new URL('./', import.meta.url).pathname
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
const find = (dir: string): string | undefined => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.name === 'Google Chrome for Testing' && !e.isDirectory()) return p; if (e.isDirectory()) { const r = find(p); if (r) return r } } }

export const chromeForTesting = () => find(join(here, '.cft'))

// Held API client for the app under test (APP env, default the local server).
export const APP = process.env.APP || 'http://localhost:8787'
export const api = async <T = Order>(path: string, body?: unknown, token?: string): Promise<T> =>
  (await fetch(APP + '/api' + path, body ? { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) } : {})).json()

// Orders are created by a signed-in merchant, as in the real app (a reusable test merchant; see scripts/test-merchant.ts).
let merchantToken: Promise<string> | undefined
export const createOrder = async (item: string, amount: string) => api('/orders', { item, amount }, await (merchantToken ??= merchantSession(APP)))

// PASS/FAIL log + tally; finish() prints the total and exits non-zero on any failure.
export const results: boolean[] = []
export const check = (name: string, pass: boolean, detail: unknown = '') => { results.push(pass); log(pass ? 'PASS' : 'FAIL', name, detail) }
export const finish = () => {
  const bad = results.filter((x) => !x).length
  log(`${results.length - bad}/${results.length} checks passed`)
  process.exit(bad ? 1 : 0)
}

export async function launchWithMetaMask() {
  const ext = join(here, '.metamask/ext')
  const browser = await puppeteer.launch({
    executablePath: chromeForTesting(),
    headless: process.env.HEADFUL ? false : true, // headless by default: no visible window anyone can click into
    userDataDir: mkdtempSync(join(tmpdir(), 'held-metamask-')),
    args: ['--no-first-run', '--no-default-browser-check', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--window-size=1280,900'],
    defaultViewport: null,
    enableExtensions: [ext],
    pipe: true,
  })
  // Find MetaMask's extension id from its service worker.
  let id: string | undefined
  for (let i = 0; i < 40 && !id; i++) {
    const sw = browser.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'))
    if (sw) id = new URL(sw.url()).host
    else await sleep(500)
  }
  if (!id) throw new Error('MetaMask service worker not found')
  return { browser, id }
}

// Screen text + clickable controls, for logging and debugging onboarding UI changes.
export const screen = (p: Page) => p.evaluate(() => ({
  text: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
  controls: [...document.querySelectorAll<HTMLInputElement>('button, [role=button], input, [data-testid]')]
    .filter((e) => e.offsetParent !== null)
    .map((e) => `${e.tagName.toLowerCase()}${e.dataset.testid ? '#' + e.dataset.testid : ''}${e.type ? '[' + e.type + ']' : ''}:${(e.innerText || e.placeholder || '').trim().slice(0, 30)}${e.disabled ? '(disabled)' : ''}`)
    .slice(0, 40),
})).catch((e: Error) => ({ err: e.message, text: undefined }))

export const clickTestId = (p: Page, id: string) => p.evaluate((id) => { const e = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`); if (e && !e.disabled) { e.click(); return true } return false }, id).catch(() => false)
export const clickText = (p: Page, re: RegExp) => p.evaluate((src) => {
  const e = [...document.querySelectorAll<HTMLButtonElement>('button, [role=button], a')].find((b) => new RegExp(src, 'i').test((b.innerText || '').trim()) && !b.disabled && b.offsetParent !== null)
  if (e) { e.click(); return e.innerText.trim() } return null
}, re.source).catch(() => null)
