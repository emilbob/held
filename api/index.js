// Vercel serverless entry for every /api/* route (vercel.json rewrites /api/(.*) here).
// Same API core as the local server; state lives in Upstash Redis (Vercel Marketplace). Indexing happens on demand:
// each read syncs new TransferBlocked + arbiter events since the stored block, under a Redis lock.
import { Redis } from '@upstash/redis'
import { createApi, toJson } from '../server/core.mjs'
import deployment from '../deployment.json' with { type: 'json' }
import abi from '../server/arbiter-abi.json' with { type: 'json' }

const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
})
const KEY = 'held:db'
const LOCK = 'held:lock'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const db = {
  async read() { return (await redis.get(KEY)) ?? null }, // @upstash/redis JSON-decodes automatically
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
  merchantKey: process.env.MERCHANT_KEY,
  resolverKey: process.env.RESOLVER_KEY,
  adminToken: process.env.HELD_ADMIN_TOKEN || 'demo',
} })

export default async function handler(req, res) {
  const path = new URL(req.url, 'http://x').pathname
  let body = {}
  if (req.method === 'POST') {
    body = req.body
    if (typeof body === 'string') { try { body = JSON.parse(body) } catch { body = {} } }
    body ??= {}
  }
  try {
    const r = await api.handle(req.method, path, req.headers, body)
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.status(r.status).send(toJson(r.body))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
