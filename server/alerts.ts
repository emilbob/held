// Emails to Held's owner, sent via Resend (RESEND_API_KEY) to ALERT_EMAIL; without both, they're off. Sender: ALERT_FROM
// (a verified Resend domain), else (or if refused) Resend's test sender. At most once: sent after the sync is saved, and
// a failed send is only logged. No notes, no buyer data.
//   - dispute alerts: a buyer disputed a payment at a shop whose resolver is the network's default resolver (the owner's
//     wallet), so a dispute never waits unseen. Order number, amount and a link.
//   - fee emails (v3): Held's fee arrived in the fee wallet from a release. One email per sync, listing every new fee.
import { formatUnits } from 'viem'
import { tokenSymbol, type Db, type Network } from '../shared/api.ts'

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

/** Held's fee arrived from releases: one email listing them, with the fee wallet's explorer link. */
export async function alertFees(s: Db, network: Network, paymentIds: string[]) {
  if (!process.env.RESEND_API_KEY || !process.env.ALERT_EMAIL || !paymentIds.length) return
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
  const net = network.testnet ? ' (testnet)' : ''
  const subject = lines.length === 1 ? `Held${net}: fee received, ${usd(total)} from order ${ids[0]}`
    : `Held${net}: ${lines.length} fees received, ${usd(total)} from orders ${ids.join(', ')}`
  const text = `Held's fee arrived in your fee wallet${net}.\n\n${lines.join('\n')}\n\nTotal: ${usd(total)}\n\n` +
    `Fee wallet: ${network.explorer}/address/${network.fee.recipient}\n`
  await sendEmail('fee email', subject, text)
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
