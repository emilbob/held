// Renders the link-preview image (web/public/og.png, 1200x630) shown when a Held link is shared in chats and social
// apps. Uses the e2e tests' Chrome for Testing. Usage: node e2e/og-image.ts
import { readFileSync } from 'node:fs'
import puppeteer from 'puppeteer-core'
import { chromeForTesting } from './lib.ts'

const logo = 'data:image/png;base64,' + readFileSync(new URL('../web/src/assets/held-logo.png', import.meta.url)).toString('base64')
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin: 0; width: 1200px; height: 630px; background: #0b0d10; color: #e8eaed; font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    display: flex; flex-direction: column; justify-content: center; padding: 0 96px; box-sizing: border-box }
  .brand { display: flex; align-items: center; gap: 22px; font-size: 64px; font-weight: 800; letter-spacing: -0.02em }
  .brand img { height: 84px }
  h1 { font-size: 58px; line-height: 1.15; margin: 44px 0 22px; letter-spacing: -0.02em; max-width: 960px }
  p { font-size: 30px; color: #8b93a3; margin: 0 }
  .accent { color: #D5F94F }
  .bar { position: absolute; left: 0; bottom: 0; width: 1200px; height: 12px; background: #D5F94F }
</style></head><body>
  <div class="brand"><img src="${logo}">Held</div>
  <h1>Buyer protection for <span class="accent">stablecoin payments</span></h1>
  <p>Pay from your own wallet. The chain holds it until delivery.</p>
  <div class="bar"></div>
</body></html>`

const browser = await puppeteer.launch({ executablePath: chromeForTesting(), headless: true, args: ['--no-first-run'] })
const page = await browser.newPage()
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 })
await page.setContent(html, { waitUntil: 'load' })
await page.screenshot({ path: new URL('../web/public/og.png', import.meta.url).pathname, type: 'png' })
await browser.close()
console.log('web/public/og.png written (1200x630)')
