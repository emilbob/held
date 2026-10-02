// Postgres storage (Supabase) for the API core. Each network has its own schema (held_testnet / held_mainnet).
// The core works on one in-memory Db per request; this adapter loads it from tables and writes back only the rows
// that changed, one batched statement per table. Every read-modify-write runs inside ONE transaction holding a
// Postgres advisory lock, so concurrent serverless invocations can't lose each other's updates (the lock can't
// expire mid-write, unlike a Redis TTL lock). The locked transaction is passed explicitly (no implicit context):
// whatever runs inside lock() reads and writes through the `io` it's handed.
import postgres from 'postgres'
import type { DbAdapter, DbIO } from './core.ts'
import type { Db } from '../shared/api.ts'

type Sql = postgres.Sql | postgres.TransactionSql
const TABLES = ['merchants', 'orders', 'payments', 'sessions', 'links', 'notes'] as const
type Table = (typeof TABLES)[number]
type Rows = Record<Table, Map<string, string>> // key -> JSON as last read, so only changed rows are written
const KEY: Record<Table, string> = { merchants: 'address', orders: 'id', payments: 'id', sessions: 'hash', links: 'id', notes: 'payment_id' }

export function pgAdapter(url: string, schema: string): DbAdapter & { end(): Promise<void> } {
  if (!/^held_(testnet|mainnet)$/.test(schema)) throw new Error(`bad schema ${schema}`)
  // Supabase's SESSION pooler (Supavisor, port 5432): each client connection gets a dedicated backend. The
  // transaction pooler (port 6543) returned empty results under parallel load and then hung (tested 2026-10-01), so a
  // 6543 URL is switched to 5432 on the same host. Small pool per instance; idle connections close after 20 s.
  const sql = postgres(url.replace(/:6543\//, ':5432/'), { max: 4, idle_timeout: 20, connect_timeout: 15, onnotice: () => {} })
  const t = (name: string) => sql(`${schema}.${name}`) // postgres.js escapes this as "schema"."table"
  const seen: WeakMap<Db, Rows> = new WeakMap()
  let feedbackReady: Promise<unknown> | null = null
  const ensureFeedback = () => (feedbackReady ??= sql`create table if not exists ${t('feedback')} (id bigserial primary key, at bigint not null, data jsonb not null)`
    .catch((e) => { feedbackReady = null; throw e }))
  const snapshot = (d: Db): Rows => Object.fromEntries(TABLES.map((name) =>
    [name, new Map(Object.entries((d[name] ?? {}) as Record<string, unknown>).map(([k, v]) => [k, JSON.stringify(v)]))])) as Rows

  // Pulls every table into the Db shape in ONE statement: a single round trip, and an atomic snapshot (one statement
  // always runs on one backend connection and sees one consistent state). Returns null for a fresh schema.
  async function load(db: Sql): Promise<Db | null> {
    // Built as plain text: the schema name is validated above and nothing here comes from a request.
    const agg = (table: string, key: string, val = 'data') => `(select coalesce(jsonb_object_agg(${key}, ${val}), '{}'::jsonb) from "${schema}"."${table}")`
    const [r] = await db.unsafe(`select ${agg('meta', 'key', 'to_jsonb(value)')} as meta, ${agg('merchants', 'address')} as merchants,
      ${agg('orders', 'id::text')} as orders, ${agg('payments', 'id')} as payments,
      ${agg('sessions', 'hash', "jsonb_build_object('address', address, 'exp', exp)")} as sessions,
      ${agg('links', 'id')} as links, ${agg('notes', 'payment_id')} as notes`)
    const m = r.meta as Record<string, string>
    if (m.lastBlock === undefined) return null
    const d: Db = {
      merchants: r.merchants, orders: r.orders, payments: r.payments, links: r.links, notes: r.notes, sessions: r.sessions,
      lastBlock: m.lastBlock, nextOrderId: Number(m.nextOrderId), tagPrefix: Number(m.tagPrefix),
    }
    seen.set(d, snapshot(d))
    return d
  }

  const row = (name: Table, k: string, v: any): Record<string, unknown> => {
    switch (name) {
      case 'merchants': return { address: k, data: v }
      case 'orders': return { id: Number(k), merchant: v.merchant.toLowerCase(), address: v.address.toLowerCase(), data: v }
      case 'payments': return { id: k, recipient: v.recipient.toLowerCase(), status: v.status, data: v }
      case 'sessions': return { hash: k, address: v.address, exp: v.exp }
      case 'links': return { id: k, merchant: v.merchant.toLowerCase(), data: v }
      case 'notes': return { payment_id: k, data: v }
    }
  }

  async function save(d: Db, db: Sql) {
    const before = seen.get(d), after = snapshot(d)
    // Safety net: the order counter and the indexed block never move backwards, whatever the caller wrote (a reset
    // counter would hand out existing order numbers again). tagPrefix is fixed once set.
    await db`insert into ${t('meta')} ${db([{ key: 'lastBlock', value: d.lastBlock }, { key: 'nextOrderId', value: String(d.nextOrderId) }, { key: 'tagPrefix', value: String(d.tagPrefix) }])}
      on conflict (key) do update set value = case
        when ${t('meta')}.key in ('lastBlock', 'nextOrderId') then greatest(${t('meta')}.value::numeric, excluded.value::numeric)::text
        else ${t('meta')}.value end`
    for (const name of TABLES) {
      const prev = before?.[name] ?? new Map<string, string>(), next = after[name]
      const src = (d[name] ?? {}) as Record<string, unknown>
      const changed = [...next].filter(([k, v]) => prev.get(k) !== v).map(([k]) => row(name, k, src[k]))
      if (changed.length) {
        const cols = Object.keys(changed[0]), key = KEY[name]
        const updates = cols.filter((c) => c !== key).map((c) => `${c} = excluded.${c}`).join(', ')
        // Batched upsert; jsonb columns get JSON values.
        const values = changed.map((r) => Object.fromEntries(Object.entries(r).map(([c, v]) => [c, c === 'data' ? db.json(v as never) : v])))
        await db`insert into ${t(name)} ${db(values as never, ...cols)} on conflict (${db(key)}) do update set ${db.unsafe(updates)}`
      }
      const gone = [...prev.keys()].filter((k) => !next.has(k))
      if (gone.length) await db`delete from ${t(name)} where ${db(KEY[name])}::text in ${db(gone)}`
    }
    seen.set(d, after)
  }

  return {
    read: () => load(sql),
    async write(d) { await sql.begin((tx) => save(d, tx)) },
    // One transaction + a transaction-scoped advisory lock per network, released automatically on commit/rollback.
    async lock(fn, { wait }) {
      return sql.begin(async (tx) => {
        if (wait) await tx`select pg_advisory_xact_lock(hashtext(${schema}))`
        else {
          const [r] = await tx`select pg_try_advisory_xact_lock(hashtext(${schema})) as ok`
          if (!r.ok) return undefined
        }
        const io: DbIO = { read: () => load(tx), write: (d) => save(d, tx) }
        return fn(io)
      }) as never
    },
    async rateLimit(key, ms) {
      const now = Date.now()
      const r = await sql`insert into ${t('ratelimits')} as r (key, until) values (${key}, ${now + ms})
        on conflict (key) do update set until = excluded.until where r.until < ${now} returning key`
      return r.length > 0
    },
    async cleanup() {
      const now = Date.now()
      const s = await sql`delete from ${t('sessions')} where exp < ${Math.floor(now / 1000)}`
      const r = await sql`delete from ${t('ratelimits')} where until < ${now}`
      return { sessions: s.count, ratelimits: r.count }
    },
    // Feedback: its own table, created on first use (so no manual migration), never loaded with the Db.
    async addFeedback(f) {
      await ensureFeedback()
      await sql`insert into ${t('feedback')} (at, data) values (${f.at}, ${sql.json(f as never)})`
    },
    async listFeedback() {
      await ensureFeedback()
      return (await sql`select data from ${t('feedback')} order by id desc limit 500`).map((r) => r.data) as never
    },
    end: () => sql.end({ timeout: 5 }),
  }
}
