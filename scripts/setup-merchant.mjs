// One-time merchant setup on Tempo Moderato. Idempotent: every step is skipped if already done.
//   1. merchant + resolver testnet keys (created once, stored in .state/merchant.json)
//   2. faucet funding
//   3. mine the virtual-address master salt (slow, 1-5 min; done once, stored)
//   4. register the merchant checkout address as a virtual-address master
//   5. deploy HeldArbiter (merchant, resolver, pathUSD, protection window)
//   6. receive policy on the checkout address: hold all incoming, recovery authority = HeldArbiter
// Env: WINDOW=<seconds> (default 300: short so the demo can show the window closing), REDEPLOY=1 to redeploy the arbiter.
import { Actions } from 'viem/tempo'
import { generatePrivateKey } from 'viem/accounts'
import { VirtualMaster } from 'ox/tempo'
import { pub, walletFor, artifact, loadState, saveState, log, PATHUSD, accountOf, bal, fmt } from './lib.mjs'

const s = loadState()
const WINDOW = BigInt(process.env.WINDOW || s.window || 300)

s.merchantKey ??= generatePrivateKey()
s.resolverKey ??= generatePrivateKey()
const merchant = accountOf(s.merchantKey)
const resolver = accountOf(s.resolverKey)
s.merchant = merchant.address
s.resolver = resolver.address
saveState(s)
log('merchant (checkout address)', merchant.address, '| resolver', resolver.address)

for (const a of [merchant, resolver]) {
  if ((await bal(a.address)) < 100_000_000n) await Actions.faucet.fundSync(pub, { account: a.address })
}
log('merchant balance', fmt(await bal(merchant.address)))

const mc = walletFor(merchant)

// Salt: 2^32 tries per pass; a pass can miss, so continue with the next range.
if (!s.salt) {
  const t = Date.now()
  for (let pass = 0; !s.salt; pass++) {
    log(`mining salt, pass ${pass}...`)
    const r = await VirtualMaster.mineSaltAsync({ address: merchant.address, start: BigInt(pass) << 32n })
    if (r) Object.assign(s, { salt: r.salt, masterId: r.masterId })
  }
  saveState(s)
  log(`salt mined in ${((Date.now() - t) / 1000).toFixed(0)}s, masterId ${s.masterId}`)
}

const registered = await Actions.virtualAddress.getMasterAddress(pub, { masterId: s.masterId }).catch(() => null)
if (registered?.toLowerCase() !== merchant.address.toLowerCase()) {
  await Actions.virtualAddress.registerMasterSync(mc, { salt: s.salt })
  log('registered virtual-address master', s.masterId)
} else log('master already registered', s.masterId)

if (!s.arbiter || process.env.REDEPLOY || BigInt(s.window ?? 0) !== WINDOW) {
  const { abi, bytecode } = artifact()
  const hash = await mc.deployContract({ abi, bytecode, args: [merchant.address, resolver.address, PATHUSD, WINDOW] })
  const rc = await pub.waitForTransactionReceipt({ hash })
  if (rc.status !== 'success') throw new Error('arbiter deploy failed')
  Object.assign(s, { arbiter: rc.contractAddress, arbiterBlock: rc.blockNumber.toString(), window: WINDOW.toString() })
  saveState(s)
  log('HeldArbiter deployed', s.arbiter, `window ${WINDOW}s`)
}

const pol = await Actions.receivePolicy.get(pub, { account: merchant.address })
if (pol.recoveryAuthority?.toLowerCase() !== s.arbiter.toLowerCase() || pol.senderPolicyId !== 'reject-all') {
  await Actions.receivePolicy.setSync(mc, { senderPolicyId: 'reject-all', tokenPolicyId: 'allow-all', claimer: s.arbiter })
  log('receive policy set: hold all incoming, recovery authority = arbiter')
} else log('receive policy already set')

// Public, non-secret deployment info, committed for the frontend and README.
const { writeFileSync } = await import('node:fs')
writeFileSync(
  new URL('../deployment.json', import.meta.url),
  JSON.stringify(
    { chainId: 42431, merchant: s.merchant, resolver: s.resolver, masterId: s.masterId, arbiter: s.arbiter,
      arbiterBlock: s.arbiterBlock, window: s.window, acceptedToken: PATHUSD },
    null, 2) + '\n',
)
log('done -> deployment.json')
process.exit(0)
