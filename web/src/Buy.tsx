// Checkout link (#/buy/:linkId): a buyer opened a merchant's reusable link. Create their own fresh order (own
// protected payment address, the merchant's fixed price) and go to its buyer page. The same browser opening the same
// link again gets its previous order back while that one is still unpaid, so re-opening doesn't pile up empty orders;
// once it's paid (or gone), the next visit makes a new one.
import { useEffect, useRef, useState } from 'react'
import { api, usd } from './ui.tsx'
import type { Order, PublicLink } from '../../shared/api.ts'

export default function Buy({ id }: { id: string }) {
  const [link, setLink] = useState<PublicLink | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    const remember = `held.buy.${id}`
    const previous = (() => { try { return localStorage.getItem(remember) } catch { return null } })()
    api<PublicLink>(`/links/${id}`)
      .then((l) => { setLink(l); if (!l.active) throw new Error('This checkout link has been turned off by the merchant.') })
      .then(async () => {
        if (previous) {
          const o = await api<Order>(`/orders/${previous}`).catch(() => null)
          if (o && o.status === 'awaiting_payment' && !o.payments.length) return o
        }
        const o = await api<Order>(`/links/${id}/orders`, {})
        try { localStorage.setItem(remember, o.key ?? String(o.id)) } catch {}
        return o
      })
      .then((o) => location.replace(`#/pay/${o.key ?? o.id}`)) // replace: the back button shouldn't make another order
      .catch((e: Error) => setError(e.message))
  }, [id])
  return (
    <div className="narrow">
      <div className="card">
        {!link && <h1>Checkout</h1>}
        {link && <><div className="muted">{link.merchantName}</div><h1>{link.item}</h1><div className="big">{usd(link.amount)} <small>in stablecoins</small></div></>}
        {error ? <p className="err">{error}</p> : <p className="muted">Creating your protected order…</p>}
      </div>
    </div>
  )
}
