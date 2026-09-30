// Fresh local database: moves the current one aside (never deletes it) and starts the indexer from
// the current block (no merchants, no orders). Merchants register again after setup.
// Usage: node scripts/demo-reset.ts   then restart `npm run server`.
import { existsSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { pub } from './lib.ts'
import { emptyDb } from '../server/core.ts'

const db = new URL('../.state/db-v2.json', import.meta.url).pathname
mkdirSync(new URL('../.state/', import.meta.url).pathname, { recursive: true })
if (existsSync(db)) {
  const backup = db.replace(/\.json$/, `.${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  renameSync(db, backup)
  console.log('previous DB moved to', backup)
}
const head = await pub.getBlockNumber()
writeFileSync(db, JSON.stringify(emptyDb(head.toString()), null, 2))
console.log(`fresh demo DB at ${db} (indexing from block ${head}, first order #1042)`)
process.exit(0)
