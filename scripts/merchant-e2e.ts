// Real-dApp end to end on Tempo Moderato: a brand-new merchant sets up from their own wallet with the same code the
// browser runs (web/src/setup.ts), signs in, registers (verified on-chain), creates orders; buyers pay; every
// release / refund / dispute / resolution is signed by that party's own wallet. Held's server holds no keys.
// Also checks that the server refuses fake or tampered arbiters and unauthenticated requests.
// Usage: node scripts/merchant-e2e.ts   (mining the checkout address takes a few minutes)
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { Actions } from 'viem/tempo'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { ReceivePolicyReceipt } from 'ox/tempo'
import { parseUnits, type Abi, type Address, type Hex } from 'viem'
import { pub, walletFor, requireState, log, isRpcLimit, PATHUSD } from './lib.ts'
import { runSetup } from '../web/src/setup.ts'
import { signInMessage, type Merchant, type Order } from '../shared/api.ts'
import arbiterJson from '../shared/HeldArbiter.json' with { type: 'json' }

const PORT = 8798, HOST = `localhost:${PORT}`, API = `http://${HOST}/api`, DB = '/tmp/held-merchant-e2e.json'
const arb = arbiterJson as { abi: Abi, bytecode: Hex }
const results: boolean[] = []
const check = (name: string, pass: boolean, detail: unknown = '') => { results.push(pass); log(pass ? 'PASS' : 'FAIL', name, detail) }
const call = async <T = any>(method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: (await r.json()) as T }
}
const signIn = async (acct: PrivateKeyAccount) => {
  const issued = Math.floor(Date.now() / 1000)
  const signature = await acct.signMessage({ message: signInMessage(acct.address, HOST, issued) })
  return call<{ token: string }>('POST', '/auth', { address: acct.address, issued, signature })
}
// Tempo's public RPC rate-limits in bursts; retry only those rejections (never a contract revert).
async function retry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn() } catch (e) { if (!isRpcLimit(e) || i >= tries) throw e; await new Promise((r) => setTimeout(r, 2000 * i)) }
  }
}
const fund = (a: Address) => retry(() => Actions.faucet.fundSync(pub, { account: a }))
const tx = async (h: () => Promise<Hex>) => (await pub.waitForTransactionReceipt({ hash: await retry(h) })).status
const act = (w: ReturnType<typeof walletFor>, address: Address, fn: 'release' | 'refund' | 'dispute', receipt: Hex) =>
  tx(() => w.writeContract({ address, abi: arb.abi, functionName: fn, args: [receipt], gas: 2_000_000n }))
async function waitStatus(id: number, want: Order['status'], ms = 30000): Promise<Order> {
  const t = Date.now(); let o = (await call<Order>('GET', `/orders/${id}`)).body
  while (o.status !== want && Date.now() - t < ms) { await new Promise((r) => setTimeout(r, 800)); o = (await call<Order>('GET', `/orders/${id}`)).body }
  return o
}

