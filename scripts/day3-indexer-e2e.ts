// Day 3 check: API + indexer end-to-end against Tempo Moderato.
// Starts the server on a throwaway DB, creates orders via the API, pays them from a fresh buyer wallet,
// acts through HeldArbiter, and asserts the order states the API reports.
import { spawn } from 'node:child_process'
import { rmSync } from 'node:fs'
import { Actions } from 'viem/tempo'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ReceivePolicyReceipt } from 'ox/tempo'
import { parseUnits, type Address, type Hex } from 'viem'
import { pub, walletFor, artifact, requireState, log, PATHUSD, WRONG_TOKEN } from './lib.ts'
import type { Order } from '../shared/api.ts'

const PORT = 8799, DB = '/tmp/held-e2e-db.json', API = `http://localhost:${PORT}/api`
rmSync(DB, { force: true })
const srv = spawn('node', ['server/server.ts'], { env: { ...process.env, PORT: String(PORT), HELD_DB: DB, POLL_MS: '800',
  HELD_ORDER_START: String(10_000_000 + Math.floor(Math.random() * 1e9)) }, stdio: ['ignore', 'pipe', 'inherit'] })
await new Promise<void>((ok) => srv.stdout.on('data', (d: Buffer) => d.toString().includes('Held API') && ok()))

const s = requireState()
const { abi } = artifact()
const buyer = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())
await Actions.faucet.fundSync(pub, { account: buyer.address })
await Actions.faucet.fundSync(pub, { account: stranger.address })
const bc = walletFor(buyer), rc = walletFor(privateKeyToAccount(s.resolverKey)), mc = walletFor(privateKeyToAccount(s.merchantKey))

const results: boolean[] = []
const check = (name: string, pass: boolean, detail: unknown = '') => { results.push(pass); log(pass ? 'PASS' : 'FAIL', name, detail) }
const api = async <T = Order>(path: string, body?: unknown): Promise<T> => (await fetch(API + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})).json()
async function waitStatus(id: number, want: Order['status'], ms = 20000): Promise<Order> {
  const t = Date.now(); let o = await api(`/orders/${id}`)
  while (Date.now() - t < ms) { o = await api(`/orders/${id}`); if (o.status === want) return o; await new Promise((r) => setTimeout(r, 700)) }
  return o
}
const pay = async (to: Address, amount: string, token: Address = PATHUSD) => {
  const tx = await Actions.token.transferSync(bc, { to, amount: parseUnits(amount, 6), token })
  return ReceivePolicyReceipt.fromTransactionReceipt(tx.receipt ?? tx)[0] as Hex
}
const act = async (client: ReturnType<typeof walletFor>, fn: 'release' | 'refund' | 'dispute', receipt: Hex) => {
  const h = await client.writeContract({ address: s.arbiter, abi, functionName: fn, args: [receipt], gas: 2_000_000n })
  return (await pub.waitForTransactionReceipt({ hash: h })).status
}

try {
  // A: pay -> held -> buyer confirms -> released
  const A = await api('/orders', { amount: '20', item: 'Hand-bound notebook' })
  check('create order returns a virtual address', /^0x[0-9a-f]{8}fdfdfdfdfdfdfdfdfdfd/i.test(A.address) && A.status === 'awaiting_payment', A.address)
  await pay(A.address, '20')
  let o = await waitStatus(A.id, 'held')
  check('order A -> held (indexer matched payment to order)', o.status === 'held' && o.payments[0]?.payer.toLowerCase() === buyer.address.toLowerCase(), o.status)
  check('order A exposes receipt + window end', !!o.payments[0]?.receipt && o.payments[0].windowEndsAt > o.payments[0].heldAt)
  await act(bc, 'release', o.payments[0].receipt)
  o = await waitStatus(A.id, 'released')
  check('order A -> released', o.status === 'released')

  // B: pay -> dispute -> resolver refunds
  const B = await api('/orders', { amount: '15', item: 'Logo design' })
  const rB = await pay(B.address, '15')
  await waitStatus(B.id, 'held')
  await act(bc, 'dispute', rB)
  o = await waitStatus(B.id, 'disputed')
  check('order B -> disputed', o.status === 'disputed')
  await act(rc, 'refund', rB)
  o = await waitStatus(B.id, 'refunded')
  check('order B -> refunded', o.status === 'refunded')

  // C: wrong token -> shown as wrong-token payment, buyer self-refunds; order still awaiting correct payment
  const C = await api('/orders', { amount: '7', item: 'Sticker pack' })
  const rC = await pay(C.address, '7', WRONG_TOKEN)
  await new Promise((r) => setTimeout(r, 4000))
  o = await api(`/orders/${C.id}`)
  check('order C wrong token flagged, order still awaiting payment', o.status === 'awaiting_payment' && o.payments[0]?.wrongToken === true, JSON.stringify(o.payments.map((p) => [p.wrongToken, p.status])))
  await act(bc, 'refund', rC)
  await new Promise((r) => setTimeout(r, 4000))
  o = await api(`/orders/${C.id}`)
  check('order C wrong-token payment -> refunded', o.payments[0]?.status === 'refunded')

  // D: underpayment flagged; merchant refunds voluntarily
  const D = await api('/orders', { amount: '10', item: 'Ebook' })
  const rD = await pay(D.address, '4')
  o = await waitStatus(D.id, 'held')
  check('order D underpaid flag', o.underpaid === true)
  await act(mc, 'refund', rD)
  o = await waitStatus(D.id, 'refunded')
  check('order D merchant voluntary refund -> refunded', o.status === 'refunded')

  // E: stranger's attempt to release before the window is rejected and the state stays held
  const E = await api('/orders', { amount: '3', item: 'Coffee' })
  const rE = await pay(E.address, '3')
  await waitStatus(E.id, 'held')
  const x = await act(walletFor(stranger), 'release', rE).catch(() => 'reverted')
  o = await api(`/orders/${E.id}`)
  check('stranger early release rejected, order E stays held', x !== 'success' && o.status === 'held')

  const list = await api<{ orders: Order[] }>('/orders')
  check('GET /orders lists all 5', list.orders.length === 5, String(list.orders.length))
} finally {
  srv.kill()
}
const bad = results.filter((x) => !x).length
log(`${results.length - bad}/${results.length} checks passed`)
process.exit(bad ? 1 : 0)
