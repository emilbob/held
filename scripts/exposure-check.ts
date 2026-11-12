// Exposure limits (shared/exposure.ts + server/core.ts): sums, one alert per crossing, and the pause in all three places.
// Runs the real API core in memory on a COPY of the live testnet database (read-only: nothing is written back), adds
// fake held payments, and intercepts the alert email instead of sending it. Needs DATABASE_URL (held/.env.local).
// Usage: node scripts/exposure-check.ts
import { createHash, randomBytes } from 'node:crypto'
import { pgAdapter } from '../server/pgdb.ts'
import { createApi, type DbAdapter } from '../server/core.ts'
import { exposureByShop, exposureCrossings, exposureLimits, totalExposure } from '../shared/exposure.ts'
import { network } from '../scripts/lib.ts'
import type { Db, StoredPayment } from '../shared/api.ts'

const results: boolean[] = []
const check = (name: string, pass: boolean, d: unknown = '') => { results.push(pass); console.log(pass ? 'PASS' : 'FAIL', name, d === '' ? '' : JSON.stringify(d)) }
const usd = (n: number) => String(BigInt(Math.round(n * 1e6)))

// ---------------------------------------------------------------- pure functions
const fake = (merchant: string, amount: number, status: StoredPayment['status'], heldAt = 1000): StoredPayment => ({
  id: `0x${randomBytes(32).toString('hex')}`, receipt: '0x', merchant: merchant as never, userTag: null, payer: '0x0000000000000000000000000000000000000001',
  recipient: '0x0000000000000000000000000000000000000002', token: '0x20C0000000000000000000000000000000000000', wrongToken: false,
  amount: usd(amount), heldAt, status, history: [], arbiter: '0x0000000000000000000000000000000000000003', windowEndsAt: heldAt + 300,
  txHash: '0x',
} as unknown as StoredPayment)
const A = '0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa', B = '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
const ps = [fake(A, 10, 'held', 500), fake(A, 5, 'disputed', 300), fake(A, 7, 'released'), fake(A, 3, 'refunded'), fake(B, 1.5, 'held')]
const by = exposureByShop({ payments: Object.fromEntries(ps.map((p) => [p.id, p])) })
check('sum counts held + disputed only', by.get(A.toLowerCase())?.amount === BigInt(usd(15)) && by.get(A.toLowerCase())?.count === 2)
check('oldest held payment is tracked', by.get(A.toLowerCase())?.oldest === 300)
check('total across shops', totalExposure(by) === BigInt(usd(16.5)))
const lim = { alertShop: BigInt(usd(20)), pauseShop: BigInt(usd(50)), alertTotal: BigInt(usd(100)) }
const mk = (a: number, b = 0) => new Map([[A.toLowerCase(), { amount: BigInt(usd(a)), count: 1, oldest: 0 }], [B.toLowerCase(), { amount: BigInt(usd(b)), count: 1, oldest: 0 }]])
let x = exposureCrossings(mk(19), mk(20), lim)
check('crossing the alert line fires once', x.shops.length === 1 && !x.paused.length && !x.total)
x = exposureCrossings(mk(20), mk(30), lim)
check('staying above it does not fire again', !x.shops.length)
x = exposureCrossings(mk(30), mk(10), lim); const back = exposureCrossings(mk(10), mk(25), lim)
check('falling below re-arms it', !x.shops.length && back.shops.length === 1)
x = exposureCrossings(mk(10), mk(60), lim)
check('jumping past both lines: alert + pause', x.shops.length === 1 && x.paused.length === 1)
x = exposureCrossings(mk(40, 50), mk(55, 50), lim)
check('total line crossed', x.total)
const mainLim = exposureLimits(JSON.parse((await import('node:fs')).readFileSync('network.mainnet.json', 'utf8')))
check('mainnet limits configured: $500 / $1000 / $2500', mainLim?.alertShop === 500_000000n && mainLim.pauseShop === 1000_000000n && mainLim.alertTotal === 2500_000000n)

// ---------------------------------------------------------------- the API core, in memory
if (!network.testnet) throw new Error('run with the testnet config')
const live = pgAdapter(process.env.DATABASE_URL!, 'held_testnet')
const snap = await live.read(); await live.end()
if (!snap) throw new Error('empty database')
let mem: Db = structuredClone(snap)
const memDb: DbAdapter = {
  read: async () => mem, write: async (d) => { mem = d }, lock: async (fn) => fn({ read: async () => mem, write: async (d) => { mem = d } }),
  rateLimit: async () => true, addFeedback: async () => {}, listFeedback: async () => [],
}
// Intercept the alert email (Resend) instead of sending it; every other fetch (the chain RPC) goes through.
const sent: { subject: string, text: string }[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: any) => {
  if (String(input).startsWith('https://api.resend.com/')) { const b = JSON.parse(init.body); sent.push({ subject: b.subject, text: b.text }); return new Response('{"id":"test"}', { status: 200 }) }
  return realFetch(input, init)
}) as typeof fetch
process.env.RESEND_API_KEY = 'test'; process.env.ALERT_EMAIL = 'test@example.invalid'

