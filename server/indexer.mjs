// Held indexer: chain -> order states.
// Sources:
//   ReceivePolicyGuard.TransferBlocked(receiver = merchant) -> a held payment (receipt bytes, amount, token)
//   HeldArbiter.Disputed / Released / Refunded (id = keccak256(receipt)) -> decisions
// A payment is matched to an order by the receipt's recipient: a virtual address whose userTag is the order id.
import { parseAbiItem, keccak256 } from 'viem'
import { ReceivePolicyReceipt } from 'ox/tempo'
import { pub, orderIdOf, PATHUSD } from '../scripts/lib.mjs'

const GUARD = '0xB10C000000000000000000000000000000000000'
const TransferBlocked = parseAbiItem('event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt)')
const arbiterEvents = [
  parseAbiItem('event Disputed(bytes32 indexed id, address indexed originator)'),
  parseAbiItem('event Released(bytes32 indexed id, address indexed caller, uint256 amount)'),
  parseAbiItem('event Refunded(bytes32 indexed id, address indexed caller, address indexed originator, uint256 amount)'),
]
const MAX_RANGE = 50_000n

export function createIndexer({ store, deployment }) {
  const merchant = deployment.merchant
  const arbiter = deployment.arbiter
  const window = BigInt(deployment.window)

  async function scanRange(fromBlock, toBlock) {
    const [blocked, decisions] = await Promise.all([
      pub.getLogs({ address: GUARD, event: TransferBlocked, args: { receiver: merchant }, fromBlock, toBlock }),
      pub.getLogs({ address: arbiter, events: arbiterEvents, fromBlock, toBlock }),
    ])
    for (const l of blocked) {
      const receipt = l.args.receipt
      const d = ReceivePolicyReceipt.decode(receipt)
      if (d.recoveryAuthority.toLowerCase() !== arbiter.toLowerCase()) continue // held under an older policy
      const id = keccak256(receipt)
      if (store.payments[id]) continue
      store.payments[id] = {
        id, receipt,
        orderId: orderIdOf(d.recipient),
        payer: d.originator,
        recipient: d.recipient,
        token: d.token,
        wrongToken: d.token.toLowerCase() !== PATHUSD.toLowerCase(),
        amount: l.args.amount.toString(),
        heldAt: Number(d.blockedAt),
        windowEndsAt: Number(d.blockedAt + window),
        txHash: l.transactionHash,
        status: 'held',
        history: [{ status: 'held', tx: l.transactionHash, at: Number(d.blockedAt) }],
      }
    }
    // Decisions are applied after payments (same range can contain both); logs are ordered by block/index.
    for (const l of decisions) {
      const p = store.payments[l.args.id]
      if (!p) continue
      const status = { Disputed: 'disputed', Released: 'released', Refunded: 'refunded' }[l.eventName]
      if (p.history.some((h) => h.tx === l.transactionHash && h.status === status)) continue
      p.status = status
      p.history.push({ status, tx: l.transactionHash, by: l.args.caller ?? l.args.originator, block: Number(l.blockNumber) })
    }
  }

  async function sync() {
    const head = await pub.getBlockNumber()
    let from = BigInt(store.lastBlock ?? deployment.arbiterBlock)
    while (from <= head) {
      const to = from + MAX_RANGE - 1n < head ? from + MAX_RANGE - 1n : head
      await scanRange(from, to)
      store.lastBlock = (to + 1n).toString()
      from = to + 1n
    }
    store.save?.()
    return head
  }

  return { sync }
}

// Order view = order + its payments, with a single derived status for the UI.
export function orderView(store, order, now = Math.floor(Date.now() / 1000)) {
  const payments = Object.values(store.payments).filter((p) => p.orderId === order.id)
  const main = payments.find((p) => !p.wrongToken)
  let status = 'awaiting_payment'
  if (main) {
    status = main.status
    if (status === 'held' && now >= main.windowEndsAt) status = 'releasable' // window over, anyone can release
  }
  const paid = payments.filter((p) => !p.wrongToken).reduce((a, p) => a + BigInt(p.amount), 0n)
  return {
    ...order,
    status,
    underpaid: main ? paid < BigInt(order.amount) : false,
    payments: payments.map(({ history, ...p }) => ({ ...p, history,
      releasable: p.status === 'held' && now >= p.windowEndsAt })),
  }
}
