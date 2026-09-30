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
  acceptedToken: Address
  window: number // protection window, seconds
  registeredAt: number
}

export interface StoredOrder {
  id: number
  merchant: Address
  item: string
  amount: string // base units (6 decimals)
  address: Address
  createdAt: number
}
// What the API returns: the order, its merchant, its payments and one derived status.
export interface Order extends StoredOrder {
  merchantInfo: Pick<Merchant, 'name' | 'arbiter' | 'resolver' | 'window'>
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
  lastBlock: string
  nextOrderId: number
  tagPrefix: number // random per database (see orderTag), so databases sharing a merchant never share addresses
}

// Network-wide settings (network.json): the same for every merchant.
export interface Network {
  chainId: number
  testnet: boolean
  acceptedToken: Address
  defaultResolver: Address // suggested at merchant setup; merchants may choose another
  defaultWindow: number // seconds
}
export interface Config extends Network {
  head: string
  indexerError: string | null
  now: number
}

// Sign-in: the wallet signs this exact text; the server accepts it for 5 minutes after `issued`.
export const signInMessage = (address: string, host: string, issued: number) =>
  `Sign in to Held\n\nMerchant: ${address}\nSite: ${host}\nIssued: ${new Date(issued * 1000).toISOString()}\n\nThis signature only proves you control this wallet. It does not move funds.`
