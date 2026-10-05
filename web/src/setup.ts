// Merchant setup, run from the merchant's own wallet (nothing here touches Held's server or any shared key):
//   1. mine a TIP-1022 salt for the checkout address (proof of work, in Web Workers; minutes)
//   2. register the checkout address as a virtual-address master (one tx)
//   3. deploy the merchant's own HeldArbiter (merchant, resolver, accepted stablecoins, protection window, resolver
//      deadline, and Held's fee settings, fixed for this shop) (one tx)
//   4. set the receive policy: hold every incoming payment, with that arbiter as the only recovery authority; only the
//      arbiter's own payouts (the merchant's share of a release with a fee) pass straight through (one tx)
// Every step is skipped if already done and saved after each one, so a reload never repeats a finished step.
import { VirtualMaster } from 'ox/tempo'
import { Actions } from 'viem/tempo'
import { encodeDeployData, isAddressEqual, type Abi, type Address, type Hex, type PublicClient } from 'viem'
import arbiterJson from '../../shared/HeldArbiter.json' with { type: 'json' }
import type { Wallet } from './wallet.ts'
import type { Network } from '../../shared/api.ts'

const arbiter = arbiterJson as { abi: Abi, bytecode: Hex }

export interface SetupState { salt?: Hex, masterId?: Hex, arbiter?: Address }
export type SetupStep = 'mine' | 'register' | 'deploy' | 'policy' | 'done'
export interface MiningProgress { attempts: number, rate: number, elapsed: number }

// Mining is memoryless: every salt has the same 1 in 2^32 chance, so a restart from a fresh random point loses nothing.
// That makes a watchdog safe: browser workers can stall or die silently (the pool then never resolves), so if no
// progress arrives for STALL_MS, stop them and start again. A reload likewise just starts a fresh search.
const STALL_MS = 20_000
async function mine(address: Address, onProgress: ((m: MiningProgress) => void) | undefined, signal: AbortSignal | undefined) {
  let done = 0 // attempts in finished runs
  const started = Date.now()
  for (;;) {
    if (signal?.aborted) throw signal.reason ?? new Error('Setup was stopped.')
    const run = new AbortController()
    const stop = () => run.abort()
    signal?.addEventListener('abort', stop)
    let last = Date.now(), attempts = 0
    const watchdog = setInterval(() => { if (Date.now() - last > STALL_MS) run.abort() }, 5000)
    // Random start below 2^224, so start + 2^32 never overflows the 32-byte salt.
    const start = ('0x' + '00000000' + [...crypto.getRandomValues(new Uint8Array(28))].map((b) => b.toString(16).padStart(2, '0')).join('')) as Hex
    try {
      const r = await VirtualMaster.mineSaltAsync({ address, start, signal: run.signal, onProgress: (x) => {
        last = Date.now(); attempts = x.attempts
        const elapsed = Date.now() - started
        onProgress?.({ attempts: done + x.attempts, rate: x.rate, elapsed })
      } })
      if (r) return r
    } catch (e) {
      if (signal?.aborted) throw e // the merchant stopped setup; a stalled run just restarts
    } finally {
      clearInterval(watchdog); signal?.removeEventListener('abort', stop)
      done += attempts
    }
  }
}

export async function runSetup(p: {
  wallet: Wallet, pub: PublicClient, resolver: Address, tokens: Address[], window: number, resolveWindow: number, fee: Network['fee'],
  state: SetupState, save: (s: SetupState) => void,
  onStep: (s: SetupStep) => void, onProgress?: (m: MiningProgress) => void, signal?: AbortSignal,
}): Promise<{ masterId: Hex, arbiter: Address }> {
  const { wallet, pub, state } = p
  const me = wallet.address
  const wait = async (hash: Hex, what: string) => {
    const rc = await pub.waitForTransactionReceipt({ hash })
    if (rc.status !== 'success') throw new Error(`${what} failed on-chain.`)
    return rc
  }

  // 1. Salt.
  if (!state.salt || !state.masterId) {
    p.onStep('mine')
    const r = await mine(me, p.onProgress, p.signal)
    state.salt = r.salt; state.masterId = r.masterId; p.save(state)
  }

  // 2. Virtual-address master.
  p.onStep('register')
  const owner = await Actions.virtualAddress.getMasterAddress(pub, { masterId: state.masterId! }).catch(() => null)
  if (!owner || !isAddressEqual(owner, me)) {
    if (owner) throw new Error('This virtual-address master belongs to another wallet. Mine a new one.')
    await wait(await Actions.virtualAddress.registerMaster(wallet.client, { salt: state.salt }), 'Registering the checkout address')
  }

  // 3. The merchant's own arbiter.
  p.onStep('deploy')
  // Reuse a saved arbiter only if it's the current version (an older arbiter from an earlier setup gets replaced;
  // step 4 then points the receive policy at the new one).
  const current = state.arbiter && (await pub.getCode({ address: state.arbiter })) !== undefined &&
    (await pub.readContract({ address: state.arbiter, abi: arbiter.abi, functionName: 'VERSION' }).catch(() => 0n)) === 3n
  if (!current) {
    const f = p.fee
    const args = [me, p.resolver, p.tokens, BigInt(p.window), BigInt(p.resolveWindow), f.recipient, f.bps, BigInt(f.start), BigInt(f.cap)] as const
    // Tempo Wallet (Accounts SDK 0.18) drops the bytecode of a transaction without `to` and sends an empty call to
    // 0x0, so a plain deploy "succeeds" without creating anything. An explicit create call (no `to`) goes through.
    const hash = wallet.kind === 'tempo' && wallet.provider
      ? await wallet.provider.request({ method: 'eth_sendTransaction', params: [{ from: me, calls: [{ data: encodeDeployData({ abi: arbiter.abi, bytecode: arbiter.bytecode, args }) }] }] } as never) as Hex
      : await wallet.client.deployContract({ abi: arbiter.abi, bytecode: arbiter.bytecode, args })
    const rc = await wait(hash, 'Deploying the arbiter')
    if (!rc.contractAddress) throw new Error('Deploying the arbiter returned no address.')
    state.arbiter = rc.contractAddress
    p.save(state)
  }

  // 4. Receive policy: hold everything except the arbiter's own payouts; only the arbiter may release (to the
  // merchant) or refund (to the payer). The sender policy is the arbiter's whitelist, which holds only the arbiter.
  p.onStep('policy')
  const arb = state.arbiter!
  const payout = await pub.readContract({ address: arb, abi: arbiter.abi, functionName: 'payoutPolicyId' }) as bigint
  const pol = await Actions.receivePolicy.get(pub, { account: me })
  if (!pol.recoveryAuthority || !isAddressEqual(pol.recoveryAuthority, arb) || pol.senderPolicyId !== payout)
    await wait(await Actions.receivePolicy.set(wallet.client, { senderPolicyId: payout, tokenPolicyId: 'allow-all', claimer: arb }), 'Setting the receive policy')

  p.onStep('done')
  return { masterId: state.masterId!, arbiter: arb }
}
