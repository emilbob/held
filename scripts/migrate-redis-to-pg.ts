// One-time copy of the live store from Upstash Redis (held:v2:db, testnet) into Postgres (held_testnet).
// Refuses to touch a schema that already has data. Needs KV_REST_API_URL/TOKEN (vercel env pull) and DATABASE_URL.
// Usage: node --env-file=.env.local scripts/migrate-redis-to-pg.ts
import { Redis } from '@upstash/redis'
import { pgAdapter } from '../server/pgdb.ts'
import type { Db } from '../shared/api.ts'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is not set')
const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! })
const src = await redis.get<Db>('held:v2:db')
if (!src) throw new Error('nothing in Redis held:v2:db')
const pg = pgAdapter(url, 'held_testnet')
try {
  await pg.lock(async (io) => {
    if (await io.read()) throw new Error('held_testnet already has data; not overwriting')
    await io.write(src)
  }, { wait: true })
  const back = await pg.read()
  const n = (d: Db | null, k: 'merchants' | 'orders' | 'payments' | 'sessions' | 'links' | 'notes') => Object.keys(d?.[k] ?? {}).length
  for (const k of ['merchants', 'orders', 'payments', 'sessions', 'links', 'notes'] as const)
    console.log(k.padEnd(10), 'redis', String(n(src, k)).padStart(5), ' postgres', String(n(back, k)).padStart(5), n(src, k) === n(back, k) ? 'ok' : 'MISMATCH')
  console.log('lastBlock', src.lastBlock, back?.lastBlock, '| nextOrderId', src.nextOrderId, back?.nextOrderId, '| tagPrefix', src.tagPrefix, back?.tagPrefix)
  // Deep check: every record round-trips exactly (jsonb reorders object keys, so compare with sorted keys).
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v
  const same = (['merchants', 'orders', 'payments', 'sessions', 'links', 'notes'] as const).every((k) =>
    Object.entries(src[k] ?? {}).every(([id, v]) => JSON.stringify(canon(v)) === JSON.stringify(canon((back?.[k] as Record<string, unknown> | undefined)?.[id]))))
  console.log(same ? 'all records identical' : 'RECORDS DIFFER')
} finally { await pg.end() }
