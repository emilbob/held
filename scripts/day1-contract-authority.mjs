// Day-1 critical-path spike: can a CONTRACT be the receive-policy recovery authority and call
// ReceivePolicyGuard.claim for both resume (-> merchant) and reroute (-> originator)?
// Deploys HeldArbiter on Tempo Moderato with a short window and runs the full rule set, incl. negative tests.
// Fresh random keys + faucet funds only.
import { createClient, createPublicClient, http, parseUnits, formatUnits, publicActions, walletActions } from 'viem'
import { tempoModerato } from 'viem/chains'
import { Actions } from 'viem/tempo'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { ReceivePolicyReceipt } from 'ox/tempo'
import { readFileSync } from 'node:fs'

const { abi, bytecode } = JSON.parse(readFileSync(new URL('../out/HeldArbiter.json', import.meta.url), 'utf8'))
const PATHUSD = '0x20c0000000000000000000000000000000000000'
const WRONG = '0x20c0000000000000000000000000000000000001'
const WINDOW = Number(process.env.WINDOW || 45)
const chain = tempoModerato.extend({ feeToken: PATHUSD })
const pub = createPublicClient({ chain, transport: http() })
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
const bal = async (a, token = PATHUSD) => BigInt((await Actions.token.getBalance(pub, { account: a, token })).amount)
const f = (x) => formatUnits(x, 6)

const names = ['merchant', 'buyer', 'resolver', 'stranger']
const acct = Object.fromEntries(names.map((n) => [n, privateKeyToAccount(generatePrivateKey())]))
const cl = Object.fromEntries(names.map((n) => [n, createClient({ account: acct[n], chain, transport: http() }).extend(publicActions).extend(walletActions)]))
for (const n of names) await Actions.faucet.fundSync(pub, { account: acct[n].address })
log('funded', names.join('/'))

const results = []
const check = (name, pass, detail = '') => { results.push({ name, pass }); log(pass ? 'PASS' : 'FAIL', name, detail) }

// 1. deploy arbiter
const hash = await cl.merchant.deployContract({ abi, bytecode, args: [acct.merchant.address, acct.resolver.address, PATHUSD, BigInt(WINDOW)] })
const dep = await pub.waitForTransactionReceipt({ hash })
const arbiter = dep.contractAddress
log('arbiter deployed', arbiter, dep.status)

// 2. merchant: hold everything, arbiter contract = recovery authority
await Actions.receivePolicy.setSync(cl.merchant, { senderPolicyId: 'reject-all', tokenPolicyId: 'allow-all', claimer: arbiter })
const pol = await Actions.receivePolicy.get(pub, { account: acct.merchant.address })
check('policy recoveryAuthority == arbiter contract', pol.recoveryAuthority?.toLowerCase() === arbiter.toLowerCase(), pol.recoveryAuthority)

async function pay(amount, token = PATHUSD) {
  const tx = await Actions.token.transferSync(cl.buyer, { to: acct.merchant.address, amount: parseUnits(amount, 6), token })
  const rc = tx.receipt ?? tx
  const [r] = ReceivePolicyReceipt.fromTransactionReceipt(rc)
  return r
}
async function call(who, fn, receipt) {
  try {
    const h = await cl[who].writeContract({ address: arbiter, abi, functionName: fn, args: [receipt], gas: 2_000_000n })
    const rc = await pub.waitForTransactionReceipt({ hash: h })
    return rc.status === 'success' ? { ok: true } : { ok: false, err: 'reverted' }
  } catch (e) { return { ok: false, err: (e.shortMessage || e.message).split('\n')[0] } }
}
const expectOk = async (name, who, fn, r) => { const x = await call(who, fn, r); check(name, x.ok, x.err || '') }
const expectFail = async (name, who, fn, r) => { const x = await call(who, fn, r); check(name + ' (expect revert)', !x.ok, x.err || 'UNEXPECTEDLY SUCCEEDED') }

