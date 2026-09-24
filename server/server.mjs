// Held API server + indexer loop.
//   GET  /api/config                  public deployment info (chain, arbiter, merchant, window, token)
//   POST /api/orders {amount, item}   create an order -> per-order virtual address (no tx)
//   GET  /api/orders                  all orders (merchant dashboard)
//   GET  /api/orders/:id              one order (buyer pay / dispute page)
// Held never signs a release/refund on anyone's behalf: the browser wallet calls HeldArbiter directly.
// The API only hands out the receipt bytes those calls need.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { parseUnits } from 'viem'
import { openStore } from './store.mjs'
import { createIndexer, orderView } from './indexer.mjs'
import { orderAddress } from '../scripts/lib.mjs'

const root = new URL('../', import.meta.url).pathname
const deployment = JSON.parse(readFileSync(join(root, 'deployment.json'), 'utf8'))
const store = openStore(process.env.HELD_DB || join(root, '.state/db.json'))
const indexer = createIndexer({ store, deployment })
const PORT = Number(process.env.PORT || 8787)
const STATIC = join(root, 'web/dist')

let head = 0n, lastErr = null
async function loop() {
  try { head = await indexer.sync(); lastErr = null } catch (e) { lastErr = e.shortMessage || e.message; console.error('sync', lastErr) }
  setTimeout(loop, Number(process.env.POLL_MS || 1500))
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' })
  res.end(JSON.stringify(body, (k, v) => (typeof v === 'bigint' ? v.toString() : v)))
}
const readBody = (req) => new Promise((ok, fail) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}) } catch (e) { fail(e) } })
})

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const p = url.pathname
  try {
    if (req.method === 'OPTIONS') return json(res, 204, {})
    if (p === '/api/config') return json(res, 200, { ...deployment, head, indexerError: lastErr, now: Math.floor(Date.now() / 1000) })
    if (p === '/api/orders' && req.method === 'POST') {
      const { amount, item } = await readBody(req)
      if (!amount || !/^\d+(\.\d{1,6})?$/.test(String(amount))) return json(res, 400, { error: 'amount must be a number like 20 or 12.50' })
      const id = store.nextOrderId++
      const order = { id, item: String(item || `Order #${id}`).slice(0, 120), amount: parseUnits(String(amount), 6).toString(),
        address: orderAddress(deployment.masterId, id), createdAt: Math.floor(Date.now() / 1000) }
      store.orders[id] = order
      store.save()
      return json(res, 201, orderView(store, order))
    }
    if (p === '/api/orders') {
      const list = Object.values(store.orders).sort((a, b) => b.id - a.id).map((o) => orderView(store, o))
      const orderIds = new Set(Object.keys(store.orders).map(Number))
      const unmatched = Object.values(store.payments).filter((x) => !orderIds.has(x.orderId))
      return json(res, 200, { orders: list, unmatched })
    }
    const m = p.match(/^\/api\/orders\/(\d+)$/)
    if (m) {
      const o = store.orders[m[1]]
      return o ? json(res, 200, orderView(store, o)) : json(res, 404, { error: 'order not found' })
    }
    if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' })
    // Static frontend (production build). SPA fallback to index.html.
    let file = normalize(join(STATIC, p))
    if (!file.startsWith(STATIC) || !existsSync(file) || p === '/') file = join(STATIC, 'index.html')
    if (!existsSync(file)) return json(res, 404, { error: 'frontend not built (cd web && npm run build)' })
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' })
    res.end(readFileSync(file))
  } catch (e) {
    json(res, 500, { error: e.message })
  }
})

server.listen(PORT, () => { console.log(`Held API on http://localhost:${PORT} (arbiter ${deployment.arbiter})`); loop() })
