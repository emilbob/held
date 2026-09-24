// Held API core: storage-agnostic request handling + on-demand indexing.
// Used by both the local node server (server/server.mjs, JSON file) and the Vercel function (api/index.js, Redis).
//
//   GET  /api/config                      public deployment info
//   GET  /api/orders                      all orders (merchant dashboard)       -> syncs chain first
//   GET  /api/orders/:id                  one order (buyer page)                -> syncs chain first
//   POST /api/orders {amount, item}       create an order -> per-order virtual address (no tx)
//   POST /api/faucet {address}            testnet top-up for demo/connected wallets
//   POST /api/admin/<action> {paymentId}  merchant / resolver actions (x-held-admin token)
//   POST /api/admin/reset                 fresh demo: no orders, next order #1042, index from the current block
//
// Held never signs for buyers: buyer wallets call HeldArbiter directly. The merchant/resolver keys below are those
// roles' own testnet keys, and the arbiter contract still limits every outcome to "merchant" or "original payer".
import { parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Actions } from 'viem/tempo'
import { createIndexer, orderView } from './indexer.mjs'
import { orderAddress, walletFor, pub } from '../scripts/lib.mjs'

const GUARD = '0xB10C000000000000000000000000000000000000'
const guardAbi = [{ name: 'claim', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: 'to' }, { type: 'bytes', name: 'receipt' }], outputs: [] },
  { name: 'UnauthorizedClaimer', type: 'error', inputs: [] }, { name: 'InvalidClaimAddress', type: 'error', inputs: [] }, { name: 'InvalidReceipt', type: 'error', inputs: [] }]

export const emptyDb = (lastBlock) => ({ orders: {}, payments: {}, lastBlock, nextOrderId: 1042 })

/**
 * @param deployment  public deployment.json
 * @param abi         HeldArbiter ABI
 * @param db          { read(): Promise<db|null>, write(db): Promise<void>, lock(fn, {wait}): Promise<any>, rateLimit(key, ms): Promise<boolean> }
 * @param keys        { merchantKey, resolverKey, adminToken }
 */
export function createApi({ deployment, abi, db, keys }) {
  const merchantW = keys.merchantKey && walletFor(privateKeyToAccount(keys.merchantKey))
  const resolverW = keys.resolverKey && walletFor(privateKeyToAccount(keys.resolverKey))
  let head = 0n, lastErr = null, lastSync = 0

  async function load() {
    return (await db.read()) ?? emptyDb((await pub.getBlockNumber()).toString()) // first run: index from now
  }
  // Read-modify-write under a lock so concurrent serverless invocations don't lose updates.
  const mutate = (fn) => db.lock(async () => { const s = await load(); const r = await fn(s); await db.write(s); return r }, { wait: true })

  async function sync(force = false) {
    if (!force && Date.now() - lastSync < 1000) return
    lastSync = Date.now()
    try {
      // If another invocation is already syncing, just read what it wrote.
      await db.lock(async () => {
        const s = await load()
        head = await createIndexer({ store: s, deployment }).sync()
        await db.write(s)
      }, { wait: false })
      lastErr = null
    } catch (e) { lastErr = e.shortMessage || e.message }
  }

  async function adminAction(action, pay) {
    const wallet = action.startsWith('resolve') ? resolverW : merchantW
    if (!wallet) return { ok: false, error: 'role key not configured' }
    try {
      if (action === 'try-grab') {
        // Demo proof: the merchant tries to pull held funds straight from the protocol guard. Must revert.
        await pub.simulateContract({ account: wallet.account, address: GUARD, abi: guardAbi, functionName: 'claim', args: [deployment.merchant, pay.receipt] })
        return { ok: true, grabbed: true, note: 'UNEXPECTED: claim would succeed' }
      }
      const fn = { refund: 'refund', release: 'release', 'resolve-release': 'release', 'resolve-refund': 'refund' }[action]
      await pub.simulateContract({ account: wallet.account, address: deployment.arbiter, abi, functionName: fn, args: [pay.receipt] })
      const hash = await wallet.writeContract({ address: deployment.arbiter, abi, functionName: fn, args: [pay.receipt], gas: 2_000_000n })
      const rc = await pub.waitForTransactionReceipt({ hash })
      await sync(true)
      return { ok: rc.status === 'success', tx: hash }
    } catch (e) {
      return { ok: false, reverted: true, error: e.cause?.data?.errorName || e.shortMessage || e.message }
    }
  }

  /** @returns {Promise<{status:number, body:any}>} */
  async function handle(method, path, headers, body = {}) {
    const ok = (b, status = 200) => ({ status, body: b })
    if (method === 'OPTIONS') return ok({}, 204)
    if (path === '/api/config') return ok({ ...deployment, head: head.toString(), indexerError: lastErr, now: Math.floor(Date.now() / 1000) })

    if (path === '/api/orders' && method === 'POST') {
      const { amount, item } = body
      if (!amount || !/^\d+(\.\d{1,6})?$/.test(String(amount))) return ok({ error: 'Amount must be a number like 20 or 12.50' }, 400)
      const view = await mutate((s) => {
        const id = s.nextOrderId++
        const order = { id, item: String(item || `Order #${id}`).slice(0, 120), amount: parseUnits(String(amount), 6).toString(),
          address: orderAddress(deployment.masterId, id), createdAt: Math.floor(Date.now() / 1000) }
        s.orders[id] = order
        return orderView(s, order)
      })
      return ok(view, 201)
    }
    if (path === '/api/orders') {
      await sync()
      const s = await load()
      const list = Object.values(s.orders).sort((a, b) => b.id - a.id).map((o) => orderView(s, o))
      return ok({ orders: list })
    }
    const m = path.match(/^\/api\/orders\/(\d+)$/)
    if (m) {
      await sync()
      const s = await load()
      const o = s.orders[m[1]]
      return o ? ok(orderView(s, o)) : ok({ error: 'Order not found' }, 404)
    }
    if (path === '/api/faucet' && method === 'POST') {
      const { address } = body
      if (!/^0x[0-9a-fA-F]{40}$/.test(address || '')) return ok({ error: 'bad address' }, 400)
      if (!(await db.rateLimit(`faucet:${address.toLowerCase()}`, 60_000))) return ok({ error: 'wait a minute' }, 429)
      await Actions.faucet.fundSync(pub, { account: address })
      return ok({ ok: true })
    }
    const a = path.match(/^\/api\/admin\/(refund|release|resolve-release|resolve-refund|try-grab|reset)$/)
    if (a && method === 'POST') {
      if ((headers['x-held-admin'] || '') !== keys.adminToken) return ok({ error: 'Merchant and resolver actions need the demo admin token.' }, 401)
      if (a[1] === 'reset') {
        const fresh = emptyDb((await pub.getBlockNumber()).toString())
        await db.lock(() => db.write(fresh), { wait: true })
        return ok({ ok: true, nextOrderId: fresh.nextOrderId, fromBlock: fresh.lastBlock })
      }
      const s = await load()
      const pay = s.payments[body.paymentId]
      if (!pay) return ok({ error: 'payment not found' }, 404)
      return ok(await adminAction(a[1], pay))
    }
    return ok({ error: 'not found' }, 404)
  }

  return { handle, sync }
}

export const toJson = (b) => JSON.stringify(b, (k, v) => (typeof v === 'bigint' ? v.toString() : v))
