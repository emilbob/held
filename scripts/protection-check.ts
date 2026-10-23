// Protection checks on Tempo Moderato (audit H-1, H-2, M-1): a brand-new merchant sets up, then switches its receive
// policy off. Held must stop taking orders for it (server), the buyer page's on-chain check must refuse it, and the
// dashboard's one-click restore must turn it back on. The buyer-side check must also refuse a tampered address or
// resolver, and a buyer whose own receive policy refuses the shop is warned (and the refund really does fail until
// they change that policy).
// Usage: node scripts/protection-check.ts   (mining the checkout address takes a few minutes)
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { Actions } from 'viem/tempo'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { parseEventLogs, parseAbiItem, erc20Abi, type Abi, type Address, type Hex } from 'viem'
import { pub, walletFor, requireState, log, isRpcLimit, network, PATHUSD, TOKENS, orderAddress } from './lib.ts'
import { runSetup, applyPolicy } from '../web/src/setup.ts'
import { checkCheckout, refundReachable } from '../shared/protection.ts'
import { signInMessage, type Order } from '../shared/api.ts'
import arbiterJson from '../shared/HeldArbiter.json' with { type: 'json' }

const PORT = 8797, HOST = `localhost:${PORT}`, API = `http://${HOST}/api`, DB = '/tmp/held-protection-check.json'
const arb = arbiterJson as { abi: Abi, bytecode: Hex }
const results: boolean[] = []
const check = (name: string, pass: boolean, detail: unknown = '') => { results.push(pass); log(pass ? 'PASS' : 'FAIL', name, detail) }
const call = async <T = any>(method: string, path: string, body?: unknown, token?: string) => {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: (await r.json()) as T }
}
async function retry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await fn() } catch (e) { if (!isRpcLimit(e) || i >= tries) throw e; await new Promise((r) => setTimeout(r, 2000 * i)) }
  }
}
const fund = (a: Address) => retry(() => Actions.faucet.fundSync(pub, { account: a }))
const mined = async (h: Hex) => (await pub.waitForTransactionReceipt({ hash: h })).status
const TransferBlocked = parseAbiItem('event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt)')
const asWallet = (a: PrivateKeyAccount) => ({ kind: 'demo', name: 'test', address: a.address, client: walletFor(a) }) as never

