// Browser-side chain access. Buyers act on HeldArbiter directly from their own wallet; Held never signs for them.
// Tempo accepts standard EVM transactions, so any EVM wallet works (verified: eip1559 + legacy transfers are held).
import { createPublicClient, createWalletClient, custom, http, defineChain, erc20Abi } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

export const PATHUSD = '0x20c0000000000000000000000000000000000000'
export const WRONG_TOKEN = '0x20c0000000000000000000000000000000000001'
export const explorer = 'https://explore.testnet.tempo.xyz'
export const chain = defineChain({
  id: 42431,
  name: 'Tempo Moderato',
  nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.moderato.tempo.xyz'] } },
  blockExplorers: { default: { name: 'Tempo Explorer', url: explorer } },
})
export const pub = createPublicClient({ chain, transport: http() })

export const arbiterAbi = [
  { name: 'dispute', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes', name: 'receipt' }], outputs: [] },
  { name: 'release', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes', name: 'receipt' }], outputs: [] },
  { name: 'refund', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes', name: 'receipt' }], outputs: [] },
  ...['NotOurReceipt', 'NotForMerchant', 'AlreadySettled', 'AlreadyDisputed', 'NotOriginator', 'WindowClosed', 'NotAllowed']
    .map((name) => ({ name, type: 'error', inputs: [] })),
]
const errorText = {
  NotOriginator: 'Only the wallet that paid can do this.',
  WindowClosed: 'The protection window has closed.',
  AlreadyDisputed: 'A dispute is already open.',
  AlreadySettled: 'This payment has already been settled.',
  NotAllowed: 'This wallet is not allowed to do that.',
}
export const explain = (e) => {
  const name = e?.cause?.data?.errorName || e?.data?.errorName
  return errorText[name] || name || e?.shortMessage || e?.message || String(e)
}

export const hasInjected = () => typeof window !== 'undefined' && !!window.ethereum

// Tempo Wallet (wallet.tempo.xyz): passkey account via Tempo's official Accounts SDK. Exposed as an EIP-1193
// provider, so the same viem wallet client code signs payments AND arbiter calls (release / dispute / refund).
let tempoProvider
async function tempoWalletProvider() {
  if (!tempoProvider) {
    const { Provider, tempoWallet } = await import('accounts')
    tempoProvider = Provider.create({ adapter: tempoWallet(), testnet: true })
  }
  return tempoProvider
}

// Demo wallet: a throwaway testnet key kept in this browser, so anyone can try Held without an extension.
function demoAccount() {
  let k = localStorage.getItem('held.demoKey')
  if (!k) { k = generatePrivateKey(); localStorage.setItem('held.demoKey', k) }
  return privateKeyToAccount(k)
}

export async function connect(kind) {
  if (kind === 'demo') {
    const account = demoAccount()
    return { kind, address: account.address, client: createWalletClient({ account, chain, transport: http() }) }
  }
  if (kind === 'tempo') {
    const provider = await tempoWalletProvider()
    const [address] = await provider.request({ method: 'eth_requestAccounts' })
    return { kind, address, client: createWalletClient({ account: address, chain, transport: custom(provider) }) }
  }
  const eth = window.ethereum
  const [address] = await eth.request({ method: 'eth_requestAccounts' })
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0xa5bf' }] })
  } catch {
    await eth.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0xa5bf', chainName: 'Tempo Moderato',
      nativeCurrency: { name: 'USD', symbol: 'USD', decimals: 18 }, rpcUrls: ['https://rpc.moderato.tempo.xyz'], blockExplorerUrls: [explorer] }] })
  }
  return { kind, address, client: createWalletClient({ account: address, chain, transport: custom(eth) }) }
}

export const tokenBalance = (address, token = PATHUSD) =>
  pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [address] })

export async function transfer(wallet, to, amount, token = PATHUSD) {
  const hash = await wallet.client.writeContract({ address: token, abi: erc20Abi, functionName: 'transfer', args: [to, BigInt(amount)] })
  return pub.waitForTransactionReceipt({ hash })
}

export async function arbiter(wallet, address, functionName, receipt) {
  // Simulate first so a rule violation shows a clear reason instead of a failed transaction.
  await pub.simulateContract({ account: wallet.address, address, abi: arbiterAbi, functionName, args: [receipt] })
  const hash = await wallet.client.writeContract({ address, abi: arbiterAbi, functionName, args: [receipt], gas: 2_000_000n })
  const rc = await pub.waitForTransactionReceipt({ hash })
  if (rc.status !== 'success') throw new Error('Transaction reverted')
  return rc
}
