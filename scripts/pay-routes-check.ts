// Regression guard for the hole an auditor found twice (u/Bloqarl, Nov 5-6): a way to pay that skips HeldPayCheck.
// Every route a buyer can pay by must go through W.payProtected (check + pay in one step; scripts/toggle-check.ts proves
// both of its routes revert when protection is off). This scans the web app, the site button and the plugins for
// anything that could move money to an order address without it: plain transfers, payment-request QR codes or
// "ethereum:" links, copying the pay-to address, or a token transfer built by hand. No network needed.
// Run: node scripts/pay-routes-check.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../', import.meta.url).pathname
const files = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
  const p = join(dir, f)
  if (f === 'node_modules' || f.startsWith('.')) return []
  return statSync(join(ROOT, p)).isDirectory() ? files(p) : /\.(tsx?|js|php|json)$/.test(f) ? [p] : []
})
const scanned = [...files('web/src'), 'web/public/button.js', ...files('wordpress'), 'web/package.json']

// What would let money reach a pay-to address unchecked.
const RISKS: [string, RegExp][] = [
  ['plain token transfer from the browser', /\bW\.transfer\(|\btransfer\(\s*wallet\b/],
  ['hand-built ERC-20 transfer call', /functionName:\s*'transfer'/],
  ['payment-request link (EIP-681)', /['"`]ethereum:/],
  ['QR code library', /\bqrcode\b|\bqr-code\b|QRCode/],
  ['copying the pay-to address', /clipboard\.writeText\([^)]*\b(order|o)\.address\b/],
]
// Reviewed exceptions, each with the reason it can't skip the check.
const ALLOWED: { file: string, risk: string, why: string }[] = [
  { file: 'web/src/wallet.ts', risk: 'hand-built ERC-20 transfer call', why: 'payProtected itself: the transfer is batched behind requireHeld' },
  { file: 'web/src/wallet.ts', risk: 'plain token transfer from the browser', why: 'the transfer helper is defined here; its only caller is the testnet wrong-token button' },
  { file: 'web/src/Pay.tsx', risk: 'plain token transfer from the browser', why: 'testnet-only "pay with the wrong token" button: sends a token the shop does not accept (held, refundable only)' },
]

let failed = 0
const hits: string[] = []
for (const f of scanned) {
  let text: string
  try { text = readFileSync(join(ROOT, f), 'utf8') } catch { continue }
  for (const [risk, re] of RISKS) {
    if (!re.test(text)) continue
    const ok = ALLOWED.find((a) => a.file === f && a.risk === risk)
    hits.push(`${ok ? 'ALLOWED' : 'FAIL   '} ${relative('.', f)}: ${risk}${ok ? ` (${ok.why})` : ''}`)
    if (!ok) failed++
  }
}
// The two places a buyer pays must call payProtected.
for (const f of ['web/src/Pay.tsx', 'web/src/Cheat.tsx']) {
  const uses = readFileSync(join(ROOT, f), 'utf8').includes('W.payProtected(')
  hits.push(`${uses ? 'PASS   ' : 'FAIL   '} ${f}: pays through W.payProtected`)
  if (!uses) failed++
}
// The wrong-token button must stay testnet-only.
const pay = readFileSync(join(ROOT, 'web/src/Pay.tsx'), 'utf8')
const gated = /w\.testnet && W\.WRONG_TOKEN && \(/.test(pay)
hits.push(`${gated ? 'PASS   ' : 'FAIL   '} web/src/Pay.tsx: wrong-token button only on testnet`)
if (!gated) failed++

console.log(hits.join('\n'))
console.log(`\n${scanned.length} files scanned. ${failed ? `${failed} FAILED` : 'Every buyer payment goes through HeldPayCheck.'}`)
process.exit(failed ? 1 : 0)
