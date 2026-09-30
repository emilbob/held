// Resolver page (#/resolve): disputes for merchants who chose this wallet as their resolver. Each decision is signed
// by the resolver's own wallet, and HeldArbiter allows exactly two outcomes: refund the buyer or pay the merchant.
import { useState } from 'react'
import type { Hex } from 'viem'
import * as W from './wallet.ts'
import { api, usePoll, useWallet, WalletPicker, Result, usd, short, txUrl, addrUrl, type Msg } from './ui.tsx'
import type { Order } from '../../shared/api.ts'

export default function Resolve() {
  const w = useWallet('resolver')
  const addr = w.wallet?.address
  const [data, err] = usePoll(() => (addr ? api<{ orders: Order[] }>(`/disputes?resolver=${addr}`) : Promise.resolve(null)), 4000, [addr])
  return (
    <div className="dash">
      <div className="card">
        <h2>Resolve disputes</h2>
        <p className="muted">Connect the resolver wallet. You'll see open disputes for every merchant who chose it. The contract lets you do only
          two things: refund the buyer, or pay the merchant.</p>
        <WalletPicker w={w} note="Use the wallet merchants set as their resolver." />
      </div>
      {err && <p className="err">{err}</p>}
      {addr && data && data.orders.length === 0 && <p className="muted">No open disputes for {short(addr)}.</p>}
      {w.wallet && data?.orders.map((o) => <Dispute key={o.id} order={o} wallet={w.wallet!} />)}
    </div>
  )
}

function Dispute({ order: o, wallet }: { order: Order, wallet: W.Wallet }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const p = o.payments.find((x) => x.status === 'disputed')!
  const disputedTx = p.history.find((h) => h.status === 'disputed')?.tx
  const decide = async (fn: 'refund' | 'release', done: string) => {
    setBusy(fn); setMsg(null)
    try { await W.arbiter(wallet, o.merchantInfo.arbiter, fn, p.receipt as Hex); setMsg({ ok: true, text: done }) } catch (e) { setMsg({ ok: false, text: W.explain(e) }) }
    setBusy(null)
  }
  return (
    <div className="card order">
      <div className="row">
        <div className="oid">#{o.id}</div>
        <div className="item">{o.item} <span className="muted">· {o.merchantInfo.name}</span></div>
        <div className="amount">{usd(p.amount)}</div>
      </div>
      <div className="meta">
        Buyer <a href={addrUrl(p.payer)} target="_blank">{short(p.payer)}</a> · merchant <a href={addrUrl(o.merchant)} target="_blank">{short(o.merchant)}</a>
        {' '}· <a href={txUrl(p.txHash)} target="_blank">payment</a>{disputedTx && <> · <a href={txUrl(disputedTx)} target="_blank">dispute</a></>}
      </div>
      <div className="actions resolver">
        <button className="primary" disabled={!!busy} onClick={() => decide('refund', 'Refunded to the buyer.')}>{busy === 'refund' ? '…' : 'Refund buyer'}</button>
        <button disabled={!!busy} onClick={() => decide('release', 'Paid to the merchant.')}>{busy === 'release' ? '…' : 'Pay merchant'}</button>
      </div>
      <Result msg={msg} />
    </div>
  )
}
