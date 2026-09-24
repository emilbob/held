// Local Held server: the shared API core (server/core.mjs) over a JSON file + the built frontend.
// Production runs the same core as a Vercel function (api/index.js) with Upstash Redis.
import { createServer } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { extname, join, normalize, dirname } from 'node:path'
import { createApi, toJson } from './core.mjs'
import { loadState } from '../scripts/lib.mjs'

const root = new URL('../', import.meta.url).pathname
const deployment = JSON.parse(readFileSync(join(root, 'deployment.json'), 'utf8'))
const abi = JSON.parse(readFileSync(join(root, 'server/arbiter-abi.json'), 'utf8'))
const DB = process.env.HELD_DB || join(root, '.state/db.json')
const PORT = Number(process.env.PORT || 8787)
const STATIC = join(root, 'web/dist')

// Single process, so the "lock" is a promise chain and rate limits live in memory.
let chain = Promise.resolve(), busy = false
const seen = new Map()
const db = {
  async read() {
    if (!existsSync(DB)) return null
    const d = JSON.parse(readFileSync(DB, 'utf8'))
    if (process.env.HELD_ORDER_START && d.nextOrderId === undefined) d.nextOrderId = Number(process.env.HELD_ORDER_START)
    return d
  },
  async write(d) { mkdirSync(dirname(DB), { recursive: true }); writeFileSync(DB + '.tmp', JSON.stringify(d, null, 2)); renameSync(DB + '.tmp', DB) },
  lock(fn, { wait }) {
    if (!wait && busy) return Promise.resolve()
    const run = chain.then(async () => { busy = true; try { return await fn() } finally { busy = false } })
    chain = run.catch(() => {})
    return run
  },
  async rateLimit(key, ms) { if (Date.now() - (seen.get(key) || 0) < ms) return false; seen.set(key, Date.now()); return true },
}
// First run with HELD_ORDER_START (used by the e2e scripts): seed an empty DB with that order number.
if (process.env.HELD_ORDER_START && !existsSync(DB)) {
  const { pub } = await import('../scripts/lib.mjs')
  await db.write({ orders: {}, payments: {}, lastBlock: (await pub.getBlockNumber()).toString(), nextOrderId: Number(process.env.HELD_ORDER_START) })
}

const st = loadState()
const api = createApi({ deployment, abi, db, keys: {
  merchantKey: process.env.MERCHANT_KEY || st.merchantKey,
  resolverKey: process.env.RESOLVER_KEY || st.resolverKey,
  adminToken: process.env.HELD_ADMIN_TOKEN || 'demo',
} })

const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}) } catch { ok({}) } }) })

createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname
  try {
    if (p.startsWith('/api/')) {
      const { status, body } = await api.handle(req.method, p, req.headers, req.method === 'POST' ? await readBody(req) : {})
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-held-admin' })
      return res.end(toJson(body))
    }
    let file = normalize(join(STATIC, p))
    if (!file.startsWith(STATIC) || !existsSync(file) || p === '/') file = join(STATIC, 'index.html')
    if (!existsSync(file)) { res.writeHead(404); return res.end('frontend not built (cd web && npm run build)') }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' })
    res.end(readFileSync(file))
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' }); res.end(toJson({ error: e.message }))
  }
}).listen(PORT, () => {
  console.log(`Held API on http://localhost:${PORT} (arbiter ${deployment.arbiter})`)
  // Keep indexing in the background locally too, so the dashboard updates without being polled.
  const tick = () => api.sync().finally(() => setTimeout(tick, Number(process.env.POLL_MS || 1500)))
  tick()
})