// ORDER A: delivered, buyer confirms -> contract RESUME claim to merchant
let m0 = await bal(acct.merchant.address)
const rA = await pay('20')
check('payment A held (merchant balance unchanged)', (await bal(acct.merchant.address)) === m0)
await expectFail('merchant release A before window', 'merchant', 'release', rA)
await expectFail('stranger release A before window', 'stranger', 'release', rA)
m0 = await bal(acct.merchant.address) // re-snapshot: merchant paid gas (in pathUSD) for the failed attempt above
await expectOk('buyer confirms delivery -> release A', 'buyer', 'release', rA)
check('merchant received 20 (resume by contract)', (await bal(acct.merchant.address)) - m0 === parseUnits('20', 6), f((await bal(acct.merchant.address)) - m0))
await expectFail('release A twice', 'buyer', 'release', rA)
await expectFail('refund A after release', 'merchant', 'refund', rA)

// ORDER B: buyer disputes -> resolver refunds -> contract REROUTE claim to originator
const rB = await pay('15')
await expectFail('stranger opens dispute on B', 'stranger', 'dispute', rB)
await expectFail('merchant opens dispute on B', 'merchant', 'dispute', rB)
await expectFail('resolver refunds B without dispute', 'resolver', 'refund', rB)
await expectFail('buyer refunds own accepted-token payment B', 'buyer', 'refund', rB)
await expectOk('buyer opens dispute on B', 'buyer', 'dispute', rB)
await expectFail('dispute B twice', 'buyer', 'dispute', rB)
await expectFail('buyer releases disputed B', 'buyer', 'release', rB)
await expectFail('stranger releases disputed B', 'stranger', 'release', rB)
let b0 = await bal(acct.buyer.address)
await expectOk('resolver refunds disputed B', 'resolver', 'refund', rB)
check('buyer refunded 15 (reroute by contract)', (await bal(acct.buyer.address)) - b0 === parseUnits('15', 6), f((await bal(acct.buyer.address)) - b0))

// Direct guard claims by humans must fail (only the arbiter contract is recovery authority)
const rC = await pay('5')
for (const who of ['merchant', 'buyer', 'resolver']) {
  const x = await Actions.receivePolicy.claimSync(cl[who], { receipt: rC, to: acct[who].address }).then(() => ({ ok: true }), (e) => ({ ok: false, err: e.shortMessage }))
  check(`${who} direct guard.claim on C (expect revert)`, !x.ok, x.err || 'UNEXPECTEDLY SUCCEEDED')
}

// ORDER D: merchant refunds voluntarily
const rD = await pay('3')
b0 = await bal(acct.buyer.address)
await expectOk('merchant voluntary refund D', 'merchant', 'refund', rD)
check('buyer refunded 3', (await bal(acct.buyer.address)) - b0 === parseUnits('3', 6))

// ORDER E: wrong token -> payer can self-refund
const rE = await pay('7', WRONG)
const w0 = await bal(acct.buyer.address, WRONG)
await expectFail('stranger refunds wrong-token E', 'stranger', 'refund', rE)
await expectOk('buyer self-refunds wrong-token E', 'buyer', 'refund', rE)
check('buyer got wrong token back', (await bal(acct.buyer.address, WRONG)) - w0 === parseUnits('7', 6))

// ORDER C: window expires -> permissionless release by a stranger
const end = Number((await pub.readContract({ address: arbiter, abi, functionName: 'windowEndsAt', args: [rC] })))
const wait = Math.max(0, end - Math.floor(Date.now() / 1000) + 3)
log(`waiting ${wait}s for window on C to close`)
await new Promise((r) => setTimeout(r, wait * 1000))
await expectFail('buyer opens dispute on C after window', 'buyer', 'dispute', rC)
m0 = await bal(acct.merchant.address)
await expectOk('stranger releases C after window (permissionless)', 'stranger', 'release', rC)
check('merchant received 5', (await bal(acct.merchant.address)) - m0 === parseUnits('5', 6))

const failed = results.filter((r) => !r.pass)
log(`\n${results.length - failed.length}/${results.length} checks passed. arbiter=${arbiter}`)
process.exit(failed.length ? 1 : 0)
