// Sign-in signatures are single use (RealSpap's F8): runs the API core in memory, no network writes.
// Usage: node scripts/signin-check.ts
import { createApi, type DbAdapter } from '../server/core.ts'
import { network } from './lib.ts'
import { signInMessage, type Db } from '../shared/api.ts'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
let mem: Db = { merchants: {}, orders: {}, payments: {}, sessions: {}, links: {}, lastBlock: '1', nextOrderId: 1, tagPrefix: 1 }
const seen = new Map<string, number>()
const db: DbAdapter = { read: async () => mem, write: async (d) => { mem = d }, lock: async (fn) => fn({ read: async () => mem, write: async (d) => { mem = d } }),
  rateLimit: async (k, ms) => { if (Date.now() - (seen.get(k) ?? -1e15) < ms) return false; seen.set(k, Date.now()); return true }, addFeedback: async () => {}, listFeedback: async () => [] }
const api = createApi({ network, db })
const a = privateKeyToAccount(generatePrivateKey()), host = 'getheld.xyz', issued = Math.floor(Date.now() / 1000)
const signature = await a.signMessage({ message: signInMessage(a.address, host, issued) })
const call = (sig: string) => api.handle('POST', '/api/auth', { host }, { address: a.address, issued, signature: sig }) as Promise<any>
const r1 = await call(signature), r2 = await call(signature)
const s2 = await a.signMessage({ message: signInMessage(a.address, host, issued + 1) })
const r3 = await call(signature.toUpperCase().replace('0X', '0x'))
const r4 = await api.handle('POST', '/api/auth', { host }, { address: a.address, issued: issued + 1, signature: s2 }) as any
console.log(r1.status === 200 ? 'PASS' : 'FAIL', 'first use of a signature signs in', r1.status)
console.log(r2.status === 401 && /already used/.test(r2.body.error) ? 'PASS' : 'FAIL', 'same signature again is refused', r2.status, r2.body.error)
console.log(r3.status === 401 ? 'PASS' : 'FAIL', 'case-changed copy is refused too', r3.status)
console.log(r4.status === 200 ? 'PASS' : 'FAIL', 'a fresh signature still works', r4.status)
// The sandbox merchant's key is public and signs deterministically: two visitors in the same second send the same signature.
const sb = privateKeyToAccount(network.sandbox!.merchantKey)
const sbSig = await sb.signMessage({ message: signInMessage(sb.address, host, issued) })
const sb1 = await api.handle('POST', '/api/auth', { host }, { address: sb.address, issued, signature: sbSig }) as any
const sb2 = await api.handle('POST', '/api/auth', { host }, { address: sb.address, issued, signature: sbSig }) as any
console.log(sb1.status === 200 && sb2.status === 200 ? 'PASS' : 'FAIL', 'sandbox wallet (public key): same-second sign-ins both work', sb1.status, sb2.status)
