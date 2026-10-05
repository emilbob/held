// Held's data shapes, shared by the server (server/core.ts, server/indexer.ts) and the frontend (web/src).
import type { Address, Hex } from 'viem'

export type PaymentStatus = 'held' | 'disputed' | 'released' | 'refunded'
export type OrderStatus = 'awaiting_payment' | 'releasable' | PaymentStatus

export interface HistoryEntry {
  status: PaymentStatus
  tx: Hex
  at?: number
  by?: Address
  block?: number
}

// A payment as stored by the indexer (one per TransferBlocked receipt to a registered merchant).
export interface StoredPayment {
  id: Hex
  receipt: Hex
  merchant: Address
  userTag: number | null // recipient's virtual-address tag (prefix + order id); null if not a virtual address
  payer: Address
  recipient: Address
  token: Address
  wrongToken: boolean
  amount: string // base units (6 decimals)
  heldAt: number
  windowEndsAt: number
  txHash: Hex
  status: PaymentStatus
  history: HistoryEntry[]
}
export interface Payment extends StoredPayment {
  releasable: boolean
}

// A merchant registered after the server verified their setup on-chain (see server/merchants.ts).
export interface Merchant {
  address: Address // checkout address: receives held payments, signs merchant actions
  name: string
  masterId: Hex // TIP-1022 virtual-address master
  arbiter: Address // the merchant's own HeldArbiter
  resolver: Address // decides this merchant's disputes
  acceptedTokens: Address[] // stablecoins this shop accepts (v2 arbiter: up to 3)
  acceptedToken?: Address // v1 shops (one token); read through acceptedTokensOf()
  window: number // protection window, seconds
  registeredAt: number
}

export interface StoredOrder {
  id: number
  key?: string // the buyer link (#/pay/<key>); orders created before Oct 2026 have none and use their number
  merchant: Address
  item: string
  amount: string // base units (6 decimals)
  address: Address
  createdAt: number
  linkId?: string // created by a buyer opening this checkout link
}

// A reusable checkout link for one product at a fixed price. Each buyer who opens it gets a fresh order.
export interface CheckoutLink {
  id: string
  merchant: Address
  item: string
  amount: string // base units (6 decimals)
  active: boolean
  removed?: boolean // taken off the merchant's dashboard (and off for buyers); kept so its orders still point to it
  createdAt: number
}
export interface CheckoutLinkView extends CheckoutLink { orders: number, paid: number }
// Public view for the buyer (GET /api/links/:id).
export interface PublicLink { id: string, item: string, amount: string, active: boolean, merchantName: string }

// What the API returns: the order, its merchant, its payments and one derived status.
export interface Order extends StoredOrder {
  merchantInfo: Pick<Merchant, 'name' | 'arbiter' | 'resolver' | 'window' | 'acceptedTokens'>
  notes?: Record<string, Note[]> // by payment id; only for the order's merchant and the merchant's resolver
  status: OrderStatus
  underpaid: boolean
  payments: Payment[]
}

export interface Session { address: Address, exp: number }

export interface Db {
  merchants: Record<string, Merchant> // key: lowercase address
  orders: Record<string, StoredOrder>
  payments: Record<string, StoredPayment>
  sessions: Record<string, Session> // key: sha256(session token), hex
  links?: Record<string, CheckoutLink> // absent in databases created before checkout links
  notes?: Record<string, Note[]> // dispute notes by payment id
  lastBlock: string
  nextOrderId: number
  tagPrefix: number // random per database (see orderTag), so databases sharing a merchant never share addresses
}

export interface Token { address: Address, symbol: string }

// Network-wide settings (network.testnet.json / network.mainnet.json, picked by HELD_NETWORK): the same for every merchant.
export interface Network {
  name: 'testnet' | 'mainnet'
  chainId: number
  testnet: boolean
  rpc: string
  explorer: string
  tokens: Token[] // the stablecoins a shop accepts (all of them, in this order; the v2 arbiter holds up to 3)
  testWrongToken?: Address // testnet only: a real token shops don't accept, for trying the wrong-token path
  maxOrder: string // launch cap: the most one order or checkout link may charge, base units (6 decimals)
  defaultResolver: Address // suggested at merchant setup; merchants may choose another
  defaultWindow: number // seconds
  // Held's fee (contract v3), written into every new shop's arbiter and never changeable for that shop: `bps` of each
  // released payment (max `cap` base units per payment, "0" = no cap) goes to `recipient`, from unix time `start` on.
  // Refunds never pay it. Testnet: a placeholder wallet with the fee on from the start, to exercise the split.
  // Mainnet: recipient is address(0) until the real fee wallet is set, so the contract refuses to deploy.
  fee: { recipient: Address, bps: number, start: number, cap: string }
  // Testnet only: a shared, already-set-up shop anyone can try (scripts/sandbox-setup.ts). The keys are PUBLIC test keys.
  sandbox?: { merchant: Address, merchantKey: Hex, resolver: Address, resolverKey: Hex, salt?: Hex, masterId?: Hex, arbiter?: Address }
}
export interface Config extends Network {
  head: string
  indexerError: string | null
  now: number
}

// Sign-in: the wallet signs this exact text; the server accepts it for 5 minutes after `issued`.
export const signInMessage = (address: string, host: string, issued: number) =>
  `Sign in to Held\n\nWallet: ${address}\nSite: ${host}\nIssued: ${new Date(issued * 1000).toISOString()}\n\nThis signature only proves you control this wallet. It does not move funds.`

// Feedback from anyone trying Held (#/feedback). Stored apart from the main Db (it only grows); readable only by
// Held's owner (a session of the network's default resolver wallet). No account; the contact is optional.
export type FeedbackRole = 'buyer' | 'merchant' | 'looking'
// quote: the person allowed quoting this publicly, shown as quoteName (a first name or handle). Off by default.
export interface Feedback { at: number, role: FeedbackRole, text: string, contact?: string, quote?: boolean, quoteName?: string }
export const FEEDBACK_MAX = 1000
export const CONTACT_MAX = 120
export const QUOTE_NAME_MAX = 40

// Dispute notes: what the buyer says went wrong, the merchant's replies, the buyer's follow-ups. Readable by the
// order's buyer page, its merchant and the resolver. A buyer's note is signed by the wallet that paid (this exact
// text), so nobody can speak for the buyer.
export interface Note { by: 'buyer' | 'merchant', text: string, at: number }
export const NOTE_MAX = 500
export const NOTES_PER_SIDE = 5 // per payment, for the buyer and for the merchant
export const noteMessage = (orderId: number, paymentId: string, text: string) =>
  `Held dispute note\n\nOrder: #${orderId}\nPayment: ${paymentId}\n\n${text}\n\nThe merchant and the resolver will read this. It does not move funds.`

// v1 shops stored one token; v2 shops store the list.
export const acceptedTokensOf = (m: Pick<Merchant, 'acceptedTokens' | 'acceptedToken'>): Address[] =>
  m.acceptedTokens?.length ? m.acceptedTokens : m.acceptedToken ? [m.acceptedToken] : []
export const tokenSymbol = (network: Pick<Network, 'tokens'>, address: string) =>
  network.tokens.find((t) => t.address.toLowerCase() === address.toLowerCase())?.symbol ?? 'token'
