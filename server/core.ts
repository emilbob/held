// Held API core: storage-agnostic request handling + on-demand indexing.
// Used by both the local node server (server/server.ts, JSON file) and the Vercel function (api/index.ts, Redis).
//
//   GET  /api/config                       network settings + indexer health
//   GET  /api/health                       uptime check: syncs, 200 if the indexer is current, else 503
//   POST /api/auth {address, issued, signature}   wallet sign-in (see signInMessage) -> session token
//   GET  /api/me                           signed-in wallet + its merchant record, if registered
//   POST /api/merchants {name, arbiter, masterId}  register the signed-in wallet as a merchant (verified on-chain)
//   GET  /api/orders                       the signed-in merchant's orders            -> syncs chain first
//   POST /api/orders {amount, item}        signed-in merchant creates an order (per-order virtual address, no tx)
//   GET  /api/orders/:key                  one order (buyer page, public by its unguessable key) -> syncs chain first
//                                          (a numeric id works for the order's own merchant, and for pre-key orders)
//   GET  /api/links                        the signed-in merchant's checkout links (with order counts)
//   POST /api/links {item, amount}         create a reusable checkout link for one product at a fixed price
//   POST /api/links/:id {active}           turn a link on or off (its merchant only)
//   GET  /api/links/:id                    public: what the link sells, for the buyer
//   POST /api/links/:id/orders             public: a buyer opened the link -> a fresh order for them
//   GET  /api/disputes?resolver=0x…        disputed payments a resolver decides; with that resolver's session, plus notes
//   POST /api/notes {paymentId, text, signature?}  dispute note: the payer (signed) or the merchant (session)
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
import { signInMessage, noteMessage, NOTE_MAX, FEEDBACK_MAX, CONTACT_MAX, QUOTE_NAME_MAX, type Feedback, type CheckoutLink, type CheckoutLinkView, type Db, type Merchant, type Network, type Note, type Order, type PublicLink, type StoredOrder } from '../shared/api.ts'

// 1..65535, so no two databases (local, live, previews) hand out the same order addresses.
export const newTagPrefix = () => 1 + (crypto.getRandomValues(new Uint16Array(1))[0] % 65535)
export const emptyDb = (lastBlock: string, nextOrderId = 1001): Db =>
  ({ merchants: {}, orders: {}, payments: {}, sessions: {}, links: {}, lastBlock, nextOrderId, tagPrefix: newTagPrefix() })

// Where the API keeps its state: a JSON file locally, Upstash Redis on Vercel.
export interface DbAdapter {
  read(): Promise<Db | null>
  write(d: Db): Promise<void>
  // Runs fn while holding the store's lock; fn must read and write through the `io` it's given (for Postgres that's
  // the locked transaction). wait: false -> skip (resolve undefined) if someone else holds the lock.
  lock<T>(fn: (io: DbIO) => Promise<T>, opts: { wait: boolean }): Promise<T | undefined>
  rateLimit(key: string, ms: number): Promise<boolean>
  cleanup?(): Promise<{ sessions: number, ratelimits: number }>
  // Feedback lives outside the Db snapshot: append one, list all (newest first).
  addFeedback(f: Feedback): Promise<void>
  listFeedback(): Promise<Feedback[]>
}
export interface DbIO { read(): Promise<Db | null>, write(d: Db): Promise<void> }
// Optional housekeeping (daily job): drop expired sessions and rate-limit rows. Returns how many rows went.
export interface ApiResponse { status: number, body: unknown }
type Headers = Record<string, string | string[] | undefined>

const SESSION_DAYS = 7
const SIGN_IN_MAX_AGE = 5 * 60
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')
const header = (h: Headers, name: string) => { const v = h[name]; return typeof v === 'string' ? v : '' }
const now = () => Math.floor(Date.now() / 1000)
const AMOUNT = /^\d+(\.\d{1,6})?$/
// A price the API accepts: a positive number, at most the network's launch cap. Returns an error or null.
const priceError = (amount: unknown, network: Network, what: string) => {
  if (!amount || !AMOUNT.test(String(amount)) || parseUnits(String(amount), 6) <= 0n) return `${what} must be a number like 20 or 12.50`
  if (parseUnits(String(amount), 6) > BigInt(network.maxOrder)) return `${what} can be at most $${Number(network.maxOrder) / 1e6} for now (launch limit).`
  return null
}
// Dispute notes are only for the order's merchant and resolver.
const withNotes = (s: Db, o: Order): Order => {
  const notes = Object.fromEntries(o.payments.filter((p) => s.notes?.[p.id]?.length).map((p) => [p.id, s.notes![p.id]]))
  return Object.keys(notes).length ? { ...o, notes } : o
}
// Rate limits key on a short one-way hash of the visitor's IP, never the IP itself (see the privacy page).
const clientIp = (h: Headers) => sha256hex('ip:' + (header(h, 'x-forwarded-for').split(',')[0].trim() || 'local')).slice(0, 16)

