// Local Held server: the shared API core (server/core.ts) over a JSON file + the built frontend.
// Production runs the same core as a Vercel function (api/index.ts) with Upstash Redis.
import { createServer, type IncomingMessage } from 'node:http'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { extname, join, normalize, dirname } from 'node:path'
import { createApi, emptyDb, toJson, type DbAdapter } from './core.ts'
import type { Db, Network } from '../shared/api.ts'

const root = new URL('../', import.meta.url).pathname
const network: Network = JSON.parse(readFileSync(join(root, 'network.json'), 'utf8'))
// db-v2: the multi-merchant store. The demo-era .state/db.json is left untouched.
const DB = process.env.HELD_DB || join(root, '.state/db-v2.json')
const PORT = Number(process.env.PORT || 8787)
const STATIC = join(root, 'web/dist')

// Single process, so the "lock" is a promise chain and rate limits live in memory.
let chain: Promise<unknown> = Promise.resolve(), busy = false
const seen = new Map<string, number>()
const db: DbAdapter = {
  async read() {
    if (!existsSync(DB)) return null
    return JSON.parse(readFileSync(DB, 'utf8')) as Db
  },
  async write(d) { mkdirSync(dirname(DB), { recursive: true }); writeFileSync(DB + '.tmp', JSON.stringify(d, null, 2)); renameSync(DB + '.tmp', DB) },
  lock(fn, { wait }) {
    if (!wait && busy) return Promise.resolve(undefined)
    const run = chain.then(async () => { busy = true; try { return await fn() } finally { busy = false } })
    chain = run.catch(() => {})
    return run
  },
  async rateLimit(key, ms) { if (Date.now() - (seen.get(key) || 0) < ms) return false; seen.set(key, Date.now()); return true },
}
// First run with HELD_ORDER_START (used by the e2e scripts): seed an empty DB with that order number.
if (process.env.HELD_ORDER_START && !existsSync(DB)) {
  const { pub } = await import('../scripts/lib.ts')
  await db.write(emptyDb((await pub.getBlockNumber()).toString(), Number(process.env.HELD_ORDER_START)))
}

const api = createApi({ network, db })

const readBody = (req: IncomingMessage) => new Promise<Record<string, unknown>>((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}) } catch { ok({}) } }) })

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x'), p = url.pathname
  try {
    if (p.startsWith('/api/')) {
      const { status, body } = await api.handle(req.method ?? 'GET', p, req.headers, req.method === 'POST' ? await readBody(req) : {}, url.searchParams)
      res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization' })
      return res.end(toJson(body))
    }
    let file = normalize(join(STATIC, p))
    if (!file.startsWith(STATIC) || !existsSync(file) || p === '/') file = join(STATIC, 'index.html')
    if (!existsSync(file)) { res.writeHead(404); return res.end('frontend not built (cd web && npm run build)') }
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' })
    res.end(readFileSync(file))
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' }); res.end(toJson({ error: (e as Error).message }))
  }
}).listen(PORT, () => {
  console.log(`Held API on http://localhost:${PORT} (chain ${network.chainId}${network.testnet ? ', testnet' : ''})`)
  // Keep indexing in the background locally too, so the dashboard updates without being polled.
  const tick = () => api.sync().finally(() => setTimeout(tick, Number(process.env.POLL_MS || 1500)))
  tick()
})
