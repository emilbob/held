// Vercel serverless entry for every /api/* route (vercel.json rewrites /api/(.*) here).
// Same API core as the local server; state lives in Upstash Redis (Vercel Marketplace). Indexing happens on demand:
// each read syncs new TransferBlocked + arbiter events since the stored block, under a Redis lock.
import { Redis } from '@upstash/redis'
import type { IncomingMessage } from 'node:http'
import type { Abi, Hex } from 'viem'
import { createApi, toJson, type DbAdapter } from '../server/core.ts'
import type { Db, Deployment } from '../shared/api.ts'
import deploymentJson from '../deployment.json' with { type: 'json' }
import abiJson from '../server/arbiter-abi.json' with { type: 'json' }

const deployment = deploymentJson as Deployment
const abi = abiJson as Abi

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
})
const KEY = 'held:db'
const LOCK = 'held:lock'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const db: DbAdapter = {
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
    try { return await fn() } finally {
      if ((await redis.get(LOCK)) === token) await redis.del(LOCK)
    }
  },
  async rateLimit(key, ms) { return (await redis.set(`held:rl:${key}`, 1, { nx: true, px: ms })) === 'OK' },
}

const api = createApi({ deployment, abi, db, keys: {
  merchantKey: process.env.MERCHANT_KEY as Hex | undefined,
  resolverKey: process.env.RESOLVER_KEY as Hex | undefined,
  adminToken: process.env.HELD_ADMIN_TOKEN || 'demo',
} })

// The parts of Vercel's Node request/response helpers this handler uses.
type VercelRequest = IncomingMessage & { body?: unknown }
interface VercelResponse {
  setHeader(name: string, value: string): void
  status(code: number): VercelResponse
  send(body: string): void
  json(body: unknown): void
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = new URL(req.url ?? '/', 'http://x').pathname
  let body: unknown = {}
  if (req.method === 'POST') {
    body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    body ??= {}
  }
  try {
    const r = await api.handle(req.method ?? 'GET', path, req.headers, body as Record<string, unknown>)
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.status(r.status).send(toJson(r.body))
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
}
