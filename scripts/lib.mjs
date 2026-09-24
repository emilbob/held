// Shared helpers for Held scripts (Tempo Moderato testnet).
import { createClient, createPublicClient, http, publicActions, walletActions, formatUnits } from 'viem'
import { tempoModerato } from 'viem/chains'
import { Actions } from 'viem/tempo'
import { privateKeyToAccount } from 'viem/accounts'
import { VirtualAddress } from 'ox/tempo'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'

export const PATHUSD = '0x20c0000000000000000000000000000000000000'
export const WRONG_TOKEN = '0x20c0000000000000000000000000000000000001'
export const chain = tempoModerato.extend({ feeToken: PATHUSD })
export const pub = createPublicClient({ chain, transport: http() })
export const walletFor = (account) =>
  createClient({ account, chain, transport: http() }).extend(publicActions).extend(walletActions)

export const root = new URL('../', import.meta.url)
export const artifact = () => JSON.parse(readFileSync(new URL('out/HeldArbiter.json', root), 'utf8'))

// .state/merchant.json holds testnet-only keys + deployment info (gitignored).
const stateDir = new URL('.state/', root)
const stateFile = new URL('.state/merchant.json', root)
export const loadState = () => (existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {})
export const saveState = (s) => {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(stateFile, JSON.stringify(s, null, 2))
}

export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)
export const bal = async (account, token = PATHUSD) =>
  BigInt((await Actions.token.getBalance(pub, { account, token })).amount)
export const fmt = (x) => formatUnits(x, 6)

// Order id -> 6-byte userTag -> per-order virtual address. No tx, no cost.
export const orderTag = (orderId) => '0x' + BigInt(orderId).toString(16).padStart(12, '0')
export const orderAddress = (masterId, orderId) => VirtualAddress.from({ masterId, userTag: orderTag(orderId) })
export const orderIdOf = (addr) =>
  VirtualAddress.isVirtual(addr) ? Number(BigInt(VirtualAddress.parse(addr).userTag)) : null

export const accountOf = (pk) => privateKeyToAccount(pk)