// The test resolver is the demo-era testnet key in .state (the real default resolver's key is only in its owner's passkey).
const demo = requireState()
const TEST_RESOLVER = demo.resolver
rmSync(DB, { force: true })
const srv = spawn('node', ['server/server.ts'], { env: { ...process.env, PORT: String(PORT), HELD_DB: DB, POLL_MS: '800' }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise<void>((ok) => srv.stdout.on('data', (d: Buffer) => d.toString().includes('Held API') && ok()))

try {
  // ---------------------------------------------------------------- merchant setup from their own wallet
  const mAcct = privateKeyToAccount(generatePrivateKey())
  await fund(mAcct.address) // before the receive policy: afterwards every incoming transfer is held
  const merchantWallet = { kind: 'demo', name: 'test merchant', address: mAcct.address, client: walletFor(mAcct) } as never
  const t0 = Date.now(); let steps: string[] = []
  const setup = await runSetup({ wallet: merchantWallet, pub: pub as never, resolver: TEST_RESOLVER, token: PATHUSD,
    window: 120, state: {}, save: () => {}, onStep: (s) => steps.push(s) })
  check('setup from the merchant wallet: mine, register, deploy, policy', steps.join(',') === 'mine,register,deploy,policy,done', `${steps.join(' > ')} in ${Math.round((Date.now() - t0) / 1000)}s, arbiter ${setup.arbiter}`)

  // ---------------------------------------------------------------- auth + registration (and what must be refused)
  const noAuth = await call('POST', '/merchants', { arbiter: setup.arbiter, masterId: setup.masterId })
  check('register without sign-in -> 401', noAuth.status === 401)
  const forged = await call('POST', '/auth', { address: mAcct.address, issued: Math.floor(Date.now() / 1000), signature: await privateKeyToAccount(generatePrivateKey()).signMessage({ message: 'x' }) })
  check("sign-in with someone else's signature -> 401", forged.status === 401)
  const stale = Math.floor(Date.now() / 1000) - 3600
  const old = await call('POST', '/auth', { address: mAcct.address, issued: stale, signature: await mAcct.signMessage({ message: signInMessage(mAcct.address, HOST, stale) }) })
  check('sign-in with an hour-old signature -> 401', old.status === 401)
  const { body: { token } } = await signIn(mAcct)
  check('sign-in with a fresh signature -> session', !!token)

  const someoneElses = await call('POST', '/merchants', { name: 'x', arbiter: demo.arbiter, masterId: setup.masterId }, token)
  check("register with someone else's arbiter -> refused", someoneElses.status === 422, (someoneElses.body as any).error)

  // A tampered arbiter: the genuine code with one byte of its metadata changed. Behaves the same, is not the same.
  const tampered = (arb.bytecode.slice(0, -40) + (arb.bytecode.at(-40) === 'a' ? 'b' : 'a') + arb.bytecode.slice(-39)) as Hex
  const tHash = await retry(() => walletFor(mAcct).deployContract({ abi: arb.abi, bytecode: tampered, args: [mAcct.address, TEST_RESOLVER, PATHUSD, 120n] }))
  const tAddr = (await pub.waitForTransactionReceipt({ hash: tHash })).contractAddress!
  const fake = await call('POST', '/merchants', { name: 'x', arbiter: tAddr, masterId: setup.masterId }, token)
  check('register with a tampered arbiter (1 byte changed) -> refused', fake.status === 422 && /genuine/.test((fake.body as any).error), (fake.body as any).error)

  const reg = await call<{ merchant: Merchant }>('POST', '/merchants', { name: 'E2E Shop', arbiter: setup.arbiter, masterId: setup.masterId }, token)
  check('register the genuine setup -> accepted', reg.status === 201 && reg.body.merchant.arbiter === setup.arbiter, reg.body)
  const me = await call<{ merchant: Merchant | null }>('GET', '/me', undefined, token)
  check('/me returns the merchant', me.body.merchant?.name === 'E2E Shop')

  // ---------------------------------------------------------------- orders
  const noOrder = await call('POST', '/orders', { amount: '5', item: 'x' })
  check('create order without sign-in -> 401', noOrder.status === 401)
  const stranger = privateKeyToAccount(generatePrivateKey())
  const { body: { token: sTok } } = await signIn(stranger)
  const notMerchant = await call('POST', '/orders', { amount: '5', item: 'x' }, sTok)
  check('signed-in non-merchant cannot create orders -> 401', notMerchant.status === 401)
  const A = (await call<Order>('POST', '/orders', { amount: '5', item: 'Order A' }, token)).body
  const B = (await call<Order>('POST', '/orders', { amount: '4', item: 'Order B' }, token)).body
  const C = (await call<Order>('POST', '/orders', { amount: '3', item: 'Order C' }, token)).body
  check('orders use the merchant arbiter', A.merchantInfo?.arbiter === setup.arbiter && A.merchant === mAcct.address)
  const strangerList = await call<{ orders: Order[] }>('GET', '/orders', undefined, sTok)
  check("another wallet doesn't see the merchant's orders", strangerList.body.orders.length === 0)

  // ---------------------------------------------------------------- buyer pays; everyone signs in their own wallet
  const buyer = privateKeyToAccount(generatePrivateKey()); await fund(buyer.address)
  const bw = walletFor(buyer), mw = walletFor(mAcct), rw = walletFor(privateKeyToAccount(demo.resolverKey))
  const pay = async (o: Order) => {
    const t = await retry(() => Actions.token.transferSync(bw, { to: o.address, amount: parseUnits(String(Number(o.amount) / 1e6), 6), token: PATHUSD }))
    return ReceivePolicyReceipt.fromTransactionReceipt(t.receipt ?? t)[0] as Hex
  }
  const rA = await pay(A)
  let o = await waitStatus(A.id, 'held')
  check('A paid -> held (indexer follows the new merchant)', o.status === 'held' && o.payments[0]?.windowEndsAt - o.payments[0]?.heldAt === 120)
  const early = await act(mw, setup.arbiter, 'release', rA).catch((e) => (isRpcLimit(e) ? 'rpc-limit' : 'reverted'))
  check('merchant cannot release early (contract)', early === 'reverted', early)
  check('buyer releases A', (await act(bw, setup.arbiter, 'release', rA)) === 'success')
  check('A -> released', (await waitStatus(A.id, 'released')).status === 'released')

  const rB = await pay(B); await waitStatus(B.id, 'held')
  check('merchant refunds B from their own wallet', (await act(mw, setup.arbiter, 'refund', rB)) === 'success')
  check('B -> refunded', (await waitStatus(B.id, 'refunded')).status === 'refunded')

  const rC = await pay(C); await waitStatus(C.id, 'held')
  check('buyer disputes C', (await act(bw, setup.arbiter, 'dispute', rC)) === 'success')
  await waitStatus(C.id, 'disputed')
  const disputes = await call<{ orders: Order[] }>('GET', `/disputes?resolver=${TEST_RESOLVER}`)
  check("C is on the resolver's list", disputes.body.orders.some((x) => x.id === C.id))
  // The merchant may always refund (what the buyer asked for), but must never take a disputed payment.
  const merchantTakes = await act(mw, setup.arbiter, 'release', rC).catch((e) => (isRpcLimit(e) ? 'rpc-limit' : 'reverted'))
  check('merchant cannot release a disputed payment (contract)', merchantTakes === 'reverted', merchantTakes)
  check("resolver refunds C from the resolver's wallet", (await act(rw, setup.arbiter, 'refund', rC)) === 'success')
  check('C -> refunded', (await waitStatus(C.id, 'refunded')).status === 'refunded')
} catch (e) {
  log('ERROR', (e as Error).message); results.push(false)
} finally {
  srv.kill()
}
const bad = results.filter((x) => !x).length
log(`${results.length - bad}/${results.length} checks passed`)
process.exit(bad ? 1 : 0)
