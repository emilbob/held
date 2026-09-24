// Shared helpers for the MetaMask e2e: throwaway Chrome for Testing + unpacked MetaMask, fresh temp profile per run.
// The seed phrase is generated fresh per run, lives only in memory and in the throwaway profile, and is never written
// to the repo or reused.
import puppeteer from 'puppeteer-core'
import { readdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const here = new URL('./', import.meta.url).pathname
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const find = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.name === 'Google Chrome for Testing' && !e.isDirectory()) return p; if (e.isDirectory()) { const r = find(p); if (r) return r } } }

export async function launchWithMetaMask() {
  const ext = join(here, '.metamask/ext')
  const browser = await puppeteer.launch({
    executablePath: find(join(here, '.cft')),
    headless: process.env.HEADFUL ? false : true, // headless by default: no visible window anyone can click into
    userDataDir: mkdtempSync(join(tmpdir(), 'held-metamask-')),
    args: ['--no-first-run', '--no-default-browser-check', `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--window-size=1280,900'],
    defaultViewport: null,
    enableExtensions: [ext],
    pipe: true,
  })
  // Find MetaMask's extension id from its service worker.
  let id
  for (let i = 0; i < 40 && !id; i++) {
    const sw = browser.targets().find((t) => t.type() === 'service_worker' && t.url().startsWith('chrome-extension://'))
    if (sw) id = new URL(sw.url()).host
    else await sleep(500)
  }
  if (!id) throw new Error('MetaMask service worker not found')
  return { browser, id }
}

// Screen text + clickable controls, for logging and debugging onboarding UI changes.
export const screen = (p) => p.evaluate(() => ({
  text: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 400),
  controls: [...document.querySelectorAll('button, [role=button], input, [data-testid]')]
    .filter((e) => e.offsetParent !== null)
    .map((e) => `${e.tagName.toLowerCase()}${e.dataset.testid ? '#' + e.dataset.testid : ''}${e.type ? '[' + e.type + ']' : ''}:${(e.innerText || e.placeholder || '').trim().slice(0, 30)}${e.disabled ? '(disabled)' : ''}`)
    .slice(0, 40),
})).catch((e) => ({ err: e.message }))

export const clickTestId = (p, id) => p.evaluate((id) => { const e = document.querySelector(`[data-testid="${id}"]`); if (e && !e.disabled) { e.click(); return true } return false }, id).catch(() => false)
export const clickText = (p, re) => p.evaluate((src) => {
  const e = [...document.querySelectorAll('button, [role=button], a')].find((b) => new RegExp(src, 'i').test((b.innerText || '').trim()) && !b.disabled && b.offsetParent !== null)
  if (e) { e.click(); return e.innerText.trim() } return null
}, re.source).catch(() => null)
