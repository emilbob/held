// API shapes served by server/core.mjs (orders come from orderView in server/indexer.mjs).
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

export interface Payment {
  id: Hex
  receipt: Hex
  orderId: number
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
  releasable: boolean
}

export interface Order {
  id: number
  item: string
  amount: string // base units (6 decimals)
  address: Address
  createdAt: number
  status: OrderStatus
  underpaid: boolean
  payments: Payment[]
}

export interface Config {
  chainId: number
  merchant: Address
  resolver: Address
  masterId: Hex
  arbiter: Address
  arbiterBlock: string
  window: string
  acceptedToken: Address
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
}
