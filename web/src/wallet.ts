// Browser-side chain access. Buyers act on HeldArbiter directly from their own wallet; Held never signs for them.
// Tempo accepts standard EVM transactions, so any EVM wallet works (verified: eip1559 + legacy transfers are held).
import {
  createPublicClient, createWalletClient, custom, http, defineChain, erc20Abi,
  type Address, type Hex, type EIP1193Provider, type WalletClient, type Account, type Chain, type Transport,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

declare global {
  interface Window { ethereum?: EIP1193Provider }
}

export const PATHUSD: Address = '0x20c0000000000000000000000000000000000000'
export const WRONG_TOKEN: Address = '0x20c0000000000000000000000000000000000001'
export const explorer = 'https://explore.testnet.tempo.xyz'
export const chain = defineChain({
  id: 42431,
  name: 'Tempo Moderato',
  nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.moderato.tempo.xyz'] } },
  blockExplorers: { default: { name: 'Tempo Explorer', url: explorer } },
})
// Tempo's public testnet RPC rate-limits in bursts; back off for longer than viem's default before giving up.
const rpc = () => http(undefined, { retryCount: 5, retryDelay: 300 })
export const pub = createPublicClient({ chain, transport: rpc() })

const receiptFn = (name: 'dispute' | 'release' | 'refund') =>
  ({ name, type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes', name: 'receipt' }], outputs: [] }) as const
const customError = <const N extends string>(name: N) => ({ name, type: 'error', inputs: [] }) as const
export const arbiterAbi = [
  receiptFn('dispute'), receiptFn('release'), receiptFn('refund'),
  customError('NotOurReceipt'), customError('NotForMerchant'), customError('AlreadySettled'), customError('AlreadyDisputed'),
  customError('NotOriginator'), customError('WindowClosed'), customError('NotAllowed'),
] as const
export type ArbiterFn = 'dispute' | 'release' | 'refund'

const errorText: Record<string, string> = {
  NotOriginator: 'Only the wallet that paid can do this.',
  WindowClosed: 'The protection window has closed.',
  AlreadyDisputed: 'A dispute is already open.',
  AlreadySettled: 'This payment has already been settled.',
  NotAllowed: 'This wallet is not allowed to do that.',
}
// viem errors nest the decoded revert under cause.data; anything else falls back to its message.
type MaybeViemError = { cause?: { data?: { errorName?: string } }, data?: { errorName?: string }, shortMessage?: string, message?: string }
export const explain = (err: unknown): string => {
  const e = (err ?? {}) as MaybeViemError
  const name = e.cause?.data?.errorName || e.data?.errorName
  if (!name && /rate limit|exceeds defined limit|too many requests/i.test(`${e.shortMessage} ${e.message}`))
    return "Tempo's testnet is busy right now (rate limited). Nothing was sent. Wait a few seconds and try again."
  return (name && errorText[name]) || name || e.shortMessage || e.message || String(err)
}

// EIP-6963: each installed wallet extension announces itself, so buyers can pick theirs by name instead of getting
// whichever one claimed window.ethereum.
export interface InjectedWallet { name: string, icon?: string, rdns: string, provider: EIP1193Provider }
type Announce = Event & { detail: { info: { name: string, icon: string, rdns: string, uuid: string }, provider: EIP1193Provider } }
// Wallets may announce late (an extension that finishes loading after the page), so keep listening until
// unsubscribed. Returns the unsubscribe function.
export function watchWallets(onChange: (wallets: InjectedWallet[]) => void): () => void {
  const found = new Map<string, InjectedWallet>()
  const emit = () => onChange([...found.values()])
  const onAnnounce = (e: Event) => {
    const { info, provider } = (e as Announce).detail
    found.delete('injected') // a real announcement replaces the generic fallback
    found.set(info.rdns || info.uuid, { name: info.name, icon: info.icon, rdns: info.rdns, provider })
    emit()
  }
  window.addEventListener('eip6963:announceProvider', onAnnounce)
  window.dispatchEvent(new Event('eip6963:requestProvider'))
  // Older extensions only set window.ethereum and never announce.
  const fallback = setTimeout(() => {
    if (!found.size && window.ethereum) { found.set('injected', { name: 'Browser wallet', rdns: 'injected', provider: window.ethereum }); emit() }
  }, 600)
  return () => { clearTimeout(fallback); window.removeEventListener('eip6963:announceProvider', onAnnounce) }
}

export type WalletKind = 'demo' | 'tempo' | 'injected'
export interface Wallet {
  kind: WalletKind
  name: string // shown next to the address
  address: Address
  client: WalletClient<Transport, Chain, Account>
}

// Tempo Wallet (wallet.tempo.xyz): passkey account via Tempo's official Accounts SDK. Exposed as an EIP-1193
// provider, so the same viem wallet client code signs payments AND arbiter calls (release / dispute / refund).
let tempoProvider: EIP1193Provider | undefined
async function tempoWalletProvider(): Promise<EIP1193Provider> {
  if (!tempoProvider) {
    const { Provider, tempoWallet } = await import('accounts')
    tempoProvider = Provider.create({ adapter: tempoWallet(), testnet: true }) as unknown as EIP1193Provider
  }
  return tempoProvider
}

// Demo wallet: a throwaway testnet key kept in this browser, so anyone can try Held without an extension.
// One test wallet per role, so a merchant's checkout address (which holds every incoming payment) is never also the
// buyer's wallet. Testnet only.
export type Role = 'buyer' | 'merchant' | 'resolver'
const demoKeyName = (role: Role) => (role === 'buyer' ? 'held.demoKey' : `held.demoKey.${role}`)
function demoAccount(role: Role) {
  let k = localStorage.getItem(demoKeyName(role)) as Hex | null
  if (!k) { k = generatePrivateKey(); localStorage.setItem(demoKeyName(role), k) }
  return privateKeyToAccount(k)
}

export async function connect(kind: WalletKind, injected?: InjectedWallet, role: Role = 'buyer'): Promise<Wallet> {
  if (kind === 'demo') {
    const account = demoAccount(role)
    return { kind, name: 'test wallet in this browser', address: account.address, client: createWalletClient({ account, chain, transport: rpc() }) }
  }
  if (kind === 'tempo') {
    const provider = await tempoWalletProvider()
    const [address] = await provider.request({ method: 'eth_requestAccounts' })
    return { kind, name: 'Tempo Wallet', address, client: createWalletClient({ account: address, chain, transport: custom(provider) }) }
  }
  const eth = injected?.provider ?? window.ethereum
  if (!eth) throw new Error('No browser wallet found.')
  const [address] = await eth.request({ method: 'eth_requestAccounts' })
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa5bf' }] })
  } catch {
    await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0xa5bf', chainName: 'Tempo Moderato',
      nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 }, rpcUrls: ['https://rpc.moderato.tempo.xyz'], blockExplorerUrls: [explorer] }] })
  }
  return { kind, name: injected?.name ?? 'Browser wallet', address, client: createWalletClient({ account: address, chain, transport: custom(eth) }) }
}

