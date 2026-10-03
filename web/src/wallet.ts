// Browser-side chain access. Buyers act on HeldArbiter directly from their own wallet; Held never signs for them.
// Tempo accepts standard EVM transactions, so any EVM wallet works (verified: eip1559 + legacy transfers are held).
import {
  createPublicClient, createWalletClient, custom, http, defineChain, erc20Abi,
  type Address, type Hex, type EIP1193Provider, type WalletClient, type Account, type Chain, type Transport,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { tempo, tempoModerato } from 'viem/chains'
import { pickNetwork } from '../../shared/network.ts'
import { tokenSymbol } from '../../shared/api.ts'

declare global {
  interface Window { ethereum?: EIP1193Provider }
}

// The network is fixed at build time (HELD_NETWORK=testnet|mainnet, see vite.config.ts); the API serves the same one.
declare const __HELD_NETWORK__: string
export const NET = pickNetwork(__HELD_NETWORK__)
export const PATHUSD: Address = '0x20c0000000000000000000000000000000000000'
export const WRONG_TOKEN: Address | undefined = NET.testWrongToken
export const explorer = NET.explorer
// Plain EVM chain for browser wallets (MetaMask etc. send standard transactions).
export const chain = defineChain({
  id: NET.chainId,
  name: NET.testnet ? 'Tempo Moderato' : 'Tempo',
  nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 },
  rpcUrls: { default: { http: [NET.rpc] } },
  blockExplorers: { default: { name: 'Tempo Explorer', url: explorer } },
})
// viem's Tempo chain for keys Held's page holds and for Tempo Wallet: transactions can name their fee token.
const tempoChain = NET.testnet ? tempoModerato : tempo
// Tempo's public RPC rate-limits in bursts; back off for longer than viem's default before giving up.
const rpc = () => http(NET.rpc, { retryCount: 5, retryDelay: 300 })
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
  // EIP-1193 4900: the wallet no longer has this account connected (e.g. after logging out or switching accounts).
  if (!name && /disconnected from all chains|No accounts connected|No active account/i.test(`${e.shortMessage} ${e.message}`))
    return 'Your wallet disconnected (for example after switching accounts). Click "Change wallet" and connect it again.'
  if (!name && /rate limit|exceeds defined limit|too many requests/i.test(`${e.shortMessage} ${e.message}`))
    return `Tempo's ${NET.testnet ? 'testnet' : 'network'} is busy right now (rate limited). Nothing was sent. Wait a few seconds and try again.`
  // TIP-20 InsufficientBalance(uint256,uint256,address): viem may only show the raw selector for token reverts.
  if (name === 'InsufficientBalance' || /0x832f98b5/.test(`${e.shortMessage} ${e.message}`))
    return "This wallet doesn't have enough of that stablecoin yet. Nothing was sent. Wait for the balance to update, or choose another stablecoin."
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

export type WalletKind = 'demo' | 'tempo' | 'injected' | 'sandbox'
export interface Wallet {
  kind: WalletKind
  name: string // shown next to the address
  address: Address
  client: WalletClient<Transport, Chain, Account>
  provider?: EIP1193Provider // external wallets: watched for disconnects and account switches
}

