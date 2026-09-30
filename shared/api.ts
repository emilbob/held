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

// A payment as stored by the indexer (one per TransferBlocked receipt).
export interface StoredPayment {
  id: Hex
  receipt: Hex
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

export interface StoredOrder {
  id: number
  item: string
  amount: string // base units (6 decimals)
  address: Address
  createdAt: number
}
// What the API returns: the order plus its payments and one derived status.
export interface Order extends StoredOrder {
  status: OrderStatus
  underpaid: boolean
  payments: Payment[]
}

export interface Db {
  orders: Record<string, StoredOrder>
  payments: Record<string, StoredPayment>
  lastBlock: string
  nextOrderId: number
  tagPrefix?: number // random per database (see orderTag); absent in databases created before Sep 30
}

export interface Deployment {
  chainId: number
  merchant: Address
  resolver: Address
  masterId: Hex
  arbiter: Address
  arbiterBlock: string
  window: string
  acceptedToken: Address
}
export interface Config extends Deployment {
  head: string
  indexerError: string | null
  now: number
}

export type AdminAction = 'refund' | 'release' | 'resolve-release' | 'resolve-refund' | 'try-grab'

export interface AdminResult {
  ok: boolean
  tx?: Hex
  reverted?: boolean
  error?: string
  grabbed?: boolean
  note?: string
}
