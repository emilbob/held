// Concurrency check for the Postgres store: two server processes (like two serverless instances) share one database;
// 30 orders are created at once across both. Every order must be saved, with a unique id and address, and the
// order counter must advance by exactly 30: no lost writes.
// Usage: node --env-file=.env.local scripts/concurrency-check.ts   (needs DATABASE_URL)
import { spawn, type ChildProcess } from 'node:child_process'
import { log } from './lib.ts'
import { merchantSession } from './test-merchant.ts'
import { pgAdapter } from '../server/pgdb.ts'
import { network } from './lib.ts'
import type { Order } from '../shared/api.ts'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
const ports = [8801, 8802]
const procs: ChildProcess[] = ports.map((port) => spawn('node', ['server/server.ts'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] }))
await Promise.all(procs.map((p) => new Promise<void>((ok) => p.stdout!.on('data', (d: Buffer) => d.toString().includes('Held API') && ok()))))
const results: boolean[] = []
const check = (name: string, pass: boolean, detail: unknown = '') => { results.push(pass); log(pass ? 'PASS' : 'FAIL', name, detail) }
const pg = pgAdapter(process.env.DATABASE_URL, `held_${network.name}`)
try {
  const token = await merchantSession(`http://localhost:${ports[0]}`)
  const before = (await pg.read())!.nextOrderId
  const N = 30
  const created = await Promise.all(Array.from({ length: N }, (_, i) =>
    fetch(`http://localhost:${ports[i % 2]}/api/orders`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ item: `Concurrency ${i}`, amount: '1' }) }).then(async (r) => ({ status: r.status, body: (await r.json()) as Order }))))
  check(`all ${N} concurrent creates answered 201`, created.every((c) => c.status === 201), created.map((c) => c.status).filter((s) => s !== 201))
  const ids = created.map((c) => c.body.id), addrs = created.map((c) => c.body.address)
  check('every order got a unique id', new Set(ids).size === N)
  check('every order got a unique address', new Set(addrs).size === N)
  const after = await pg.read()
  check(`order counter advanced by exactly ${N}`, after!.nextOrderId - before === N, `${before} -> ${after!.nextOrderId}`)
  check('every order is saved in the database', ids.every((id) => after!.orders[id]?.item.startsWith('Concurrency')))
  const viaOther = await Promise.all(ids.map((id, i) => fetch(`http://localhost:${ports[(i + 1) % 2]}/api/orders/${id}`).then((r) => r.status)))
  check('each order is readable from the other instance', viaOther.every((s) => s === 200))
} finally {
  procs.forEach((p) => p.kill()); await pg.end()
}
const bad = results.filter((x) => !x).length
log(`${results.length - bad}/${results.length} checks passed`)
process.exit(bad ? 1 : 0)
