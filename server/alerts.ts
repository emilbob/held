// Emails to Held's owner, sent via Resend (RESEND_API_KEY) to ALERT_EMAIL; without both, they're off. Sender: ALERT_FROM
// (a verified Resend domain), else (or if refused) Resend's test sender. At most once: sent after the sync is saved, and
// a failed send is only logged. No notes, no buyer data.
//   - dispute alerts: a buyer disputed a payment at a shop whose resolver is the network's default resolver (the owner's
//     wallet), so a dispute never waits unseen. Order number, amount and a link.
//   - fee emails (v3): Held's fee arrived in the fee wallet from a release. One email per sync, listing every new fee;
//     sandbox fees (test money) in a separate one marked [Sandbox].
//   - policy alerts: a shop changed its receive policy; says whether it still holds payments for its Held contract.
//   - exposure alerts: a shop, or all shops together, crossed a beta limit for money waiting on delivery (or a shop hit
//     its pause line). Once per crossing; also the daily summary when something is above a line.
import { formatUnits } from 'viem'
import { tokenSymbol, type Db, type Merchant, type Network } from '../shared/api.ts'
import { exposureByShop, exposureLimits, totalExposure, type ShopExposure } from '../shared/exposure.ts'

const usd = (units: string | bigint) => `$${Number(formatUnits(BigInt(units), 6)).toFixed(2)}`

export async function alertDisputes(s: Db, network: Network, paymentIds: string[], siteUrl = 'https://getheld.xyz') {
  const key = process.env.RESEND_API_KEY, to = process.env.ALERT_EMAIL
  if (!key || !to || !paymentIds.length) return
  const resolver = network.defaultResolver.toLowerCase()
  const lines = paymentIds.flatMap((id) => {
    const p = s.payments[id]
    const m = p && s.merchants[p.merchant.toLowerCase()]
    if (!p || !m || m.resolver.toLowerCase() !== resolver) return []
    const order = Object.values(s.orders).find((o) => o.address.toLowerCase() === p.recipient.toLowerCase())
    return [`${m.name}: order #${order?.id ?? '?'}${order ? ` (${order.item})` : ''}, ${usd(p.amount)}`]
  })
  if (!lines.length) return
  const net = network.testnet ? ' (testnet)' : ''
  const subject = lines.length === 1 ? `Held${net}: new dispute, ${lines[0]}` : `Held${net}: ${lines.length} new disputes`
  const text = `A buyer opened a dispute${net}. The money stays held until you decide.\n\n${lines.join('\n')}\n\n` +
    `Decide it with your resolver wallet: ${siteUrl}/#/resolve\n`
  await sendEmail('dispute alert', subject, text)
}

/** Held's fee arrived from releases: one email listing them, with the fee wallet's explorer link. Fees from the
 *  sandbox shop (test money from people trying Held) go in their own email, marked [Sandbox], so they're never
 *  mistaken for a real shop's fee. */
export async function alertFees(s: Db, network: Network, paymentIds: string[]) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL || !paymentIds.length) return
  const sandbox = network.sandbox?.merchant.toLowerCase()
  const isSandbox = (id: string) => !!sandbox && s.payments[id]?.merchant.toLowerCase() === sandbox
  await feeEmail(s, network, paymentIds.filter((id) => !isSandbox(id)), false)
  await feeEmail(s, network, paymentIds.filter(isSandbox), true)
}

async function feeEmail(s: Db, network: Network, paymentIds: string[], sandbox: boolean) {
  let total = 0n
  const ids: string[] = [] // order numbers, so each email has its own subject (Gmail threads identical subjects together)
  const lines = paymentIds.flatMap((id) => {
    const p = s.payments[id]
    const m = p && s.merchants[p.merchant.toLowerCase()]
    if (!p?.fee || !m) return []
    total += BigInt(p.fee)
    const order = Object.values(s.orders).find((o) => o.address.toLowerCase() === p.recipient.toLowerCase())
    ids.push(`#${order?.id ?? '?'}`)
    return [`${m.name}: order #${order?.id ?? '?'}${order ? ` (${order.item})` : ''}, ${usd(p.amount)} released -> fee ${usd(p.fee)} ${tokenSymbol(network, p.token)}`]
  })
  if (!lines.length) return
  const tag = sandbox ? '[Sandbox] ' : '', net = network.testnet ? ' (testnet)' : ''
  const subject = lines.length === 1 ? `${tag}Held${net}: fee received, ${usd(total)} from order ${ids[0]}`
    : `${tag}Held${net}: ${lines.length} fees received, ${usd(total)} from orders ${ids.join(', ')}`
  const text = (sandbox ? 'Someone completed a purchase in the sandbox. This fee is test money from the shared Sandbox Shop, not a real shop.\n\n' : '') +
    `Held's fee arrived in your fee wallet${net}.\n\n${lines.join('\n')}\n\nTotal: ${usd(total)}\n\n` +
    `Fee wallet: ${network.explorer}/address/${network.fee.recipient}\n`
  await sendEmail(sandbox ? 'sandbox fee email' : 'fee email', subject, text)
}

/** A shop changed its receive policy. Re-setup (Change settings) does this too, so it's often fine; if a shop's policy
 *  no longer holds payments for its Held contract, new orders are already paused, and the owner should know why. */
