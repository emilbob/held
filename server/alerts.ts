// Dispute alerts: an email to Held's owner when a buyer disputes a payment at a shop whose resolver is the network's
// default resolver (the owner's wallet), so a dispute never waits unseen. Sent via Resend (RESEND_API_KEY) to
// ALERT_EMAIL; without both, alerts are off. Sender: ALERT_FROM (a verified Resend domain), else (or if refused) Resend's test sender. The email has the order number, amount and a link: no notes, no buyer data.
// At most once: sent after the dispute is saved, and a failed send is only logged (the resolver console still lists it).
import { formatUnits } from 'viem'
import type { Db, Network } from '../shared/api.ts'

export async function alertDisputes(s: Db, network: Network, paymentIds: string[], siteUrl = 'https://getheld.xyz') {
  const key = process.env.RESEND_API_KEY, to = process.env.ALERT_EMAIL
  if (!key || !to || !paymentIds.length) return
  const resolver = network.defaultResolver.toLowerCase()
  const lines = paymentIds.flatMap((id) => {
    const p = s.payments[id]
    const m = p && s.merchants[p.merchant.toLowerCase()]
    if (!p || !m || m.resolver.toLowerCase() !== resolver) return []
    const order = Object.values(s.orders).find((o) => o.address.toLowerCase() === p.recipient.toLowerCase())
    return [`${m.name}: order #${order?.id ?? '?'}${order ? ` (${order.item})` : ''}, $${Number(formatUnits(BigInt(p.amount), 6)).toFixed(2)}`]
  })
  if (!lines.length) return
  const net = network.testnet ? ' (testnet)' : ''
  const subject = lines.length === 1 ? `Held${net}: new dispute, ${lines[0]}` : `Held${net}: ${lines.length} new disputes`
  const text = `A buyer opened a dispute${net}. The money stays held until you decide.\n\n${lines.join('\n')}\n\n` +
    `Decide it with your resolver wallet: ${siteUrl}/#/resolve\n`
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
      console.error('dispute alert: sender refused, retrying from the test sender', r.status, await r.text())
      r = await send(fallback)
    }
    if (!r.ok) console.error('dispute alert failed', r.status, await r.text())
  } catch (e) { console.error('dispute alert failed', e) }
}
