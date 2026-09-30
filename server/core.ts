// Held API core: storage-agnostic request handling + on-demand indexing.
// Used by both the local node server (server/server.ts, JSON file) and the Vercel function (api/index.ts, Redis).
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
import { parseUnits, type Abi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Actions } from 'viem/tempo'
import { createIndexer, orderView } from './indexer.ts'
import { orderAddress, walletFor, pub } from '../scripts/lib.ts'
import type { AdminAction, AdminResult, Db, Deployment, StoredOrder, StoredPayment } from '../shared/api.ts'

const GUARD = '0xB10C000000000000000000000000000000000000'
const guardAbi = [{ name: 'claim', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: 'to' }, { type: 'bytes', name: 'receipt' }], outputs: [] },
  { name: 'UnauthorizedClaimer', type: 'error', inputs: [] }, { name: 'InvalidClaimAddress', type: 'error', inputs: [] }, { name: 'InvalidReceipt', type: 'error', inputs: [] }] as const

// 1..65535; 0 is the prefix of addresses from before per-database prefixes.
export const newTagPrefix = () => 1 + (crypto.getRandomValues(new Uint16Array(1))[0] % 65535)
export const emptyDb = (lastBlock: string, nextOrderId = 1042): Db =>
  ({ orders: {}, payments: {}, lastBlock, nextOrderId, tagPrefix: newTagPrefix() })

// Where the API keeps its state: a JSON file locally, Upstash Redis on Vercel.
export interface DbAdapter {
  read(): Promise<Db | null>
  write(d: Db): Promise<void>
  // wait: false -> skip (resolve undefined) if someone else holds the lock.
  lock<T>(fn: () => Promise<T>, opts: { wait: boolean }): Promise<T | undefined>
  rateLimit(key: string, ms: number): Promise<boolean>
}
export interface Keys { merchantKey?: Hex, resolverKey?: Hex, adminToken: string }
export interface ApiResponse { status: number, body: unknown }
type Headers = Record<string, string | string[] | undefined>

// viem errors nest the decoded revert under cause.data.
type ViemishError = { cause?: { data?: { errorName?: string } }, shortMessage?: string, message?: string }
const errText = (e: unknown) => (e as ViemishError).shortMessage || (e as ViemishError).message || String(e)

export function createApi({ deployment, abi, db, keys }: { deployment: Deployment, abi: Abi, db: DbAdapter, keys: Keys }) {
  const merchantW = keys.merchantKey && walletFor(privateKeyToAccount(keys.merchantKey))
  const resolverW = keys.resolverKey && walletFor(privateKeyToAccount(keys.resolverKey))
  let head = 0n, lastErr: string | null = null, lastSync = 0

  async function load(): Promise<Db> {
    return (await db.read()) ?? emptyDb((await pub.getBlockNumber()).toString()) // first run: index from now
  }
  // Read-modify-write under a lock so concurrent serverless invocations don't lose updates.
  const mutate = <T>(fn: (s: Db) => T | Promise<T>) =>
    db.lock(async () => { const s = await load(); const r = await fn(s); await db.write(s); return r }, { wait: true }) as Promise<T>

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
    } catch (e) { lastErr = errText(e) }
  }

  async function adminAction(action: AdminAction, pay: StoredPayment): Promise<AdminResult> {
    const wallet = action.startsWith('resolve') ? resolverW : merchantW
    if (!wallet) return { ok: false, error: 'role key not configured' }
    try {
      if (action === 'try-grab') {
        // Demo proof: the merchant tries to pull held funds straight from the protocol guard. Must revert.
        await pub.simulateContract({ account: wallet.account, address: GUARD, abi: guardAbi, functionName: 'claim', args: [deployment.merchant, pay.receipt] })
        return { ok: true, grabbed: true, note: 'UNEXPECTED: claim would succeed' }
      }
      const fn = ({ refund: 'refund', release: 'release', 'resolve-release': 'release', 'resolve-refund': 'refund' } as const)[action]
      await pub.simulateContract({ account: wallet.account, address: deployment.arbiter, abi, functionName: fn, args: [pay.receipt] })
      const hash = await wallet.writeContract({ address: deployment.arbiter, abi, functionName: fn, args: [pay.receipt], gas: 2_000_000n })
      const rc = await pub.waitForTransactionReceipt({ hash })
      await sync(true)
      return { ok: rc.status === 'success', tx: hash }
    } catch (e) {
      return { ok: false, reverted: true, error: (e as ViemishError).cause?.data?.errorName || errText(e) }
    }
  }

  async function handle(method: string, path: string, headers: Headers, body: Record<string, unknown> = {}): Promise<ApiResponse> {
    const ok = (b: unknown, status = 200): ApiResponse => ({ status, body: b })
    if (method === 'OPTIONS') return ok({}, 204)
    if (path === '/api/config') return ok({ ...deployment, head: head.toString(), indexerError: lastErr, now: Math.floor(Date.now() / 1000) })

    if (path === '/api/orders' && method === 'POST') {
      const { amount, item } = body
      if (!amount || !/^\d+(\.\d{1,6})?$/.test(String(amount))) return ok({ error: 'Amount must be a number like 20 or 12.50' }, 400)
      const view = await mutate((s) => {
        const id = s.nextOrderId++
        s.tagPrefix ??= newTagPrefix() // databases created before prefixes get one on their next order
        const order: StoredOrder = { id, item: String(item || `Order #${id}`).slice(0, 120), amount: parseUnits(String(amount), 6).toString(),
          address: orderAddress(deployment.masterId, id, s.tagPrefix), createdAt: Math.floor(Date.now() / 1000) }
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
      const address = typeof body.address === 'string' ? body.address : ''
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return ok({ error: 'bad address' }, 400)
      if (!(await db.rateLimit(`faucet:${address.toLowerCase()}`, 60_000))) return ok({ error: 'wait a minute' }, 429)
      await Actions.faucet.fundSync(pub, { account: address as Address })
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
      const pay = s.payments[String(body.paymentId)]
      if (!pay) return ok({ error: 'payment not found' }, 404)
      return ok(await adminAction(a[1] as AdminAction, pay))
    }
    return ok({ error: 'not found' }, 404)
  }

  return { handle, sync }
}

export const toJson = (b: unknown) => JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
