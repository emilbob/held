// Empty the testnet Sandbox Shop: delete its orders (with their payments and dispute notes) and its checkout links.
// Safe by construction:
//   - only rows of the sandbox merchant from network.testnet.json; other shops, merchants, sessions and feedback are
//     never touched
//   - testnet only (schema held_testnet is fixed here; refuses HELD_NETWORK=mainnet)
//   - dry run unless --yes: lists what would go first
//   - one transaction under the app's own advisory lock, so it can't race a live request
// On-chain history is unaffected (payments, releases and refunds stay on Tempo's explorer).
// Usage: npm run sandbox:reset            (dry run: shows what would be deleted)
//        npm run sandbox:reset -- --yes   (deletes)
import { readFileSync, existsSync } from 'node:fs'
import postgres from 'postgres'
import testnet from '../network.testnet.json' with { type: 'json' }

if (process.env.HELD_NETWORK === 'mainnet') throw new Error('sandbox:reset is testnet only.')
const SCHEMA = 'held_testnet'
const sandbox = testnet.sandbox?.merchant?.toLowerCase()
if (!sandbox) throw new Error('network.testnet.json has no sandbox merchant.')
const envFile = new URL('../.env.local', import.meta.url)
const url = process.env.DATABASE_URL ?? (existsSync(envFile) ? readFileSync(envFile, 'utf8').match(/^DATABASE_URL="?([^"\n]+)/m)?.[1] : undefined)
if (!url) throw new Error('DATABASE_URL not set (and not in .env.local).')
const yes = process.argv.includes('--yes')

const sql = postgres(url.replace(/:6543\//, ':5432/'), { max: 1, onnotice: () => {} })
const t = (name: string) => sql(`${SCHEMA}.${name}`)
try {
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${SCHEMA}))`
    const orders = await tx`select id, address, data->>'item' as item from ${t('orders')} where merchant = ${sandbox} order by id`
    const addrs = orders.map((o) => o.address as string)
    const payments = addrs.length ? await tx`select id, recipient, status from ${t('payments')} where recipient in ${tx(addrs)}` : []
    const links = await tx`select id, data->>'item' as item from ${t('links')} where merchant = ${sandbox}`
    const status = (address: string) => payments.filter((p) => p.recipient === address).map((p) => p.status).join(',') || 'unpaid'

    console.log(`Sandbox Shop (${sandbox}) on testnet:`)
    console.log(`  ${orders.length} orders${orders.length ? ': ' + orders.map((o) => `#${o.id} ${o.item} (${status(o.address)})`).join(', ') : ''}`)
    console.log(`  ${payments.length} payment records, ${links.length} checkout links${links.length ? ': ' + links.map((l) => l.item).join(', ') : ''}`)
    if (!orders.length && !links.length) { console.log('Nothing to delete.'); return }
    if (!yes) { console.log('\nDry run: nothing deleted. Run `npm run sandbox:reset -- --yes` to delete these.'); return }

    // Every deleted row is tied to the sandbox merchant: orders and links by merchant, payments by those orders'
    // addresses, notes by those payments.
    const payIds = payments.map((p) => p.id as string)
    const notes = payIds.length ? (await tx`delete from ${t('notes')} where payment_id in ${tx(payIds)}`).count : 0
    const pays = payIds.length ? (await tx`delete from ${t('payments')} where id in ${tx(payIds)}`).count : 0
    const ords = (await tx`delete from ${t('orders')} where merchant = ${sandbox}`).count
    const lnks = (await tx`delete from ${t('links')} where merchant = ${sandbox}`).count
    if (ords !== orders.length || pays !== payments.length || lnks !== links.length) throw new Error('row counts changed mid-reset; rolled back, nothing deleted')
    console.log(`\nDeleted ${ords} orders, ${pays} payment records, ${notes} note threads, ${lnks} checkout links. Other shops untouched.`)
  })
} finally {
  await sql.end()
}
