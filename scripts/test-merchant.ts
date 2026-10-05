// A reusable testnet merchant for the browser e2e tests. Set up once from its own key (same code as the browser,
// web/src/setup.ts; mining takes minutes the first time), then kept in .state/test-merchant.json (gitignored, testnet
// only). merchantSession() signs it in to a Held server (local or live) and registers it there, so tests can create
// orders the way a real merchant does.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { Actions } from 'viem/tempo'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'
import { pub, walletFor, log, requireState, TOKENS, network } from './lib.ts'
import { runSetup, type SetupState } from '../web/src/setup.ts'
import { signInMessage } from '../shared/api.ts'

const FILE = new URL('../.state/test-merchant.json', import.meta.url)
type Saved = SetupState & { key: Hex }

export async function merchantSession(app: string, name = 'E2E Test Shop'): Promise<string> {
  mkdirSync(new URL('../.state/', import.meta.url), { recursive: true })
  const saved: Saved = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : { key: generatePrivateKey() }
  const save = (s: SetupState) => writeFileSync(FILE, JSON.stringify({ ...saved, ...s }, null, 2))
  save(saved)
  const acct = privateKeyToAccount(saved.key)
  if (!saved.arbiter) {
    log(`test merchant ${acct.address}: first-time setup (mining takes a few minutes)`)
    await Actions.faucet.fundSync(pub, { account: acct.address }) // before the receive policy holds incoming funds
  }
  const r = await runSetup({ wallet: { kind: 'demo', name, address: acct.address, client: walletFor(acct) } as never, pub: pub as never,
    // The testnet test resolver (key in .state), never the real default resolver.
    resolver: requireState().resolver, tokens: TOKENS, window: 300, resolveWindow: 600, fee: network.fee, state: saved, save, onStep: () => {} })

  const host = new URL(app).host, issued = Math.floor(Date.now() / 1000)
  const signature = await acct.signMessage({ message: signInMessage(acct.address, host, issued) })
  const post = async (path: string, body: unknown, token?: string) => {
    const res = await fetch(`${app}/api${path}`, { method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) } })
    const j = await res.json()
    if (!res.ok) throw new Error(`${path}: ${j.error}`)
    return j
  }
  const { token } = await post('/auth', { address: acct.address, issued, signature })
  await post('/merchants', { name, arbiter: r.arbiter, masterId: r.masterId }, token) // re-verified on-chain each time
  return token
}
