// Regression test (suggested by u/investigatormaker): a merchant switches protection off DURING checkout. The buyer's
// payment is signed while the shop is still protected (the page's own check passes), the merchant then switches its
// receive policy off, and only then is the signed payment broadcast. It must revert with nothing moved, on BOTH ways
// to pay (the Pay button only ever uses these two, see scripts/pay-routes-check.ts):
//   1. batched Tempo transaction [HeldPayCheck.requireHeld, transfer]   (Tempo Wallet / passkey / sandbox wallets)
//   2. HeldPayCheck.payChecked (check + transferFrom in one call)       (browser wallets like MetaMask)
// Then the merchant switches protection back on, the same payment is HELD, and the merchant refunds the buyer.
// Testnet ONLY, test money only. Uses the reusable test shop (.state/test-merchant.json, see scripts/test-merchant.ts)
// and a fresh buyer key. The held payment is indexed by the live site: the script prints its id to remove afterwards.
// Run: node scripts/toggle-check.ts
import { existsSync, readFileSync } from 'node:fs'
import { encodeFunctionData, parseAbi, parseAbiItem, parseEventLogs, type Address, type Hex } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { Actions } from 'viem/tempo'
import { network, pub, walletFor, accountOf, orderAddress, PATHUSD, bal, fmt, log, root } from './lib.ts'
import { policyHolds } from '../shared/protection.ts'

if (!network.testnet || !network.payCheck) throw new Error('testnet with payCheck only')
const FILE = new URL('.state/test-merchant.json', root)
if (!existsSync(FILE)) throw new Error('no test merchant: run a browser e2e once (scripts/test-merchant.ts sets it up)')
const tm = JSON.parse(readFileSync(FILE, 'utf8')) as { key: Hex, masterId: Hex, arbiter: Address }
const mAcct = accountOf(tm.key), mw = walletFor(mAcct)
const buyer = accountOf(generatePrivateKey()), bw = walletFor(buyer)
const check = network.payCheck
const checkAbi = JSON.parse(readFileSync(new URL('forge-out/HeldPayCheck.sol/HeldPayCheck.json', root), 'utf8')).abi
const erc20 = parseAbi(['function transfer(address to, uint256 amount) returns (bool)', 'function approve(address spender, uint256 amount) returns (bool)'])
const arbAbi = parseAbi(['function payoutPolicyId() view returns (uint64)', 'function refund(bytes receipt)'])
const TransferBlocked = parseAbiItem('event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt)')
const ONE = 1_000_000n
const results: boolean[] = []
const ok = (name: string, pass: boolean, d: unknown = '') => { results.push(pass); log(pass ? 'PASS' : 'FAIL', name, d) }
const mined = async (hash: Hex) => (await pub.waitForTransactionReceipt({ hash })).status

