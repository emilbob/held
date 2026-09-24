// Tiny JSON-file store. Good enough for a single-merchant demo; swap for a DB later.
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'

export function openStore(path) {
  const data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}
  const store = {
    orders: data.orders ?? {},
    payments: data.payments ?? {},
    lastBlock: data.lastBlock,
    nextOrderId: data.nextOrderId ?? Number(process.env.HELD_ORDER_START || 1042),
    save() {
      mkdirSync(dirname(path), { recursive: true })
      const tmp = path + '.tmp'
      writeFileSync(tmp, JSON.stringify({ orders: store.orders, payments: store.payments, lastBlock: store.lastBlock, nextOrderId: store.nextOrderId }, null, 2))
      renameSync(tmp, path)
    },
  }
  return store
}
