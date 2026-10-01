// Vercel serverless entry for every /api/* route (vercel.json rewrites /api/(.*) here).
// Same API core as the local server; state lives in Postgres (Supabase, DATABASE_URL) or, until that's set, Upstash Redis. Indexing happens on demand:
// each read syncs new TransferBlocked + arbiter events since the stored block, under a Redis lock.
import { Redis } from '@upstash/redis'
import type { IncomingMessage } from 'node:http'
import { createApi, toJson, type DbAdapter } from '../server/core.ts'
import type { Db } from '../shared/api.ts'
import { network } from '../scripts/lib.ts'
import { pgAdapter } from '../server/pgdb.ts'

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
})
// v2: the multi-merchant store; the demo-era 'held:db' is left untouched.
// Each network keeps its own store (testnet keeps its existing key).
const KEY = network.testnet ? 'held:v2:db' : 'held:mainnet:db'
const LOCK = network.testnet ? 'held:v2:lock' : 'held:mainnet:lock'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const redisDb: DbAdapter = {
  async read() { return (await redis.get<Db>(KEY)) ?? null }, // @upstash/redis JSON-decodes automatically
  async write(d) { await redis.set(KEY, d) },
  async lock(fn, { wait }) {
    const token = Math.random().toString(36).slice(2)
    for (let i = 0; ; i++) {
      if (await redis.set(LOCK, token, { nx: true, px: 15_000 })) break
      if (!wait) return undefined // someone else is syncing; readers use what they write
      if (i > 60) throw new Error('store busy, try again')
      await sleep(150)
    }
    try { return await fn(redisDb) } finally {
      if ((await redis.get(LOCK)) === token) await redis.del(LOCK)
    }
  },
  async rateLimit(key, ms) { return (await redis.set(`held:rl:${key}`, 1, { nx: true, px: ms })) === 'OK' },
}

// Postgres when configured (transactions + advisory locks); Redis is the fallback during the switch.
const db: DbAdapter = process.env.DATABASE_URL ? pgAdapter(process.env.DATABASE_URL, `held_${network.name}`) : redisDb
const api = createApi({ network, db })

// The parts of Vercel's Node request/response helpers this handler uses.
type VercelRequest = IncomingMessage & { body?: unknown }
interface VercelResponse {
  setHeader(name: string, value: string): void
  status(code: number): VercelResponse
  send(body: string): void
  json(body: unknown): void
}

// Daily job (vercel.json cron, free on Hobby): one database read keeps Supabase's free project from pausing after
// 7 idle days, and that same snapshot is saved to Upstash Redis (another provider), keeping the last 7 days.
// Vercel calls it with "Authorization: Bearer $CRON_SECRET"; nobody else can trigger it.
const BACKUP_DAYS = 7
async function daily(): Promise<{ status: number, body: unknown }> {
  const snap = await db.read()
  if (!snap) return { status: 200, body: { ok: true, backup: 'nothing to back up yet' } }
  const day = new Date().toISOString().slice(0, 10)
  const key = `held:backup:${network.name}:${day}`
  await redis.set(key, snap, { ex: (BACKUP_DAYS + 1) * 86400 })
  return { status: 200, body: { ok: true, backup: key, orders: Object.keys(snap.orders).length, payments: Object.keys(snap.payments).length } }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = new URL(req.url ?? '/', 'http://x'), path = url.pathname
  if (path === '/api/cron/daily') {
    const secret = process.env.CRON_SECRET
    if (!secret || req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: 'unauthorized' }); return }
    try { const r = await daily(); res.status(r.status).json(r.body) } catch (e) { res.status(500).json({ error: (e as Error).message }) }
    return
  }
  let body: unknown = {}
  if (req.method === 'POST') {
    body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    body ??= {}
  }
  try {
    const r = await api.handle(req.method ?? 'GET', path, req.headers, body as Record<string, unknown>, url.searchParams)
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.status(r.status).send(toJson(r.body))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
}
