// Held indexer: chain -> order states, for every registered merchant.
// Sources:
//   ReceivePolicyGuard.TransferBlocked(receiver = a merchant) -> a held payment (receipt bytes, amount, token)
//   HeldArbiter.Disputed / Released / Refunded on each merchant's arbiter (id = keccak256(receipt)) -> decisions
//   HeldArbiter.FeeCharged (v3) -> the fee taken from a release (for the owner's fee emails)
// Payments match orders by address: each order has its own virtual address under its merchant's master.
import { parseAbiItem, keccak256 } from 'viem'
import { ReceivePolicyReceipt } from 'ox/tempo'
import { pub, orderIdOf } from '../scripts/lib.ts'
import { acceptedTokensOf, type ArbiterSettings, type Db, type Order, type PaymentStatus, type StoredOrder } from '../shared/api.ts'

const GUARD = '0xB10C000000000000000000000000000000000000'
const TransferBlocked = parseAbiItem('event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt)')
const arbiterEvents = [
  parseAbiItem('event Disputed(bytes32 indexed id, address indexed originator)'),
  parseAbiItem('event Released(bytes32 indexed id, address indexed caller, uint256 amount)'),
  parseAbiItem('event Refunded(bytes32 indexed id, address indexed caller, address indexed originator, uint256 amount)'),
  parseAbiItem('event FeeCharged(bytes32 indexed id, address indexed token, address indexed recipient, uint256 fee)'),
] as const
const decisionStatus = { Disputed: 'disputed', Released: 'released', Refunded: 'refunded' } as const satisfies Record<string, PaymentStatus>
const MAX_RANGE = 50_000n

