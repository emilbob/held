// Testnet proof for HeldPayCheck (the atomic check-and-pay fix). Testnet ONLY, test money only:
//   1. a fresh buyer key gets test funds from the live faucet,
//   2. deploys HeldPayCheck (or reuses PAYCHECK=0x...),
//   3. A: one batched Tempo transaction [requireHeld, transfer $1] into a Sandbox Shop address → must be HELD, with the
//      buyer as the receipt's originator; the sandbox merchant (public test key) then refunds → buyer gets it back,
//   4. B: the same batch against a wallet whose policy does NOT hold for the given arbiter, sent with fixed gas so it is
//      mined → must REVERT as a whole: no transfer, only the network fee spent.
// Run: node scripts/paycheck-proof.ts
import { readFileSync } from 'node:fs'
import { encodeFunctionData, parseAbi, parseEventLogs, parseAbiItem, type Address, type Hex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { network, pub, walletFor, accountOf, orderAddress, PATHUSD, bal, fmt, log, root } from './lib.ts'

if (!network.testnet) throw new Error('testnet only')
const sb = network.sandbox!
const art = JSON.parse(readFileSync(new URL('forge-out/HeldPayCheck.sol/HeldPayCheck.json', root), 'utf8'))
const checkAbi = art.abi
const erc20 = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])
const arbAbi = parseAbi([
  'function payoutPolicyId() view returns (uint64)',
  'function refund(bytes receipt)',
  'function decode(bytes receipt) pure returns ((uint8 version, address token, address recoveryAuthority, address originator, address recipient, uint64 blockedAt, uint64 blockedNonce, uint8 blockedReason, uint8 kind, bytes32 memo))',
])
const TransferBlocked = parseAbiItem('event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt)')
const ONE = 1_000_000n

const buyerKey = (process.env.BUYER_KEY as Hex | undefined) ?? generatePrivateKey()
const buyer = accountOf(buyerKey)
const w = walletFor(buyer)
log('buyer', buyer.address, process.env.BUYER_KEY ? '(given)' : '(fresh)')

// 1. Test funds from the live faucet (testnet).
if ((await bal(buyer.address)) < 3n * ONE) {
  const r = await fetch('https://getheld.xyz/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: buyer.address }) })
  log('faucet', r.status, (await r.text()).slice(0, 120))
  for (let i = 0; i < 20 && (await bal(buyer.address)) < 3n * ONE; i++) await new Promise((r) => setTimeout(r, 1500))
}
log('buyer pathUSD', fmt(await bal(buyer.address)))

// 2. Deploy (or reuse).
let check = process.env.PAYCHECK as Address | undefined
if (!check) {
  const hash = await w.deployContract({ abi: checkAbi, bytecode: art.bytecode.object as Hex } as never)
  const rc = await pub.waitForTransactionReceipt({ hash })
  check = rc.contractAddress!
  log('deployed HeldPayCheck', check, 'tx', hash, rc.status)
}

const arbiter = sb.arbiter as Address
const payout = await pub.readContract({ address: arbiter, abi: arbAbi, functionName: 'payoutPolicyId' })
const order = orderAddress(sb.masterId as Hex, 1, 0x7777) // a fresh Sandbox Shop address, never used by an order database
const checkCall = (to: Address, merchant: Address, arb: Address, pid: bigint) =>
  ({ to: check!, data: encodeFunctionData({ abi: checkAbi, functionName: 'requireHeld', args: [to, merchant, arb, pid] }) })
const payCall = (to: Address) => ({ to: PATHUSD, data: encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [to, ONE] }) })

