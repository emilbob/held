// Testnet sandbox for judges and first-time visitors: one shared shop that's already set up, plus its own resolver,
// so anyone can play merchant, buyer and resolver in a couple of minutes without mining a checkout address.
// The two keys are PUBLIC TESTNET KEYS on purpose: they're written to network.json (`sandbox`) and bundled into the
// testnet site. They hold only free test funds and are never offered when network.testnet is false. Held's server
// still holds no keys; it only refuses to re-register the sandbox address with a different arbiter.
// Usage: node scripts/sandbox-setup.ts [server...]   (default: http://localhost:8787 https://held-lilac.vercel.app)
import { readFileSync, writeFileSync } from 'node:fs'
import { Actions } from 'viem/tempo'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Hex } from 'viem'
import { pub, walletFor, log, PATHUSD } from './lib.ts'
import { runSetup, type SetupState } from '../web/src/setup.ts'
import { signInMessage, type Network } from '../shared/api.ts'

const FILE = new URL('../network.json', import.meta.url)
const net: Network = JSON.parse(readFileSync(FILE, 'utf8'))
if (!net.testnet) throw new Error('The sandbox is testnet only.')
const servers = process.argv.slice(2).length ? process.argv.slice(2) : ['http://localhost:8787', 'https://held-lilac.vercel.app']

const merchantKey = (net.sandbox?.merchantKey ?? generatePrivateKey()) as Hex
const resolverKey = (net.sandbox?.resolverKey ?? generatePrivateKey()) as Hex
const merchant = privateKeyToAccount(merchantKey), resolver = privateKeyToAccount(resolverKey)
const state: SetupState = { salt: net.sandbox?.salt, masterId: net.sandbox?.masterId, arbiter: net.sandbox?.arbiter }
const save = (s: SetupState) => {
  net.sandbox = { merchant: merchant.address, merchantKey, resolver: resolver.address, resolverKey, ...s } as Network['sandbox']
  writeFileSync(FILE, JSON.stringify(net, null, 2) + '\n')
}
save(state)

if (!state.arbiter) {
  log(`sandbox merchant ${merchant.address}: funding, then mining (a few minutes)`)
  await Actions.faucet.fundSync(pub, { account: merchant.address }) // before the receive policy holds incoming funds
  await Actions.faucet.fundSync(pub, { account: resolver.address })
}
const t0 = Date.now()
const r = await runSetup({ wallet: { kind: 'demo', name: 'sandbox', address: merchant.address, client: walletFor(merchant) } as never,
  pub: pub as never, resolver: resolver.address, token: PATHUSD, window: 300, state, save,
  onStep: (s) => log(`  ${s}${s === 'done' ? ` (${Math.round((Date.now() - t0) / 1000)}s)` : ''}`) })
log(`sandbox shop: merchant ${merchant.address}, arbiter ${r.arbiter}, resolver ${resolver.address}`)

for (const app of servers) {
  const issued = Math.floor(Date.now() / 1000)
  const signature = await merchant.signMessage({ message: signInMessage(merchant.address, new URL(app).host, issued) })
  const post = async (path: string, body: unknown, token?: string) => {
    const res = await fetch(`${app}/api${path}`, { method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) } })
    return { ok: res.ok, body: await res.json() }
  }
  const auth = await post('/auth', { address: merchant.address, issued, signature })
  const reg = auth.ok ? await post('/merchants', { name: 'Sandbox Shop', arbiter: r.arbiter, masterId: r.masterId }, auth.body.token) : auth
  log(`registered on ${app}: ${reg.ok ? 'yes' : 'NO: ' + reg.body.error}`)
}
process.exit(0)
