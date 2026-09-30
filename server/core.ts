// Held API core: storage-agnostic request handling + on-demand indexing.
// Used by both the local node server (server/server.ts, JSON file) and the Vercel function (api/index.ts, Redis).
//
//   GET  /api/config                       network settings + indexer health
//   POST /api/auth {address, issued, signature}   wallet sign-in (see signInMessage) -> session token
//   GET  /api/me                           signed-in wallet + its merchant record, if registered
//   POST /api/merchants {name, arbiter, masterId}  register the signed-in wallet as a merchant (verified on-chain)
//   GET  /api/orders                       the signed-in merchant's orders            -> syncs chain first
//   POST /api/orders {amount, item}        signed-in merchant creates an order (per-order virtual address, no tx)
//   GET  /api/orders/:id                   one order (buyer page, public)            -> syncs chain first
//   GET  /api/disputes?resolver=0x…        disputed payments a resolver decides (public: all of it is on-chain)
//   POST /api/faucet {address}             testnet only: top-up for buyers and merchants
//
// Held's server holds no keys and signs nothing: buyers, merchants and resolvers sign every action in their own
// wallets, and HeldArbiter limits every outcome to "the merchant" or "the original payer".
import { createHash, randomBytes } from 'node:crypto'
import { isAddress, parseUnits, type Address, type Hex } from 'viem'
import { Actions } from 'viem/tempo'
import { createIndexer, orderView } from './indexer.ts'
import { verifyMerchant } from './merchants.ts'
import { orderAddress, pub } from '../scripts/lib.ts'
import { signInMessage, type Db, type Network, type StoredOrder } from '../shared/api.ts'

// 1..65535, so no two databases (local, live, previews) hand out the same order addresses.
export const newTagPrefix = () => 1 + (crypto.getRandomValues(new Uint16Array(1))[0] % 65535)
export const emptyDb = (lastBlock: string, nextOrderId = 1001): Db =>
  ({ merchants: {}, orders: {}, payments: {}, sessions: {}, lastBlock, nextOrderId, tagPrefix: newTagPrefix() })

// Where the API keeps its state: a JSON file locally, Upstash Redis on Vercel.
export interface DbAdapter {
  read(): Promise<Db | null>
  write(d: Db): Promise<void>
  // wait: false -> skip (resolve undefined) if someone else holds the lock.
  lock<T>(fn: () => Promise<T>, opts: { wait: boolean }): Promise<T | undefined>
  rateLimit(key: string, ms: number): Promise<boolean>
}
export interface ApiResponse { status: number, body: unknown }
type Headers = Record<string, string | string[] | undefined>

const SESSION_DAYS = 7
const SIGN_IN_MAX_AGE = 5 * 60
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')
const header = (h: Headers, name: string) => { const v = h[name]; return typeof v === 'string' ? v : '' }
const now = () => Math.floor(Date.now() / 1000)

// viem errors carry a short message.
type ViemishError = { shortMessage?: string, message?: string }
const errText = (e: unknown) => (e as ViemishError).shortMessage || (e as ViemishError).message || String(e)

