// Exposure: money waiting on delivery (payments that are held or disputed), per shop and in total. During the beta this is
// Held's real risk until the audit: the per-order limit (maxOrder) is only checked by the API, and the contract has no cap
// (Tempo holds whatever is sent, so a cap could only refuse to release). So the server watches the totals instead:
// it emails the owner when a shop or the whole network crosses an alert line, and pauses new orders for a shop above
// its pause line (server/core.ts). All accepted stablecoins have 6 decimals and are counted 1:1 in dollars.
import type { Db, Network } from './api.ts'

export interface ShopExposure { amount: bigint, count: number, oldest: number }

/** Held + disputed payments per shop (key: lowercase merchant address). Wrong-token payments count too: they're held. */
export function exposureByShop(s: Pick<Db, 'payments'>): Map<string, ShopExposure> {
  const out = new Map<string, ShopExposure>()
  for (const p of Object.values(s.payments)) {
    if (p.status !== 'held' && p.status !== 'disputed') continue
    const k = p.merchant.toLowerCase()
    const e = out.get(k) ?? { amount: 0n, count: 0, oldest: p.heldAt }
    e.amount += BigInt(p.amount)
    e.count += 1
    e.oldest = Math.min(e.oldest, p.heldAt)
    out.set(k, e)
  }
  return out
}

export const totalExposure = (by: Map<string, ShopExposure>) => [...by.values()].reduce((t, e) => t + e.amount, 0n)

/** The network's limits in base units, or null when none are configured (then nothing is alerted or paused). */
export function exposureLimits(network: Pick<Network, 'exposure'>) {
  const x = network.exposure
  return x ? { alertShop: BigInt(x.alertShop), pauseShop: BigInt(x.pauseShop), alertTotal: BigInt(x.alertTotal) } : null
}

/** Crossings between two snapshots: shops (and the total) that went from below a line to at or above it. Firing only on
 *  the upward crossing means one email per crossing, and the line re-arms by itself once payments settle below it. */
export function exposureCrossings(before: Map<string, ShopExposure>, after: Map<string, ShopExposure>, limits: NonNullable<ReturnType<typeof exposureLimits>>) {
  const was = (k: string) => before.get(k)?.amount ?? 0n
  const shops = [...after].filter(([k, e]) => was(k) < limits.alertShop && e.amount >= limits.alertShop).map(([k]) => k)
  const paused = [...after].filter(([k, e]) => was(k) < limits.pauseShop && e.amount >= limits.pauseShop).map(([k]) => k)
  const total = totalExposure(before) < limits.alertTotal && totalExposure(after) >= limits.alertTotal
  return { shops, paused, total }
}
