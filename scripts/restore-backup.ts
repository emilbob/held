// Restore a daily backup (Upstash Redis held:backup:<network>:<YYYY-MM-DD>) into an EMPTY Postgres schema.
// Usage: node --env-file=.env.local scripts/restore-backup.ts            (lists backups)
//        node --env-file=.env.local scripts/restore-backup.ts 2026-10-02 (restores that day into held_<network>)
import { Redis } from '@upstash/redis'
import { pgAdapter } from '../server/pgdb.ts'
import { network } from './lib.ts'
import type { Db } from '../shared/api.ts'

const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! })
const day = process.argv[2]
if (!day) {
  const keys = (await redis.keys(`held:backup:${network.name}:*`)).sort()
  console.log(keys.length ? keys.join('\n') : 'no backups yet')
  process.exit(0)
}
const snap = await redis.get<Db>(`held:backup:${network.name}:${day}`)
if (!snap) throw new Error(`no backup for ${day}`)
const pg = pgAdapter(process.env.DATABASE_URL!, `held_${network.name}`)
try {
  await pg.lock(async (io) => {
    if (await io.read()) throw new Error(`held_${network.name} is not empty: clear it first (on purpose, by hand)`)
    await io.write(snap)
  }, { wait: true })
  console.log(`restored ${day}: ${Object.keys(snap.orders).length} orders, ${Object.keys(snap.payments).length} payments`)
} finally { await pg.end() }
