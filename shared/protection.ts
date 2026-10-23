// Is a shop protected right now? Read from the chain alone, so the buyer page doesn't have to trust Held's server, and
// the server can re-check a shop long after it registered. Tempo can't lock a receive policy: a merchant could switch
// theirs off (or point it at another contract) at any time, and new payments would then reach them unprotected while
// Held's pages still said "protected". Existing held payments are safe either way: each receipt keeps the recovery
// authority it was held under.
import { encodeDeployData, isAddressEqual, parseAbi, type Abi, type Address, type Hex, type PublicClient } from 'viem'
import { Actions } from 'viem/tempo'
import arbiterJson from './HeldArbiter.json' with { type: 'json' }

const arbiter = arbiterJson as { abi: Abi, bytecode: Hex }
const REGISTRY: Address = '0xfdc0000000000000000000000000000000000000' // TIP-1022 virtual addresses
const TIP403: Address = '0x403c000000000000000000000000000000000000'
const registryAbi = parseAbi(['function resolveRecipient(address to) view returns (address)'])
const tip403Abi = parseAbi(['function isAuthorizedSender(uint64 policyId, address user) view returns (bool)'])
const versionAbi = parseAbi(['function VERSION() view returns (uint256)'])
// Any client with readContract/call/getCode (the server's and the browser's are built on different chain objects).
type Pub = Pick<PublicClient, 'readContract' | 'call' | 'getCode'>

export interface ArbiterParams {
  version: bigint, merchant: Address, resolver: Address, tokens: Address[], window: bigint, resolveWindow: bigint,
  feeRecipient: Address, feeBps: number, feeStart: bigint, feeCap: bigint, payoutPolicyId: bigint,
}
type View = 'merchant' | 'resolver' | 'acceptedTokens' | 'protectionWindow' | 'resolveWindow' | 'feeRecipient' | 'feeBps' | 'feeStart' | 'feeCap' | 'payoutPolicyId'
const VIEWS: View[] = ['merchant', 'resolver', 'acceptedTokens', 'protectionWindow', 'resolveWindow', 'feeRecipient', 'feeBps', 'feeStart', 'feeCap', 'payoutPolicyId']

/** The arbiter's settings if it's the genuine HeldArbiter v4: deploying the genuine code with the settings it holds
 *  must produce exactly the deployed code. */
export async function readArbiter(pub: Pub, address: Address): Promise<{ ok: true, params: ArbiterParams } | { ok: false, error: string }> {
  const code = await pub.getCode({ address })
  if (!code || code === '0x') return { ok: false, error: 'No contract at the arbiter address.' }
  const version = await pub.readContract({ address, abi: versionAbi, functionName: 'VERSION' }).catch(() => null)
  if (version !== 4n) return { ok: false, error: 'The arbiter is not a current HeldArbiter (v4).' }
  const [merchant, resolver, tokens, window, resolveWindow, feeRecipient, feeBps, feeStart, feeCap, payoutPolicyId] =
    await Promise.all(VIEWS.map((functionName) => pub.readContract({ address, abi: arbiter.abi, functionName }) as Promise<unknown>))
  const p = { version, merchant, resolver, tokens, window, resolveWindow, feeRecipient, feeBps: Number(feeBps), feeStart, feeCap, payoutPolicyId } as ArbiterParams
  const data = encodeDeployData({ abi: arbiter.abi, bytecode: arbiter.bytecode,
    args: [p.merchant, p.resolver, p.tokens, p.window, p.resolveWindow, p.feeRecipient, p.feeBps, p.feeStart, p.feeCap] })
  const { data: expected } = await pub.call({ data })
  if (!expected || expected.toLowerCase() !== code.toLowerCase()) return { ok: false, error: 'The arbiter is not the genuine HeldArbiter contract.' }
  return { ok: true, params: p }
}

/** True if `merchant`'s receive policy still holds every payment for `arbiterAddress`: the arbiter is the only recovery
 *  authority and only its own payouts pass (v3+: its payout whitelist; older arbiters: no sender passes). */
export async function policyHolds(pub: Pub, merchant: Address, arbiterAddress: Address, payoutPolicyId?: bigint | null): Promise<boolean> {
  const p = await Actions.receivePolicy.get(pub as never, { account: merchant })
  if (!p.hasReceivePolicy || !p.recoveryAuthority || !isAddressEqual(p.recoveryAuthority, arbiterAddress)) return false
  return payoutPolicyId ? p.senderPolicyId === payoutPolicyId : p.senderPolicyId === 'reject-all'
}

/** The payout whitelist a v3+ arbiter's merchant policy must use as sender policy; null for older arbiters (v1-v2),
 *  whose merchants hold every sender. Throws on RPC errors, so a busy node never passes for an old arbiter. */
export async function payoutPolicyOf(pub: Pub, arbiterAddress: Address): Promise<bigint | null> {
  const version = await pub.readContract({ address: arbiterAddress, abi: versionAbi, functionName: 'VERSION' })
  return version >= 3n ? pub.readContract({ address: arbiterAddress, abi: arbiter.abi, functionName: 'payoutPolicyId' }) as Promise<bigint> : null
}

export type Protection = { ok: true } | { ok: false, reason: string }

/** Everything a buyer relies on before paying, from the chain: the pay-to address is the shop's, the shop's arbiter is
 *  the genuine contract with the resolver and window this page shows, and the shop's receive policy still holds every
 *  payment for it. Older arbiters (v1-v2, testnet only) have no byte-for-byte check here; the policy is still checked. */
export async function checkCheckout(pub: Pub, c: { merchant: Address, arbiter: Address, address: Address, resolver: Address, window: number, testnet: boolean }): Promise<Protection> {
  const fail = (reason: string): Protection => ({ ok: false, reason })
  const [owner, arb] = await Promise.all([
    pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'resolveRecipient', args: [c.address] }),
    readArbiter(pub, c.arbiter),
  ])
  if (!isAddressEqual(owner, c.merchant)) return fail("This payment address doesn't belong to the shop.")
  let payoutPolicyId: bigint | null = null
  if (arb.ok) {
    const p = arb.params
    if (!isAddressEqual(p.merchant, c.merchant)) return fail("The shop's Held contract belongs to another wallet.")
    if (!isAddressEqual(p.resolver, c.resolver) || Number(p.window) !== c.window) return fail("The shop's settings on the chain don't match this page.")
    payoutPolicyId = p.payoutPolicyId
  } else if (!c.testnet) return fail("The shop's contract isn't Held's genuine contract.")
  if (!(await policyHolds(pub, c.merchant, c.arbiter, payoutPolicyId)))
    return fail('This shop has switched off Held\'s protection: a payment now would go straight to the merchant.')
  return { ok: true }
}

/** A refund is a guard "reroute" to the payer, which Tempo allows only if the payer's own receive policy accepts the
 *  merchant as a sender. False if the paying wallet's policy would refuse it (e.g. it's another shop's checkout wallet). */
export async function refundReachable(pub: Pub, payer: Address, merchant: Address): Promise<boolean> {
  const p = await Actions.receivePolicy.get(pub as never, { account: payer })
  if (!p.hasReceivePolicy || p.senderPolicyId === 'allow-all') return true
  if (p.senderPolicyId === 'reject-all') return false
  return pub.readContract({ address: TIP403, abi: tip403Abi, functionName: 'isAuthorizedSender', args: [p.senderPolicyId, merchant] })
}
