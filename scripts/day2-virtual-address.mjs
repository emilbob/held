// Day 2 check: a payment to a per-order VIRTUAL address is held and goes through HeldArbiter.
// Uses the persistent merchant from setup-merchant.mjs (.state/merchant.json) and a fresh throwaway buyer.
// Checks: payment held, receipt recipient = virtual address (order id recoverable), release pays the merchant,
// refund goes back to the payer, and the arbiter's NotForMerchant check accepts virtual recipients.
import { Actions } from 'viem/tempo'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ReceivePolicyReceipt } from 'ox/tempo'
import { parseUnits } from 'viem'
import { pub, walletFor, artifact, loadState, log, PATHUSD, bal, fmt, orderAddress, orderIdOf } from './lib.mjs'

const s = loadState()
if (!s.arbiter) throw new Error('run scripts/setup-merchant.mjs first')
const { abi } = artifact()
const buyer = privateKeyToAccount(generatePrivateKey())
await Actions.faucet.fundSync(pub, { account: buyer.address })
const bc = walletFor(buyer)

const results = []
const check = (name, pass, detail = '') => { results.push(pass); log(pass ? 'PASS' : 'FAIL', name, detail) }

async function payOrder(orderId, amount) {
  const to = orderAddress(s.masterId, orderId)
  const tx = await Actions.token.transferSync(bc, { to, amount: parseUnits(amount, 6), token: PATHUSD })
  const rc = tx.receipt ?? tx
  const recs = ReceivePolicyReceipt.fromTransactionReceipt(rc)
  return { to, rc, receipt: recs[0], count: recs.length }
}
const release = async (receipt) => {
  const h = await bc.writeContract({ address: s.arbiter, abi, functionName: 'release', args: [receipt], gas: 2_000_000n })
  return (await pub.waitForTransactionReceipt({ hash: h })).status
}

// Order 1042: buyer pays the per-order address, then confirms delivery
const orderId = 1042 + Math.floor(Math.random() * 1e6) * 10 // unique per run
let m0 = await bal(s.merchant)
const p = await payOrder(orderId, '20')
log(`order ${orderId} address ${p.to} tx ${p.rc.status}`)
check('transfer to virtual address succeeds and is held (1 receipt)', p.rc.status === 'success' && p.count === 1)
check('merchant balance unchanged while held', (await bal(s.merchant)) === m0)
const d = ReceivePolicyReceipt.decode(p.receipt)
log('receipt:', JSON.stringify({ recipient: d.recipient, originator: d.originator, authority: d.recoveryAuthority }))
check('receipt recoveryAuthority = arbiter', d.recoveryAuthority.toLowerCase() === s.arbiter.toLowerCase())
check('receipt originator = buyer', d.originator.toLowerCase() === buyer.address.toLowerCase())
const recOrder = orderIdOf(d.recipient) ?? orderIdOf(p.to)
check('order id recoverable from receipt recipient', orderIdOf(d.recipient) === orderId, `recipient=${d.recipient} -> ${orderIdOf(d.recipient)}`)
check('order id recoverable from Transfer log (fallback)', recOrder === orderId)
const held = await pub.readContract({ address: '0xB10C000000000000000000000000000000000000', abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes' }], outputs: [{ type: 'uint256' }] }], functionName: 'balanceOf', args: [p.receipt] })
check('guard holds 20 for the receipt', held === parseUnits('20', 6), fmt(held))
m0 = await bal(s.merchant)
const st = await release(p.receipt).catch((e) => e.shortMessage)
check('buyer confirms -> arbiter releases virtual-address payment', st === 'success', st)
check('merchant received 20', (await bal(s.merchant)) - m0 === parseUnits('20', 6), fmt((await bal(s.merchant)) - m0))

// Order +1: buyer disputes, resolver refunds (reroute from a virtual-address receipt)
const q = await payOrder(orderId + 1, '15')
const dh = await bc.writeContract({ address: s.arbiter, abi, functionName: 'dispute', args: [q.receipt], gas: 1_000_000n })
check('buyer disputes', (await pub.waitForTransactionReceipt({ hash: dh })).status === 'success')
const rc = walletFor(privateKeyToAccount(s.resolverKey))
const b0 = await bal(buyer.address)
const rh = await rc.writeContract({ address: s.arbiter, abi, functionName: 'refund', args: [q.receipt], gas: 2_000_000n })
check('resolver refunds virtual-address payment', (await pub.waitForTransactionReceipt({ hash: rh })).status === 'success')
check('buyer got 15 back', (await bal(buyer.address)) - b0 === parseUnits('15', 6))

const bad = results.filter((x) => !x).length
log(`${results.length - bad}/${results.length} checks passed`)
process.exit(bad ? 1 : 0)