log('test shop', mAcct.address, 'arbiter', tm.arbiter, '| buyer', buyer.address)
ok('shop starts protected', await policyHolds(pub as never, mAcct.address, tm.arbiter))
// Test funds for the buyer (live faucet), and gas for the merchant's policy switches.
const fr = await fetch('https://getheld.xyz/api/faucet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: buyer.address }) })
log('faucet', fr.status)
for (let i = 0; i < 30 && (await bal(buyer.address)) < 3n * ONE; i++) await new Promise((r) => setTimeout(r, 1500))
log('buyer pathUSD', fmt(await bal(buyer.address)))

// Same rule as the Pay button (wallet.ts payProtected): older testnet arbiters have no payoutPolicyId and expect 0.
const payout = await pub.readContract({ address: tm.arbiter, abi: arbAbi, functionName: 'payoutPolicyId' }).catch(() => 0n)
// Order addresses far from any order database's numbers (prefix 0x7778), so nothing real shares them.
const stamp = Math.floor(Date.now() / 1000) % 100000
const orderA = orderAddress(tm.masterId, 2 * stamp, 0x7778), orderB = orderAddress(tm.masterId, 2 * stamp + 1, 0x7778)
const args = (to: Address) => [to, mAcct.address, tm.arbiter, payout] as const
// The shop's policy as it is now (protected), to restore exactly, whatever the arbiter version.
const original = await Actions.receivePolicy.get(pub as never, { account: mAcct.address })
const restore = () => Actions.receivePolicy.set(mw, { senderPolicyId: original.senderPolicyId as never, tokenPolicyId: 'allow-all', claimer: tm.arbiter }).then(mined)
const switchOff = () => Actions.receivePolicy.set(mw, { senderPolicyId: 'allow-all', tokenPolicyId: 'allow-all', claimer: mAcct.address }).then(mined)

// The buyer page's own check passes now (shop protected). Route 2 also needs its allowance before the payChecked
// prompt, as a real browser wallet would do.
ok("buyer page's check passes before paying", (await pub.readContract({ address: check, abi: checkAbi, functionName: 'requireHeld', args: args(orderA) }).then(() => true, () => false)))
ok('route 2: approve HeldPayCheck', await mined(await bw.writeContract({ address: PATHUSD, abi: erc20, functionName: 'approve', args: [check, 2n * ONE] } as never)) === 'success')

// The race: the merchant switches protection off after the buyer's check and before the payment lands. The contract
// judges the state when the transaction executes, so each payment is sent with a fixed gas limit (no simulation that
// would refuse it early) and must be MINED and REVERT, with nothing moved.
ok('merchant switches protection OFF mid-checkout', (await switchOff()) === 'success')
ok('shop is now unprotected', !(await policyHolds(pub as never, mAcct.address, tm.arbiter)))
const shopBefore = await bal(mAcct.address), buyerBefore = await bal(buyer.address)
const send = async (fn: () => Promise<Hex>) => { try { const hash = await fn(); return { status: await mined(hash), hash } } catch (e) { return { status: 'not mined: ' + String((e as Error).message).split('\n')[0], hash: null } } }
const r1 = await send(() => bw.sendTransaction({ gas: 600_000n, feeToken: PATHUSD, calls: [
  { to: check, data: encodeFunctionData({ abi: checkAbi, functionName: 'requireHeld', args: args(orderA) }) },
  { to: PATHUSD, data: encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [orderA, ONE] }) }] } as never))
const r2 = await send(() => bw.writeContract({ address: check, abi: checkAbi, functionName: 'payChecked', args: [PATHUSD, orderB, ONE, mAcct.address, tm.arbiter, payout], gas: 1_000_000n, feeToken: PATHUSD } as never))
const shopGot = (await bal(mAcct.address)) - shopBefore, buyerSpent = buyerBefore - (await bal(buyer.address))
ok('route 1 (batched Tempo tx): mined and REVERTED', r1.status === 'reverted', r1)
ok('route 2 (payChecked, browser wallets): mined and REVERTED', r2.status === 'reverted', r2)
ok('nothing reached the merchant', shopGot === 0n, fmt(shopGot))
ok('buyer lost only network fees (< $1)', buyerSpent < ONE, fmt(buyerSpent))

// Back on: the same checkout now pays into protection, and the merchant can refund it.
ok('merchant switches protection back ON', (await restore()) === 'success' && await policyHolds(pub as never, mAcct.address, tm.arbiter))
const rc = await pub.waitForTransactionReceipt({ hash: await bw.sendTransaction({ calls: [
  { to: check, data: encodeFunctionData({ abi: checkAbi, functionName: 'requireHeld', args: args(orderA) }) },
  { to: PATHUSD, data: encodeFunctionData({ abi: erc20, functionName: 'transfer', args: [orderA, ONE] }) }], feeToken: PATHUSD } as never) })
const held = parseEventLogs({ abi: [TransferBlocked], logs: rc.logs })[0]
ok('after restore: payment HELD', rc.status === 'success' && !!held, rc.transactionHash)
if (held) {
  const before = await bal(buyer.address)
  const rs = await mined(await mw.writeContract({ address: tm.arbiter, abi: arbAbi, functionName: 'refund', args: [held.args.receipt as Hex], gas: 2_000_000n } as never))
  ok('merchant refunds the buyer: $1 back', rs === 'success' && (await bal(buyer.address)) - before === ONE)
  log('held payment id to remove from the live index (test data):', rc.transactionHash, 'receipt recipient', orderA)
}
const failed = results.filter((r) => !r).length
log(`${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`)
process.exit(failed ? 1 : 0)
