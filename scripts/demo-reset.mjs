// Fresh demo database for recording: moves the current order DB aside (never deletes it) and starts the indexer from
// the current block, so the dashboard opens with zero orders and order numbers start at 1042.
// Usage: node scripts/demo-reset.mjs   then restart `npm run server`.
import { existsSync, renameSync, writeFileSync, mkdirSync } from 'node:fs'
import { pub } from './lib.mjs'

const db = new URL('../.state/db.json', import.meta.url).pathname
mkdirSync(new URL('../.state/', import.meta.url).pathname, { recursive: true })
if (existsSync(db)) {
  const backup = db.replace(/\.json$/, `.${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  renameSync(db, backup)
  console.log('previous DB moved to', backup)
}
const head = await pub.getBlockNumber()
writeFileSync(db, JSON.stringify({ orders: {}, payments: {}, lastBlock: head.toString(), nextOrderId: 1042 }, null, 2))
console.log(`fresh demo DB at ${db} (indexing from block ${head}, first order #1042)`)
process.exit(0)