export function createApi({ network, db }: { network: Network, db: DbAdapter }) {
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
        head = await createIndexer({ store: s }).sync()
        await db.write(s)
      }, { wait: false })
      lastErr = null
    } catch (e) { lastErr = errText(e) }
  }

  // The wallet behind "Authorization: Bearer <session>", or null.
  function sessionOf(s: Db, headers: Headers): Address | null {
    const token = header(headers, 'authorization').replace(/^Bearer /, '')
    const sess = token ? s.sessions[sha256hex(token)] : undefined
    return sess && sess.exp > now() ? sess.address : null
  }

  async function handle(method: string, path: string, headers: Headers, body: Record<string, unknown> = {}, query: URLSearchParams = new URLSearchParams()): Promise<ApiResponse> {
    const ok = (b: unknown, status = 200): ApiResponse => ({ status, body: b })
    if (method === 'OPTIONS') return ok({}, 204)
    if (path === '/api/config') return ok({ ...network, head: head.toString(), indexerError: lastErr, now: now() })

    if (path === '/api/auth' && method === 'POST') {
      const { address, issued, signature } = body
      if (typeof address !== 'string' || !isAddress(address) || typeof issued !== 'number' || typeof signature !== 'string')
        return ok({ error: 'Bad sign-in request.' }, 400)
      if (Math.abs(now() - issued) > SIGN_IN_MAX_AGE) return ok({ error: 'Sign-in expired. Please sign again.' }, 401)
      const message = signInMessage(address, header(headers, 'host'), issued)
      const valid = await pub.verifyMessage({ address, message, signature: signature as Hex }).catch(() => false)
      if (!valid) return ok({ error: "Signature doesn't match this wallet." }, 401)
      const token = randomBytes(24).toString('base64url')
      await mutate((s) => {
        for (const [k, v] of Object.entries(s.sessions)) if (v.exp <= now()) delete s.sessions[k] // prune
        s.sessions[sha256hex(token)] = { address, exp: now() + SESSION_DAYS * 86400 }
      })
      return ok({ token, address })
    }
    if (path === '/api/me') {
      const s = await load()
      const address = sessionOf(s, headers)
      if (!address) return ok({ error: 'Not signed in.' }, 401)
      return ok({ address, merchant: s.merchants[address.toLowerCase()] ?? null })
    }

    if (path === '/api/merchants' && method === 'POST') {
      const address = sessionOf(await load(), headers)
      if (!address) return ok({ error: 'Sign in with your wallet first.' }, 401)
      const { name, arbiter, masterId } = body
      if (typeof arbiter !== 'string' || !isAddress(arbiter) || typeof masterId !== 'string' || !/^0x[0-9a-fA-F]{8}$/.test(masterId))
        return ok({ error: 'Bad registration request.' }, 400)
      const v = await verifyMerchant(address, arbiter, masterId as Hex, network)
      if (!v.ok) return ok({ error: v.error }, 422)
      const merchant = { ...v.merchant, name: String(name || 'Merchant').slice(0, 60), registeredAt: now() }
      await mutate((s) => { s.merchants[address.toLowerCase()] = merchant })
      return ok({ merchant }, 201)
    }

    if (path === '/api/orders' && method === 'POST') {
      const { amount, item } = body
      if (!amount || !/^\d+(\.\d{1,6})?$/.test(String(amount))) return ok({ error: 'Amount must be a number like 20 or 12.50' }, 400)
      const r = await mutate((s) => {
        const address = sessionOf(s, headers)
        const merchant = address ? s.merchants[address.toLowerCase()] : undefined
        if (!merchant) return null
        const id = s.nextOrderId++
        const order: StoredOrder = { id, merchant: merchant.address, item: String(item || `Order #${id}`).slice(0, 120),
          amount: parseUnits(String(amount), 6).toString(), address: orderAddress(merchant.masterId, id, s.tagPrefix), createdAt: now() }
        s.orders[id] = order
        return orderView(s, order)
      })
      return r ? ok(r, 201) : ok({ error: 'Only a signed-in, registered merchant can create orders.' }, 401)
    }
    if (path === '/api/orders') {
      await sync()
      const s = await load()
      const address = sessionOf(s, headers)
      if (!address) return ok({ error: 'Sign in with your merchant wallet.' }, 401)
      const mine = Object.values(s.orders).filter((o) => o.merchant.toLowerCase() === address.toLowerCase())
      return ok({ orders: mine.sort((a, b) => b.id - a.id).map((o) => orderView(s, o)) })
    }
    const m = path.match(/^\/api\/orders\/(\d+)$/)
    if (m) {
      await sync()
      const s = await load()
      const o = s.orders[m[1]]
      return o ? ok(orderView(s, o)) : ok({ error: 'Order not found' }, 404)
    }
    if (path === '/api/disputes') {
      const resolver = query.get('resolver') || ''
      if (!isAddress(resolver)) return ok({ error: 'Add ?resolver=<address>.' }, 400)
      await sync()
      const s = await load()
      const theirs = new Set(Object.values(s.merchants).filter((mm) => mm.resolver.toLowerCase() === resolver.toLowerCase()).map((mm) => mm.address.toLowerCase()))
      const orders = Object.values(s.orders).filter((o) => theirs.has(o.merchant.toLowerCase())).map((o) => orderView(s, o))
      return ok({ orders: orders.filter((o) => o.payments.some((p) => p.status === 'disputed')).sort((a, b) => b.id - a.id) })
    }
    if (path === '/api/faucet' && method === 'POST') {
      if (!network.testnet) return ok({ error: 'No faucet on mainnet.' }, 404)
      const address = typeof body.address === 'string' ? body.address : ''
      if (!isAddress(address)) return ok({ error: 'bad address' }, 400)
      if (!(await db.rateLimit(`faucet:${address.toLowerCase()}`, 60_000))) return ok({ error: 'wait a minute' }, 429)
      await Actions.faucet.fundSync(pub, { account: address })
      return ok({ ok: true })
    }
    return ok({ error: 'not found' }, 404)
  }

  return { handle, sync }
}

export const toJson = (b: unknown) => JSON.stringify(b, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