export const tokenBalance = (address: Address, token: Address = PATHUSD) =>
  pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address] })

export async function transfer(wallet: Wallet, to: Address, amount: string | bigint, token: Address = PATHUSD) {
  const hash = await wallet.client.writeContract({ address: token, abi: erc20Abi, functionName: 'transfer', args: [to, BigInt(amount)] })
  return pub.waitForTransactionReceipt({ hash })
}

export async function arbiter(wallet: Wallet, address: Address, functionName: ArbiterFn, receipt: Hex) {
  // Simulate first so a rule violation shows a clear reason instead of a failed transaction.
  // Tempo's RPC occasionally returns OpcodeNotFound for eth_call (node-level, not a contract revert);
  // retry once, and if it's still a simulation error (not a clean revert), send the tx directly.
  try {
    await pub.simulateContract({ account: wallet.address, address, abi: arbiterAbi, functionName, args: [receipt] })
  } catch (e) {
    const msg = (e as MaybeViemError)?.shortMessage || (e as MaybeViemError)?.message || ''
    if (msg.includes('OpcodeNotFound') || msg.includes('Transaction creation failed')) {
      console.warn('  [arbiter] simulate inconclusive (RPC), sending tx directly')
    } else {
      throw e
    }
  }
  const hash = await wallet.client.writeContract({ address, abi: arbiterAbi, functionName, args: [receipt], gas: 2_000_000n })
  const rc = await pub.waitForTransactionReceipt({ hash })
  if (rc.status !== 'success') throw new Error('Transaction reverted')
  return rc
}

// Sign-in: the wallet signs a plain message (no transaction, no funds).
export const signMessage = (wallet: Wallet, message: string) => wallet.client.signMessage({ message })
