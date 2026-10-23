// Merchant registration: before Held lists a merchant (and tells their buyers "protected"), check on-chain that
// their setup really is Held's: the genuine HeldArbiter bytecode, their receive policy holding every payment with
// that arbiter as the only recovery authority (and only its own payouts passing through), Held's fee settings for
// this network, and a virtual-address master that belongs to them.
// A merchant who deployed a modified arbiter (e.g. one that pays them regardless) is refused.
import { isAddressEqual, zeroAddress, type Address, type Hex } from 'viem'
import { Actions } from 'viem/tempo'
import { pub } from '../scripts/lib.ts'
import { policyHolds, readArbiter } from '../shared/protection.ts'
import type { Merchant, Network } from '../shared/api.ts'

const MIN_WINDOW = { testnet: 60, mainnet: 24 * 3600 }
// The resolver's deadline: long enough to read both sides (mainnet), at most what the contract allows (90 days).
const MIN_RESOLVE_WINDOW = { testnet: 60, mainnet: 24 * 3600 }

export type Verified = { ok: true, merchant: Omit<Merchant, 'name' | 'registeredAt'> } | { ok: false, error: string }

// `fee`: the fee this shop must have. A new shop gets the network's current fee; a shop changing its settings keeps the
// fee it was set up with (locked per shop, so a later change of Held's fee never reaches it).
export async function verifyMerchant(address: Address, arbiterAddress: Address, masterId: Hex, network: Network, fee = network.fee): Promise<Verified> {
  const fail = (error: string): Verified => ({ ok: false, error })
  // Genuine HeldArbiter v4, byte-for-byte for the settings it holds; then those settings must be the ones Held lists.
  const arb = await readArbiter(pub, arbiterAddress)
  if (!arb.ok) return fail(arb.error + ' Run setup again.')
  const { merchant, resolver, tokens: accepted, window, resolveWindow, feeRecipient, feeBps, feeStart, feeCap, payoutPolicyId } = arb.params
  if (!isAddressEqual(merchant, address)) return fail("The arbiter's merchant is not your wallet.")
  if (!accepted.length || !accepted.every((t) => network.tokens.some((n) => isAddressEqual(n.address, t))))
    return fail("The arbiter must accept only this network's stablecoins.")
  if (isAddressEqual(resolver, zeroAddress)) return fail('The arbiter has no resolver.')
  // Disputes are decided by Held's resolver only: a shop naming its own resolver (e.g. a second wallet of its own) could
  // decide every dispute in its own favour. The sandbox shop keeps its public test resolver; local tests may add one (testnet only).
  const sb = network.testnet && network.sandbox
  const allowed = [network.defaultResolver, ...(sb && isAddressEqual(address, sb.merchant) ? [sb.resolver] : []),
    ...(network.testnet && process.env.HELD_TEST_RESOLVER ? [process.env.HELD_TEST_RESOLVER as Address] : [])]
  if (!allowed.some((a) => isAddressEqual(a, resolver))) return fail("The arbiter's resolver must be Held's resolver. Run setup again.")
  const minWindow = network.testnet ? MIN_WINDOW.testnet : MIN_WINDOW.mainnet
  if (Number(window) < minWindow) return fail(`The protection window must be at least ${minWindow} seconds.`)
  const minResolve = network.testnet ? MIN_RESOLVE_WINDOW.testnet : MIN_RESOLVE_WINDOW.mainnet
  if (Number(resolveWindow) < minResolve) return fail(`The resolver's deadline must be at least ${minResolve} seconds.`)
  // The fee is part of the deal Held lists: it must be exactly the expected one (a shop can't opt out or redirect it).
  if (!isAddressEqual(feeRecipient, fee.recipient) || feeBps !== fee.bps || feeStart !== BigInt(fee.start) || feeCap !== BigInt(fee.cap))
    return fail("The arbiter's fee settings aren't Held's. Run setup again.")

  const master = await Actions.virtualAddress.getMasterAddress(pub, { masterId }).catch(() => null)
  if (!master || !isAddressEqual(master, address)) return fail('That virtual-address master is not registered to your wallet.')

  if (!(await policyHolds(pub, address, arbiterAddress, payoutPolicyId)))
    return fail("Your wallet's receive policy doesn't hold payments for this arbiter yet.")

  return { ok: true, merchant: { address, masterId, arbiter: arbiterAddress, resolver,
    acceptedTokens: accepted, window: Number(window), resolveWindow: Number(resolveWindow) } }
}