// One order: its own virtual address under the merchant's master (no transaction, no cost).
function newOrder(s: Db, merchant: Merchant, item: string, amount: string, linkId?: string): StoredOrder {
  const id = s.nextOrderId++
  // key: the buyer link (#/pay/<key>). 96 random bits, so order pages can't be found by counting order numbers.
  const order: StoredOrder = { id, key: randomBytes(12).toString('base64url'), merchant: merchant.address, item: item.slice(0, 120) || `Order #${id}`, amount,
    address: orderAddress(merchant.masterId, id, s.tagPrefix), createdAt: now(), ...(linkId && { linkId }) }
  s.orders[id] = order
  return order
}

// viem errors carry a short message.
type ViemishError = { shortMessage?: string, message?: string }
const errText = (e: unknown) => (e as ViemishError).shortMessage || (e as ViemishError).message || String(e)

export function createApi({ network, db }: { network: Network, db: DbAdapter }) {
  let head = 0n, lastErr: string | null = null, lastSync = 0

  async function load(io: DbIO = db): Promise<Db> {
    return (await io.read()) ?? emptyDb((await pub.getBlockNumber()).toString()) // first run: index from now
  }
  // Read-modify-write under a lock so concurrent serverless invocations don't lose updates.
  const mutate = <T>(fn: (s: Db) => T | Promise<T>) =>
    db.lock(async (io) => { const s = await load(io); const r = await fn(s); await io.write(s); return r }, { wait: true }) as Promise<T>

  async function sync(force = false) {
    if (!force && Date.now() - lastSync < 1000) return
    lastSync = Date.now()
    try {
      // If another invocation is already syncing, just read what it wrote.
      await db.lock(async (io) => {
        const s = await load(io)
        head = await createIndexer({ store: s }).sync()
        await io.write(s)
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
    // The sandbox's public test keys are served only on testnet.
    // Health for uptime monitoring: syncs the indexer (at most every 10 s, so it can't be used to hammer the RPC) and
    // reports whether it's current. 503 if the indexer errors or lags.
    if (path === '/api/health') {
      if (await db.rateLimit('health', 10_000)) await sync(true)
      // The chain's height from the chain itself (another instance may have done the sync above).
      const [s, chainHead] = await Promise.all([db.read(), pub.getBlockNumber().catch(() => null)])
      const lag = s && chainHead !== null ? Number(chainHead) - Number(s.lastBlock) + 1 : null
      const healthy = !lastErr && lag !== null && lag >= 0 && lag < 600 // ~6 min of blocks
      return ok({ ok: healthy, network: network.name, head: chainHead?.toString() ?? null, lastBlock: s?.lastBlock ?? null, lag, indexerError: lastErr, now: now() }, healthy ? 200 : 503)
    }
    if (path === '/api/config') return ok({ ...network, sandbox: network.testnet ? network.sandbox : undefined, head: head.toString(), indexerError: lastErr, now: now() })

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
      // The sandbox's merchant key is public, so nobody may re-register that address with a different arbiter.
      const sb = network.sandbox
      if (sb?.arbiter && address.toLowerCase() === sb.merchant.toLowerCase() && arbiter.toLowerCase() !== sb.arbiter.toLowerCase())
        return ok({ error: 'The sandbox shop can only use its own arbiter.' }, 403)
      const v = await verifyMerchant(address, arbiter, masterId as Hex, network)
      if (!v.ok) return ok({ error: v.error }, 422)
      const merchant = { ...v.merchant, name: String(name || 'Merchant').slice(0, 60), registeredAt: now() }
      await mutate((s) => { s.merchants[address.toLowerCase()] = merchant })
      return ok({ merchant }, 201)
    }

    if (path === '/api/orders' && method === 'POST') {
      const { amount, item } = body
      const err = priceError(amount, network, 'Amount')
      if (err) return ok({ error: err }, 400)
      const r = await mutate((s) => {
        const address = sessionOf(s, headers)
        const merchant = address ? s.merchants[address.toLowerCase()] : undefined
        if (!merchant) return null
        return orderView(s, newOrder(s, merchant, String(item || ''), parseUnits(String(amount), 6).toString()))
      })
      return r ? ok(r, 201) : ok({ error: 'Only a signed-in, registered merchant can create orders.' }, 401)
    }
    if (path === '/api/orders') {
      await sync()
      const s = await load()
      const address = sessionOf(s, headers)
      if (!address) return ok({ error: 'Sign in with your merchant wallet.' }, 401)
      const mine = Object.values(s.orders).filter((o) => o.merchant.toLowerCase() === address.toLowerCase())
      return ok({ orders: mine.sort((a, b) => b.id - a.id).map((o) => withNotes(s, orderView(s, o))) })
    }
    const m = path.match(/^\/api\/orders\/([\w-]{1,32})$/)
    if (m) {
      await sync()
      const s = await load()
      const ref = m[1]
      let o = /^\d+$/.test(ref) ? s.orders[ref] : Object.values(s.orders).find((x) => x.key === ref)
      // By number only for orders made before keys existed, or for the order's own signed-in merchant.
      if (o && /^\d+$/.test(ref) && o.key && sessionOf(s, headers)?.toLowerCase() !== o.merchant.toLowerCase()) o = undefined
      return o ? ok(orderView(s, o)) : ok({ error: 'Order not found' }, 404)
    }
    // ---------------------------------------------------------------- checkout links
    if (path === '/api/links' && method === 'POST') {
      const { amount, item } = body
      if (!item || !String(item).trim()) return ok({ error: 'Name the product.' }, 400)
      const err = priceError(amount, network, 'Price')
      if (err) return ok({ error: err }, 400)
      const r = await mutate((s) => {
        const address = sessionOf(s, headers)
        const merchant = address ? s.merchants[address.toLowerCase()] : undefined
        if (!merchant) return null
        const link: CheckoutLink = { id: randomBytes(6).toString('base64url'), merchant: merchant.address, item: String(item).trim().slice(0, 120),
          amount: parseUnits(String(amount), 6).toString(), active: true, createdAt: now() }
        ;(s.links ??= {})[link.id] = link
        return link
      })
      return r ? ok(r, 201) : ok({ error: 'Only a signed-in, registered merchant can create checkout links.' }, 401)
    }
    if (path === '/api/links') {
      await sync()
      const s = await load()
      const address = sessionOf(s, headers)
      if (!address) return ok({ error: 'Sign in with your merchant wallet.' }, 401)
      const mine = Object.values(s.links ?? {}).filter((l) => l.merchant.toLowerCase() === address.toLowerCase())
      const views: CheckoutLinkView[] = mine.sort((a, b) => b.createdAt - a.createdAt).map((l) => {
        const orders = Object.values(s.orders).filter((o) => o.linkId === l.id).map((o) => orderView(s, o))
        return { ...l, orders: orders.length, paid: orders.filter((o) => o.status !== 'awaiting_payment').length }
      })
      return ok({ links: views })
    }
    const lk = path.match(/^\/api\/links\/([\w-]{6,16})(\/orders)?$/)
    if (lk && !lk[2] && method === 'POST') {
      const r = await mutate((s) => {
        const link = s.links?.[lk[1]]
        const address = sessionOf(s, headers)
        if (!link || !address || link.merchant.toLowerCase() !== address.toLowerCase()) return null
        link.active = body.active === true
        return link
      })
      return r ? ok(r) : ok({ error: 'Only the merchant who made this link can change it.' }, 401)
    }
    if (lk && !lk[2]) {
      const s = await load()
      const link = s.links?.[lk[1]]
      if (!link) return ok({ error: 'This checkout link does not exist.' }, 404)
      const pub: PublicLink = { id: link.id, item: link.item, amount: link.amount, active: link.active, merchantName: s.merchants[link.merchant.toLowerCase()]?.name ?? '' }
      return ok(pub)
    }
    if (lk && lk[2] && method === 'POST') {
      // Missing or turned-off links answer that first; then opening a link twice in a row (double click, reload)
      // shouldn't make two orders.
      const known = (await load()).links?.[lk[1]]
      if (!known) return ok({ error: 'This checkout link does not exist.' }, 404)
      if (!known.active) return ok({ error: 'This checkout link has been turned off by the merchant.' }, 410)
      if (!(await db.rateLimit(`link:${lk[1]}:${clientIp(headers)}`, 3000))) return ok({ error: 'One moment, your order is being created.' }, 429)
      const r = await mutate((s) => {
        const link = s.links?.[lk[1]]
        const merchant = link && s.merchants[link.merchant.toLowerCase()]
        if (!link || !merchant) return { error: 'This checkout link does not exist.', status: 404 }
        if (!link.active) return { error: 'This checkout link has been turned off by the merchant.', status: 410 }
        return orderView(s, newOrder(s, merchant, link.item, link.amount, link.id))
      })
      return 'error' in r ? ok({ error: r.error }, r.status) : ok(r, 201)
    }

    if (path === '/api/disputes') {
      const resolver = query.get('resolver') || ''
      if (!isAddress(resolver)) return ok({ error: 'Add ?resolver=<address>.' }, 400)
      await sync()
      const s = await load()
      const theirs = new Set(Object.values(s.merchants).filter((mm) => mm.resolver.toLowerCase() === resolver.toLowerCase()).map((mm) => mm.address.toLowerCase()))
      const isResolver = sessionOf(s, headers)?.toLowerCase() === resolver.toLowerCase()
      // Buyer-page keys (the unguessable #/pay/<key> links) and notes only for the signed-in resolver; this list is public.
      const orders = Object.values(s.orders).filter((o) => theirs.has(o.merchant.toLowerCase())).map((o) => orderView(s, o))
        .map((o) => (isResolver ? withNotes(s, o) : (({ key: _key, ...rest }) => rest)(o)))
      return ok({ orders: orders.filter((o) => o.payments.some((p) => p.status === 'disputed')).sort((a, b) => b.id - a.id), notes: isResolver })
    }
    if (path === '/api/notes' && method === 'POST') {
      const { paymentId, signature } = body
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (!text || text.length > NOTE_MAX) return ok({ error: `Write a note of up to ${NOTE_MAX} characters.` }, 400)
      const s0 = await load()
      const pay = s0.payments[String(paymentId)]
      const order = pay && Object.values(s0.orders).find((o) => o.address.toLowerCase() === pay.recipient.toLowerCase())
      if (!pay || !order) return ok({ error: 'Payment not found.' }, 404)
      if (pay.status === 'released' || pay.status === 'refunded') return ok({ error: 'This payment is already settled.' }, 409)
      let by: Note['by'] | null = null
      if (typeof signature === 'string') {
        const valid = await pub.verifyMessage({ address: pay.payer, message: noteMessage(order.id, pay.id, text), signature: signature as Hex }).catch(() => false)
        if (valid) by = 'buyer'
      } else if (sessionOf(s0, headers)?.toLowerCase() === pay.merchant.toLowerCase()) by = 'merchant'
      if (!by) return ok({ error: 'Only the wallet that paid (signed) or the merchant can add a note.' }, 401)
      const r = await mutate((s) => {
        const list = ((s.notes ??= {})[pay.id] ??= [])
        if (list.filter((n) => n.by === by).length >= 5) return null
        const note: Note = { by: by!, text, at: now() }
        list.push(note)
        return note
      })
      return r ? ok(r, 201) : ok({ error: 'Note limit reached for this payment.' }, 429)
    }
    if (path === '/api/feedback' && method === 'POST') {
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      const contact = typeof body.contact === 'string' ? body.contact.trim() : ''
      const role = (['buyer', 'merchant', 'looking'] as const).find((r) => r === body.role) ?? 'looking'
      if (!text || text.length > FEEDBACK_MAX) return ok({ error: `Write your feedback (up to ${FEEDBACK_MAX} characters).` }, 400)
      if (contact.length > CONTACT_MAX) return ok({ error: `Keep the contact under ${CONTACT_MAX} characters.` }, 400)
      const quote = body.quote === true
      const quoteName = quote && typeof body.quoteName === 'string' ? body.quoteName.trim().slice(0, QUOTE_NAME_MAX) : ''
      if (!(await db.rateLimit(`feedback:${clientIp(headers)}`, 20_000))) return ok({ error: 'Thanks! Wait a few seconds before sending more.' }, 429)
      await db.addFeedback({ at: now(), role, text, ...(contact && { contact }), ...(quote && { quote, ...(quoteName && { quoteName }) }) })
      return ok({ ok: true }, 201)
    }
    if (path === '/api/feedback') {
      // Owner only: a session of this network's default resolver (Held's own wallet).
      const s = await load()
      const who = sessionOf(s, headers)
      if (!who || who.toLowerCase() !== network.defaultResolver.toLowerCase()) return ok({ error: "Sign in with Held's owner wallet." }, 401)
      return ok({ feedback: await db.listFeedback() })
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
