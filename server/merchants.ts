// Merchant registration: before Held lists a merchant (and tells their buyers "protected"), check on-chain that
// their setup really is Held's: the genuine HeldArbiter bytecode, their receive policy holding every payment with
// that arbiter as the only recovery authority, and a virtual-address master that belongs to them.
// A merchant who deployed a modified arbiter (e.g. one that pays them regardless) is refused.
import { encodeDeployData, isAddressEqual, zeroAddress, type Abi, type Address, type Hex } from 'viem'
import { Actions } from 'viem/tempo'
import { pub } from '../scripts/lib.ts'
import arbiterJson from '../shared/HeldArbiter.json' with { type: 'json' }
import type { Merchant, Network } from '../shared/api.ts'

const arbiter = arbiterJson as { abi: Abi, bytecode: Hex }
const MIN_WINDOW = { testnet: 60, mainnet: 24 * 3600 }

export type Verified = { ok: true, merchant: Omit<Merchant, 'name' | 'registeredAt'> } | { ok: false, error: string }

export async function verifyMerchant(address: Address, arbiterAddress: Address, masterId: Hex, network: Network): Promise<Verified> {
  const fail = (error: string): Verified => ({ ok: false, error })
  const code = await pub.getCode({ address: arbiterAddress })
  if (!code || code === '0x') return fail('No contract at the arbiter address.')

  const read = (functionName: 'merchant' | 'resolver' | 'acceptedTokens' | 'protectionWindow' | 'VERSION') =>
    pub.readContract({ address: arbiterAddress, abi: arbiter.abi, functionName }) as Promise<unknown>
  const [merchant, resolver, tokens, window, version] = await Promise.all([read('merchant'), read('resolver'), read('acceptedTokens'), read('protectionWindow'), read('VERSION')])
    .catch(() => [] as unknown[])
  if (typeof merchant !== 'string' || version !== 2n) return fail('The arbiter is not a current HeldArbiter (v2). Run setup again.')
  if (!isAddressEqual(merchant as Address, address)) return fail("The arbiter's merchant is not your wallet.")
  const accepted = tokens as Address[]
  if (!Array.isArray(accepted) || !accepted.length || !accepted.every((t) => network.tokens.some((n) => isAddressEqual(n.address, t))))
    return fail("The arbiter must accept only this network's stablecoins.")
  if (isAddressEqual(resolver as Address, zeroAddress)) return fail('The arbiter has no resolver.')
  const minWindow = network.testnet ? MIN_WINDOW.testnet : MIN_WINDOW.mainnet
  if (Number(window) < minWindow) return fail(`The protection window must be at least ${minWindow} seconds.`)

  // Byte-for-byte: deploying the genuine HeldArbiter with these parameters must produce exactly the deployed code.
  const deployData = encodeDeployData({ abi: arbiter.abi, bytecode: arbiter.bytecode,
    args: [merchant as Address, resolver as Address, accepted, window as bigint] })
  const { data: expected } = await pub.call({ data: deployData })
  if (!expected || expected.toLowerCase() !== code.toLowerCase()) return fail('The arbiter is not the genuine HeldArbiter contract.')

  const master = await Actions.virtualAddress.getMasterAddress(pub, { masterId }).catch(() => null)
  if (!master || !isAddressEqual(master, address)) return fail('That virtual-address master is not registered to your wallet.')

  const policy = await Actions.receivePolicy.get(pub, { account: address })
  if (!policy.recoveryAuthority || !isAddressEqual(policy.recoveryAuthority, arbiterAddress) || policy.senderPolicyId !== 'reject-all')
    return fail("Your wallet's receive policy doesn't hold payments for this arbiter yet.")

  return { ok: true, merchant: { address, masterId, arbiter: arbiterAddress, resolver: resolver as Address,
    acceptedTokens: accepted, window: Number(window) } }
}