const demo = requireState() // its resolver key stands in for Held's resolver (testnet only)
rmSync(DB, { force: true })
const srv = spawn('node', ['server/server.ts'], { env: { ...process.env, PORT: String(PORT), HELD_DB: DB, POLL_MS: '800', HELD_TEST_RESOLVER: demo.resolver }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise<void>((ok) => srv.stdout.on('data', (d: Buffer) => d.toString().includes('Held API') && ok()))

try {
  // ---------------------------------------------------------------- a protected shop
  const mAcct = privateKeyToAccount(generatePrivateKey())
  await fund(mAcct.address) // before the receive policy: afterwards every incoming transfer is held
  const t0 = Date.now()
  const setup = await runSetup({ wallet: asWallet(mAcct), pub: pub as never, resolver: demo.resolver, tokens: TOKENS, window: 120, resolveWindow: 120,
    fee: network.fee, state: {}, save: () => {}, onStep: () => {} })
  log(`setup done in ${Math.round((Date.now() - t0) / 1000)}s, arbiter ${setup.arbiter}`)
  const issued = Math.floor(Date.now() / 1000)
  const { body: { token } } = await call<{ token: string }>('POST', '/auth', { address: mAcct.address, issued, signature: await mAcct.signMessage({ message: signInMessage(mAcct.address, HOST, issued) }) })
  const reg = await call('POST', '/merchants', { name: 'Protection check', arbiter: setup.arbiter, masterId: setup.masterId }, token)
  check('register a protected shop', reg.status === 201, reg.body)
  const o1 = (await call<Order>('POST', '/orders', { item: 'one', amount: '1' }, token)).body
  check('order while protected', !!o1.key)
  const shown = (await call<Order>('GET', `/orders/${o1.key}`)).body
  check('buyer page: no protection flag', !shown.protectionOff)
  const view = { merchant: mAcct.address, arbiter: setup.arbiter, address: o1.address, resolver: demo.resolver, window: 120, testnet: true }
  check('buyer on-chain check: protected', (await checkCheckout(pub as never, view)).ok)

  // ---------------------------------------------------------------- H-2: what a tampered server could show
  const other = orderAddress('0x00000001' as Hex, 1)
  check("buyer check refuses an address that isn't the shop's", !(await checkCheckout(pub as never, { ...view, address: other }).catch(() => ({ ok: false }))).ok)
  check('buyer check refuses a resolver the chain disagrees with', !(await checkCheckout(pub as never, { ...view, resolver: mAcct.address })).ok)
  check('buyer check refuses a window the chain disagrees with', !(await checkCheckout(pub as never, { ...view, window: 999 })).ok)
  check('buyer check refuses a contract that is not a HeldArbiter (mainnet rules)', !(await checkCheckout(pub as never, { ...view, arbiter: PATHUSD, testnet: false })).ok)

  // ---------------------------------------------------------------- H-1: the merchant switches protection off
  const mw = walletFor(mAcct)
  check('merchant switches its receive policy off', await mined(await Actions.receivePolicy.set(mw, { senderPolicyId: 'allow-all', tokenPolicyId: 'allow-all', claimer: mAcct.address })) === 'success')
  const off = await checkCheckout(pub as never, view)
  check('buyer on-chain check: refuses to pay', !off.ok, !off.ok && off.reason)
  // The indexer sees ReceivePolicyUpdated on the next sync and re-checks the shop (no 30 s cache wait).
  await call('GET', `/orders/${o1.key}`)
  const flagged = (await call<Order>('GET', `/orders/${o1.key}`)).body
  check('buyer page: server flags protection off', flagged.protectionOff === true)
  const o2 = await call('POST', '/orders', { item: 'two', amount: '1' }, token)
  check('new orders paused (409)', o2.status === 409, (o2.body as any).error)
  const me = (await call<{ protected: boolean }>('GET', '/me', undefined, token)).body
  check('dashboard: protection off', me.protected === false)
  const link = (await call<{ id: string }>('POST', '/links', { item: 'link', amount: '1' }, token)).body
  const lo = await call('POST', `/links/${link.id}/orders`, {})
  check('checkout link refuses buyers (409)', lo.status === 409, (lo.body as any).error)

  // ---------------------------------------------------------------- the dashboard's "Turn protection back on"
  await applyPolicy(asWallet(mAcct), pub as never, setup.arbiter)
  check('restored: buyer on-chain check passes', (await checkCheckout(pub as never, view)).ok)
  check('restored: dashboard sees protection', (await call<{ protected: boolean }>('GET', '/me', undefined, token)).body.protected === true)
  check('restored: new orders work', (await call('POST', '/orders', { item: 'three', amount: '1' }, token)).status === 201)

  // ---------------------------------------------------------------- M-1: a buyer whose own policy refuses the shop
  const bAcct = privateKeyToAccount(generatePrivateKey())
  await fund(bAcct.address)
  const bw = walletFor(bAcct)
  check('buyer: refund reachable with no policy', await refundReachable(pub as never, bAcct.address, mAcct.address))
  check('buyer sets a policy that refuses every sender', await mined(await Actions.receivePolicy.set(bw, { senderPolicyId: 'reject-all', tokenPolicyId: 'allow-all', claimer: bAcct.address })) === 'success')
  check('buyer page warns: refund not reachable', !(await refundReachable(pub as never, bAcct.address, mAcct.address)))
  const rc = await pub.waitForTransactionReceipt({ hash: await bw.writeContract({ address: PATHUSD, abi: erc20Abi, functionName: 'transfer', args: [o1.address, 1_000_000n] }) })
  const receipt = parseEventLogs({ abi: [TransferBlocked], logs: rc.logs })[0]?.args.receipt as Hex
  check('buyer pays (held)', !!receipt)
  const sim = await pub.simulateContract({ account: mAcct.address, address: setup.arbiter, abi: arb.abi, functionName: 'refund', args: [receipt] }).then(() => 'ok', () => 'reverts')
  check("refund to that buyer fails (Tempo's reroute check)", sim === 'reverts', sim)
  check('buyer opens its policy again', await mined(await Actions.receivePolicy.set(bw, { senderPolicyId: 'allow-all', tokenPolicyId: 'allow-all', claimer: bAcct.address })) === 'success')
  check('refund now goes through', await mined(await mw.writeContract({ address: setup.arbiter, abi: arb.abi, functionName: 'refund', args: [receipt], gas: 2_000_000n })) === 'success')
} finally {
  srv.kill()
  const passed = results.filter(Boolean).length
  log(`${passed}/${results.length} passed`)
  process.exitCode = passed === results.length ? 0 : 1
}