const api = createApi({ network, db: memDb })
const session = (address: string) => { const t = randomBytes(16).toString('hex'); mem.sessions[createHash('sha256').update(t).digest('hex')] = { address: address as never, exp: Math.floor(Date.now() / 1000) + 3600 }; return t }
const call = (method: string, path: string, token?: string, body: Record<string, unknown> = {}) =>
  api.handle(method, path, token ? { authorization: `Bearer ${token}` } : {}, body) as Promise<{ status: number, body: any }>

// A real (non-sandbox) testnet shop whose protection holds on the chain right now.
const sandbox = network.sandbox!.merchant.toLowerCase()
let shop: string | undefined, tok = ''
for (const m of Object.values(mem.merchants)) {
  if (m.address.toLowerCase() === sandbox) continue
  const t = session(m.address)
  if ((await call('GET', '/api/me', t)).body.protected === true) { shop = m.address.toLowerCase(); tok = t; break }
}
if (!shop) throw new Error('no protected non-sandbox shop on testnet to test with')
console.log('test shop:', mem.merchants[shop].name, shop)
const limits = exposureLimits(network)!
const waitingNow = () => exposureByShop(mem).get(shop!)?.amount ?? 0n
const addHeld = (amount: bigint) => { const p = fake(mem.merchants[shop!].address, Number(amount) / 1e6, 'held', Math.floor(Date.now() / 1000)); mem.payments[p.id] = p; return p }

const me0 = (await call('GET', '/api/me', tok)).body
check('/api/me reports the beta limit', me0.waitingLimit?.limit === limits.pauseShop.toString() && me0.waitingLimit.reached === false, me0.waitingLimit)
const ord = await call('POST', '/api/orders', tok, { amount: '2', item: 'exposure test' })
check('below the line: new order allowed (201)', ord.status === 201, ord.body.error)
const link = await call('POST', '/api/links', tok, { amount: '3', item: 'exposure link' })

// Push the shop past the pause line, then run a sync so the crossing is seen inside the lock.
if (waitingNow() < limits.pauseShop) addHeld(limits.pauseShop - waitingNow())
const before = exposureByShop(snap), after = exposureByShop(mem)
const crossed = exposureCrossings(before, after, limits)
check('crossing detected for the test shop', crossed.paused.includes(shop) && crossed.shops.includes(shop))
const { alertExposure } = await import('../server/alerts.ts')
await alertExposure(mem, network, crossed)
check('one alert email, marked paused', sent.length === 1 && /shop paused/.test(sent[0].subject) && sent[0].text.includes('PAUSED'), sent[0]?.subject)

const me1 = (await call('GET', '/api/me', tok)).body
check('/api/me: limit reached', me1.waitingLimit?.reached === true)
const o2 = await call('POST', '/api/orders', tok, { amount: '2', item: 'blocked' })
check('merchant: new order paused (409) with the beta-limit message', o2.status === 409 && /beta limit/.test(o2.body.error), o2.body.error)
const lo = await call('POST', `/api/links/${link.body.id}/orders`)
check('buyer opening a checkout link: paused (409)', lo.status === 409 && /beta limit/.test(lo.body.error), lo.body.error)
const view = await call('GET', `/api/orders/${ord.body.key}`)
check('buyer page of an unpaid order: limitReached', view.status === 200 && view.body.limitReached === true)

// The sandbox shop is never paused, whatever is waiting there.
const sbTok = session(network.sandbox!.merchant)
const sbAmt = limits.pauseShop * 2n
const p = fake(network.sandbox!.merchant, Number(sbAmt) / 1e6, 'held'); mem.payments[p.id] = p
const sbMe = (await call('GET', '/api/me', sbTok)).body
check('sandbox above the line: not paused', sbMe.waitingLimit?.reached === false)
const sbOrd = await call('POST', '/api/orders', sbTok, { amount: '1', item: 'sandbox still works' })
check('sandbox: new order still allowed (201)', sbOrd.status === 201, sbOrd.body.error)

// Settle the test payments: back below the line, orders resume.
for (const q of Object.values(mem.payments)) if (q.merchant.toLowerCase() === shop && q.status === 'held' && !snap.payments[q.id]) q.status = 'released'
const o3 = await call('POST', '/api/orders', tok, { amount: '2', item: 'resumed' })
check('after release: new orders resume (201)', o3.status === 201, o3.body.error)

globalThis.fetch = realFetch
const failed = results.filter((r) => !r).length
console.log(`\n${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''} (live database untouched)`)
process.exit(failed ? 1 : 0)