// 3. A: batched check + pay into a protected shop.
{
  const before = await bal(buyer.address)
  const hash = await w.sendTransaction({ calls: [checkCall(order, sb.merchant as Address, arbiter, payout), payCall(order)] } as never)
  const rc = await pub.waitForTransactionReceipt({ hash })
  const held = parseEventLogs({ abi: [TransferBlocked], logs: rc.logs })[0]
  log('A batched pay', rc.status, 'tx', hash, 'held:', !!held)
  if (rc.status !== 'success' || !held) throw new Error('A FAILED: batched payment was not held')
  const receipt = held.args.receipt as Hex
  const r = await pub.readContract({ address: arbiter, abi: arbAbi, functionName: 'decode', args: [receipt] })
  log('A originator', r.originator, r.originator.toLowerCase() === buyer.address.toLowerCase() ? '= BUYER ✓' : '≠ buyer ✗')
  if (r.originator.toLowerCase() !== buyer.address.toLowerCase()) throw new Error('A FAILED: originator is not the buyer')
  const mid = await bal(buyer.address)
  const m = walletFor(accountOf(sb.merchantKey as Hex))
  const rh = await m.writeContract({ address: arbiter, abi: arbAbi, functionName: 'refund', args: [receipt], gas: 2_000_000n } as never)
  const rr = await pub.waitForTransactionReceipt({ hash: rh })
  const after = await bal(buyer.address)
  log('A refund', rr.status, 'tx', rh, `buyer ${fmt(before)} → ${fmt(mid)} (paid) → ${fmt(after)} (refunded)`)
  if (rr.status !== 'success' || after - mid !== ONE) throw new Error('A FAILED: refund did not return $1 to the buyer')
  log('A PASSED')
}

// 4. B: batched check + pay where the policy does NOT hold for the given arbiter → the whole tx must revert.
{
  const shop = (process.env.OFF_MERCHANT ?? '0x69c18cefc24cc3ce19f9d95e4777163e3695f692') as Address // Second test shop
  const wrongArbiter = (process.env.OFF_ARBITER ?? '0xbe3417f10baa253c48aac9cf175771ffcd8d1808') as Address // its registered arbiter (policy points elsewhere)
  const shopBefore = await bal(shop), before = await bal(buyer.address)
  let hash: Hex | undefined, status = 'not sent'
  try {
    hash = await w.sendTransaction({ calls: [checkCall(shop, shop, wrongArbiter, payout), payCall(shop)], gas: 600_000n } as never)
    status = (await pub.waitForTransactionReceipt({ hash })).status
  } catch (e) { status = 'rejected before mining: ' + String((e as Error).message).split('\n')[0] }
  const spent = before - (await bal(buyer.address)), shopGot = (await bal(shop)) - shopBefore
  log('B batched pay to unprotected', status, hash ? 'tx ' + hash : '', `buyer spent ${fmt(spent)} (fee only if < 1), shop got ${fmt(shopGot)}`)
  if (status === 'success' || shopGot !== 0n || spent >= ONE) throw new Error('B FAILED: money moved although protection did not hold')
  log('B PASSED')
}
// 5. C: wallets without batching (MetaMask): approve, then payChecked (check + transferFrom in one tx) → must be HELD
//    with the BUYER as originator (not HeldPayCheck), and refundable to the buyer.
{
  const approveAbi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
  const order2 = orderAddress(sb.masterId as Hex, 2, 0x7777)
  const ah = await w.writeContract({ address: PATHUSD, abi: approveAbi, functionName: 'approve', args: [check!, ONE] } as never)
  await pub.waitForTransactionReceipt({ hash: ah })
  const ph = await w.writeContract({ address: check!, abi: checkAbi, functionName: 'payChecked', args: [PATHUSD, order2, ONE, sb.merchant, arbiter, payout] } as never)
  const rc = await pub.waitForTransactionReceipt({ hash: ph })
  const held = parseEventLogs({ abi: [TransferBlocked], logs: rc.logs })[0]
  if (rc.status !== 'success' || !held) throw new Error('C FAILED: payChecked payment was not held')
  const receipt = held.args.receipt as Hex
  const r = await pub.readContract({ address: arbiter, abi: arbAbi, functionName: 'decode', args: [receipt] })
  log('C payChecked', rc.status, 'tx', ph, 'originator', r.originator, r.originator.toLowerCase() === buyer.address.toLowerCase() ? '= BUYER ✓' : '≠ buyer ✗')
  if (r.originator.toLowerCase() !== buyer.address.toLowerCase()) throw new Error('C FAILED: originator is not the buyer')
  const mid = await bal(buyer.address)
  const m = walletFor(accountOf(sb.merchantKey as Hex))
  const rh = await m.writeContract({ address: arbiter, abi: arbAbi, functionName: 'refund', args: [receipt], gas: 2_000_000n } as never)
  await pub.waitForTransactionReceipt({ hash: rh })
  const after = await bal(buyer.address)
  if (after - mid !== ONE) throw new Error('C FAILED: refund did not return $1 to the buyer')
  log('C refund tx', rh, `buyer got $1 back ✓`)
  log('C PASSED')
}
log('HeldPayCheck', check, '— all proofs passed')