export function createIndexer({ store }: { store: Db }) {
  const newDisputes: string[] = [] // payment ids that became disputed during this sync (for alerts)
  const newFees: string[] = [] // payment ids whose release paid Held's fee during this sync (for fee emails)
  async function scanRange(fromBlock: bigint, toBlock: bigint) {
    const merchants = Object.values(store.merchants)
    if (!merchants.length) return
    const byAddress = new Map(merchants.map((m) => [m.address.toLowerCase(), m]))
    // Each shop's current arbiter and the ones it used before changing settings (their payments keep their rules).
    const settingsOf = new Map<string, ArbiterSettings>(merchants.flatMap((m) => [
      [m.arbiter.toLowerCase(), { arbiter: m.arbiter, resolver: m.resolver, acceptedTokens: acceptedTokensOf(m), window: m.window, resolveWindow: m.resolveWindow }] as const,
      ...(m.previousArbiters ?? []).map((a) => [a.arbiter.toLowerCase(), a] as const)]))
    const arbiters = new Set(settingsOf.keys())
    // strict: only logs whose args decode fully (all of ours do), so every field below is present.
    const [blocked, decisions] = await Promise.all([
      pub.getLogs({ address: GUARD, event: TransferBlocked, args: { receiver: merchants.map((m) => m.address) }, fromBlock, toBlock, strict: true }),
      pub.getLogs({ address: [...settingsOf.values()].map((a) => a.arbiter), events: arbiterEvents, fromBlock, toBlock, strict: true }),
    ])
    for (const l of blocked) {
      const merchant = byAddress.get(l.args.receiver.toLowerCase())
      if (!merchant) continue
      const receipt = l.args.receipt
      const d = ReceivePolicyReceipt.decode(receipt)
      // Held for this shop's current arbiter or one it used before (a payment that landed just as it changed settings).
      // Anything else was held under a policy Held never verified for this shop.
      const own = [merchant.arbiter, ...(merchant.previousArbiters ?? []).map((a) => a.arbiter)].map((a) => a.toLowerCase())
      const arb = settingsOf.get(d.recoveryAuthority.toLowerCase())
      if (!arb || !own.includes(d.recoveryAuthority.toLowerCase())) continue
      const id = keccak256(receipt)
      if (store.payments[id]) continue
      store.payments[id] = {
        id, receipt,
        merchant: merchant.address,
        userTag: orderIdOf(d.recipient),
        payer: d.originator,
        recipient: d.recipient,
        token: d.token,
        wrongToken: !arb.acceptedTokens.some((t) => t.toLowerCase() === d.token.toLowerCase()),
        amount: l.args.amount.toString(),
        heldAt: Number(d.blockedAt),
        windowEndsAt: Number(d.blockedAt) + arb.window,
        arbiter: arb.arbiter,
        txHash: l.transactionHash,
        status: 'held',
        history: [{ status: 'held', tx: l.transactionHash, at: Number(d.blockedAt) }],
      }
    }
    // Decisions are applied after payments (same range can contain both); logs are ordered by block/index.
    for (const l of decisions) {
      if (!arbiters.has(l.address.toLowerCase())) continue
      const p = store.payments[l.args.id]
      if (!p) continue
      if (l.eventName === 'FeeCharged') {
        if (p.fee === undefined) { p.fee = l.args.fee.toString(); newFees.push(p.id) } // once, even if a range is rescanned
        continue
      }
      const status = decisionStatus[l.eventName]
      if (p.history.some((h) => h.tx === l.transactionHash && h.status === status)) continue
      p.status = status
      if (status === 'disputed') {
        newDisputes.push(p.id)
        // v3 shops: the resolver's deadline counts from the dispute's block (rare event, so one extra call is fine).
        const m = settingsOf.get((p.arbiter ?? store.merchants[p.merchant.toLowerCase()]?.arbiter ?? '').toLowerCase())
        if (m?.resolveWindow) p.resolveBy = Number((await pub.getBlock({ blockNumber: l.blockNumber })).timestamp) + m.resolveWindow
      }
      p.history.push({ status, tx: l.transactionHash, by: 'caller' in l.args ? l.args.caller : l.args.originator, block: Number(l.blockNumber) })
    }
  }

  // Scans up to the finalized block (on Tempo that's the latest: finality is immediate, so no reorg handling is
  // needed). Works within a time budget: after a long outage, catching up takes several calls instead of one call
  // that a serverless time limit cuts off (which would lose its progress every time). Progress is in store.lastBlock.
  async function sync(budgetMs = 30_000) {
    const started = Date.now()
    const head = (await pub.getBlock({ blockTag: 'finalized' })).number
    let from = BigInt(store.lastBlock)
    while (from <= head && Date.now() - started < budgetMs) {
      const to = from + MAX_RANGE - 1n < head ? from + MAX_RANGE - 1n : head
      await scanRange(from, to)
      store.lastBlock = (to + 1n).toString()
      from = to + 1n
    }
    return head
  }

  return { sync, newDisputes, newFees }
}

// Order view = order + its merchant + its payments, with a single derived status for the UI.
// Payments match by address, so payments to another database's orders (same merchant) never show up here.
export function orderView(store: Db, order: StoredOrder, now = Math.floor(Date.now() / 1000)): Order {
  const address = order.address.toLowerCase()
  const payments = Object.values(store.payments).filter((p) => p.recipient.toLowerCase() === address)
  const main = payments.find((p) => !p.wrongToken)
  let status: Order['status'] = 'awaiting_payment'
  if (main) {
    status = main.status
    if (status === 'held' && now >= main.windowEndsAt) status = 'releasable' // window over, anyone can release
  }
  const m = store.merchants[order.merchant.toLowerCase()]
  const paid = payments.filter((p) => !p.wrongToken).reduce((a, p) => a + BigInt(p.amount), 0n)
  return {
    ...order,
    merchantInfo: { name: m.name, arbiter: m.arbiter, resolver: m.resolver, window: m.window, resolveWindow: m.resolveWindow, acceptedTokens: acceptedTokensOf(m) },
    status,
    underpaid: main ? paid < BigInt(order.amount) : false,
    payments: payments.map(({ history, ...p }) => ({ ...p, history,
      releasable: p.status === 'held' && now >= p.windowEndsAt,
      deadlinePassed: p.status === 'disputed' && !!p.resolveBy && now >= p.resolveBy })),
  }
}
