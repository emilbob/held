// Shared helpers for Held scripts (Tempo Moderato testnet).
import { createClient, createPublicClient, http, publicActions, walletActions, formatUnits, type Account, type Address, type Hex } from 'viem'
import { tempoModerato } from 'viem/chains'
import { Actions } from 'viem/tempo'
import { privateKeyToAccount } from 'viem/accounts'
import { VirtualAddress } from 'ox/tempo'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

export const PATHUSD: Address = '0x20c0000000000000000000000000000000000000'
export const WRONG_TOKEN: Address = '0x20c0000000000000000000000000000000000001'
export const chain = tempoModerato.extend({ feeToken: PATHUSD })
export const pub = createPublicClient({ chain, transport: http() })
export const walletFor = (account: Account) =>
  createClient({ account, chain, transport: http() }).extend(publicActions).extend(walletActions)

export const root = new URL('../', import.meta.url)
export const artifact = () => JSON.parse(readFileSync(new URL('out/HeldArbiter.json', root), 'utf8'))

// .state/merchant.json holds testnet-only keys + deployment info (gitignored).
const stateDir = new URL('.state/', root)
const stateFile = new URL('.state/merchant.json', root)
export interface MerchantState {
  merchantKey?: Hex, resolverKey?: Hex, merchant?: Address, resolver?: Address,
  salt?: Hex, masterId?: Hex, arbiter?: Address, arbiterBlock?: string, window?: string,
}
export const loadState = (): MerchantState => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {})
// For scripts that need a completed setup: every field present, or a clear error.
export const requireState = (): Required<MerchantState> => {
  const s = loadState()
  if (!s.arbiter || !s.masterId || !s.merchant || !s.resolverKey) throw new Error('run scripts/setup-merchant.ts first')
  return s as Required<MerchantState>
}
export const saveState = (s: MerchantState) => {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(stateFile, JSON.stringify(s, null, 2))
}

export const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)
export const bal = async (account: Address, token: Address = PATHUSD) =>
  BigInt((await Actions.token.getBalance(pub, { account, token })).amount)
export const fmt = (x: bigint) => formatUnits(x, 6)

// Order id -> 6-byte userTag -> per-order virtual address. No tx, no cost.
export const orderTag = (orderId: number | bigint): Hex => `0x${BigInt(orderId).toString(16).padStart(12, '0')}`
export const orderAddress = (masterId: Hex, orderId: number | bigint): Address => VirtualAddress.from({ masterId, userTag: orderTag(orderId) })
export const orderIdOf = (addr: Address): number | null =>
  VirtualAddress.isVirtual(addr) ? Number(BigInt(VirtualAddress.parse(addr).userTag)) : null

export const accountOf = (pk: Hex) => privateKeyToAccount(pk)