// Tempo Wallet (wallet.tempo.xyz): passkey account via Tempo's official Accounts SDK. Exposed as an EIP-1193
// provider, so the same viem wallet client code signs payments AND arbiter calls (release / dispute / refund).
let tempoProvider: EIP1193Provider | undefined
async function tempoWalletProvider(): Promise<EIP1193Provider> {
  if (!tempoProvider) {
    const { Provider, tempoWallet } = await import('accounts')
    tempoProvider = Provider.create({ adapter: tempoWallet(), testnet: NET.testnet }) as unknown as EIP1193Provider
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

export async function connect(kind: WalletKind, injected?: InjectedWallet, role: Role = 'buyer', sandboxKey?: Hex): Promise<Wallet> {
  // Testnet sandbox: a shared, PUBLIC test key for the sandbox shop's merchant or resolver.
  if (kind === 'sandbox') {
    if (!sandboxKey) throw new Error('The sandbox is not available here.')
    const account = privateKeyToAccount(sandboxKey)
    return { kind, name: `sandbox ${role}, shared test wallet`, address: account.address, client: createWalletClient({ account, chain: tempoChain, transport: rpc() }) as Wallet['client'] }
  }
  if (kind === 'demo') {
    const account = demoAccount(role)
    return { kind, name: 'test wallet in this browser', address: account.address, client: createWalletClient({ account, chain: tempoChain, transport: rpc() }) as Wallet['client'] }
  }
  if (kind === 'tempo') {
    const provider = await tempoWalletProvider()
    // The SDK remembers one connected account per site, shared by every tab and role, and eth_requestAccounts
    // returns it without asking. Forget it first, so pressing "Tempo Wallet" always lets you pick the account (a
    // resolver tab must not silently become the buyer's account).
    await provider.request({ method: 'wallet_disconnect' } as never).catch(() => {})
    const [address] = await provider.request({ method: 'eth_requestAccounts' })
    return { kind, name: 'Tempo Wallet', address, provider, client: createWalletClient({ account: address, chain: tempoChain, transport: custom(provider) }) as Wallet['client'] }
  }
  const eth = injected?.provider ?? window.ethereum
  if (!eth) throw new Error('No browser wallet found.')
  const [address] = await eth.request({ method: 'eth_requestAccounts' })
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${NET.chainId.toString(16)}` }] })
  } catch {
    await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: `0x${NET.chainId.toString(16)}`, chainName: chain.name,
      nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 }, rpcUrls: [NET.rpc], blockExplorerUrls: [explorer] }] })
  }
  return { kind, name: injected?.name ?? 'Browser wallet', address, provider: eth, client: createWalletClient({ account: address, chain, transport: custom(eth) }) }
}

// Browser wallets (MetaMask) don't list Tempo's stablecoins, and may suggest the MAINNET pathUSD (balance 0) on testnet.
// Switch to this network first, then ask the wallet to show each token, so the merchant sees the money they hold.
export async function showTokensInWallet(wallet: Wallet, tokens: Address[]) {
  const eth = wallet.provider
  if (wallet.kind !== 'injected' || !eth) return
  await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${NET.chainId.toString(16)}` }] })
  for (const address of tokens) {
    const symbol = tokenSymbol(NET, address)
    await eth.request({ method: 'wallet_watchAsset', params: { type: 'ERC20', options: { address, symbol, decimals: 6 } } } as never)
  }
}

export const tokenBalance = (address: Address, token: Address = PATHUSD) =>
  pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address] })
export const tokenBalances = (address: Address, tokens: Address[]) => Promise.all(tokens.map((t) => tokenBalance(address, t)))

// Fees on Tempo are paid in a stablecoin. A token transfer pays in the token sent; any other call (our arbiter)
// defaults to pathUSD, which a buyer or merchant holding only USDC.e or USDT0 may not have. So wallets that can
// (Tempo Wallet, keys held by this page) name the fee token: the accepted stablecoin this wallet holds most of.
// Browser wallets send standard transactions without a fee token, so they need a little pathUSD for those calls.
const FEE_RESERVE = 50_000n // $0.05 is plenty for one transaction
async function feeTokenFor(wallet: Wallet, preferred: Address[]): Promise<Address | undefined> {
  const tokens = [...new Set([...preferred, PATHUSD].map((t) => t.toLowerCase() as Address))]
  const bals = await tokenBalances(wallet.address, tokens)
  if (wallet.kind === 'injected') {
    if (bals[tokens.indexOf(PATHUSD.toLowerCase() as Address)] < FEE_RESERVE)
      throw new Error(`This step's network fee is paid in pathUSD, and ${wallet.name} can't choose another stablecoin. Add a little pathUSD to this wallet, or use Tempo Wallet.`)
    return undefined
  }
  let best = -1
  bals.forEach((b, i) => { if (b >= FEE_RESERVE && (best < 0 || b > bals[best])) best = i })
  return best >= 0 ? tokens[best] : undefined
}
const feeOpt = (wallet: Wallet, token: Address | undefined) => (wallet.kind === 'injected' || !token ? {} : { feeToken: token })

export async function transfer(wallet: Wallet, to: Address, amount: string | bigint, token: Address = PATHUSD) {
  // A TIP-20 transfer pays its fee in the token sent.
  const hash = await wallet.client.writeContract({ address: token, abi: erc20Abi, functionName: 'transfer', args: [to, BigInt(amount)], ...feeOpt(wallet, token) } as never)
  return pub.waitForTransactionReceipt({ hash })
}

export async function arbiter(wallet: Wallet, address: Address, functionName: ArbiterFn, receipt: Hex, feeTokens: Address[] = []) {
  const feeToken = await feeTokenFor(wallet, feeTokens)
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
  const hash = await wallet.client.writeContract({ address, abi: arbiterAbi, functionName, args: [receipt], gas: 2_000_000n, ...feeOpt(wallet, feeToken) } as never)
  const rc = await pub.waitForTransactionReceipt({ hash })
  if (rc.status !== 'success') throw new Error('Transaction reverted')
  return rc
}

// Sign-in: the wallet signs a plain message (no transaction, no funds).
export const signMessage = (wallet: Wallet, message: string) => wallet.client.signMessage({ message })