export async function alertPolicyChanges(network: Network, changes: { merchant: Merchant, protected: boolean | null }[]) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL || !changes.length) return
  const state = (p: boolean | null) => (p === null ? "couldn't be checked" : p ? 'still protected' : 'PROTECTION OFF, new orders paused')
  const lines = changes.map((c) => `${c.merchant.name} (${c.merchant.address}): ${state(c.protected)}`)
  const off = changes.filter((c) => c.protected === false).length
  const net = network.testnet ? ' (testnet)' : ''
  const subject = off ? `Held${net}: ${off} shop${off > 1 ? 's' : ''} switched off protection` : `Held${net}: shop receive policy changed (${changes.map((c) => c.merchant.name).join(', ')})`
  await sendEmail('policy alert', subject, `A shop changed its receive policy${net}.\n\n${lines.join('\n')}\n`)
}

/** Money waiting on delivery crossed a beta limit in this sync. `shops`: crossed the alert line; `paused`: crossed the
 *  pause line (new orders now paused, except the sandbox); `total`: all shops together crossed the total line. */
export async function alertExposure(s: Db, network: Network, crossed: { shops: string[], paused: string[], total: boolean }) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL) return
  const limits = exposureLimits(network)
  if (!limits || (!crossed.shops.length && !crossed.paused.length && !crossed.total)) return
  const by = exposureByShop(s), net = network.testnet ? ' (testnet)' : ''
  const sandbox = network.sandbox?.merchant.toLowerCase()
  const lines: string[] = []
  for (const k of crossed.paused) lines.push(`PAUSED: ${shopLine(s, network, k, by.get(k))}${k === sandbox ? ' [Sandbox: never paused]' : ' (new orders paused until it is below the line)'}`)
  for (const k of crossed.shops.filter((k) => !crossed.paused.includes(k))) lines.push(`Above the alert line: ${shopLine(s, network, k, by.get(k))}`)
  if (crossed.total) lines.push(`All shops together: ${usd(totalExposure(by))} waiting on delivery`)
  const what = crossed.paused.length ? 'shop paused' : crossed.total ? 'total limit' : 'shop limit'
  const subject = `Held${net}: ${what}, ${usd(totalExposure(by))} waiting on delivery`
  const text = `Money waiting on delivery (held + disputed payments) crossed a beta limit${net}.\n\n${lines.join('\n')}\n\n` +
    `Limits: alert ${usd(limits.alertShop)} per shop, pause ${usd(limits.pauseShop)} per shop, alert ${usd(limits.alertTotal)} in total.\n` +
    `A script paying an order address directly skips Held's pages, so this alert is the backstop for that.\n`
  await sendEmail('exposure alert', subject, text)
}

/** Daily summary: emailed only when a shop or the total is at or above an alert line. Returns the numbers either way. */
export async function exposureSummary(s: Db, network: Network) {
  const limits = exposureLimits(network), by = exposureByShop(s), total = totalExposure(by)
  const top = [...by].sort((a, b) => (b[1].amount > a[1].amount ? 1 : -1)).slice(0, 3)
  const over = limits ? [...by].filter(([, e]) => e.amount >= limits.alertShop) : []
  const summary = { total: usd(total), shops: by.size, top: top.map(([k, e]) => ({ shop: s.merchants[k]?.name ?? k, waiting: usd(e.amount), payments: e.count })) }
  if (limits && (over.length || total >= limits.alertTotal) && process.env.RESEND_API_KEY && process.env.ALERT_EMAIL) {
    const net = network.testnet ? ' (testnet)' : ''
    await sendEmail('exposure summary', `Held${net}: daily exposure, ${usd(total)} waiting on delivery`,
      `Money waiting on delivery right now${net}: ${usd(total)} across ${by.size} shop(s).\n\n` +
      top.map(([k, e]) => shopLine(s, network, k, e)).join('\n') + '\n')
  }
  return summary
}

function shopLine(s: Db, network: Network, k: string, e?: ShopExposure) {
  const name = s.merchants[k]?.name ?? k
  if (!e) return `${name}: nothing waiting`
  const days = Math.max(0, Math.floor((Date.now() / 1000 - e.oldest) / 86400))
  return `${name}: ${usd(e.amount)} in ${e.count} payment(s), oldest ${days} day(s) old. ${network.explorer}/address/${k}`
}

async function sendEmail(what: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY!, to = process.env.ALERT_EMAIL!
  const send = (from: string) => fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, text }),
    signal: AbortSignal.timeout(5000),
  })
  const fallback = 'Held alerts <onboarding@resend.dev>', from = process.env.ALERT_FROM || fallback
  try {
    let r = await send(from)
    // A refused custom sender (e.g. domain not verified for this key) must not silence alerts: retry from the test sender.
    if (!r.ok && from !== fallback && r.status >= 400 && r.status < 500) {
      console.error(`${what}: sender refused, retrying from the test sender`, r.status, await r.text())
      r = await send(fallback)
    }
    if (!r.ok) console.error(`${what} failed`, r.status, await r.text())
    else console.log(`${what} sent: ${subject}`)
  } catch (e) { console.error(`${what} failed`, e) }
}
