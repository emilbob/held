// Resolver page (#/resolve): disputes for merchants who chose this wallet as their resolver. Each decision is signed
// by the resolver's own wallet, and HeldArbiter allows exactly two outcomes: refund the buyer or pay the merchant.
import { useEffect, useState } from 'react'
import type { Hex } from 'viem'
import * as W from './wallet.ts'
import { api, session, signInWallet, usePoll, useWallet, WalletPicker, Result, Notes, usd, short, txUrl, addrUrl, type Msg } from './ui.tsx'
import type { Order } from '../../shared/api.ts'

export default function Resolve() {
  const w = useWallet('resolver')
  const addr = w.wallet?.address
  // Signing in lets the console show the buyer's and merchant's notes (they're private to the resolver and merchant).
  const signedIn = !!addr && session.get('resolver')?.address.toLowerCase() === addr.toLowerCase()
  const [signing, setSigning] = useState(false)
  const [signErr, setSignErr] = useState<string | null>(null)
  const signIn = async () => {
    if (!w.wallet) return
    setSigning(true); setSignErr(null)
    try { await signInWallet(w.wallet, 'resolver') } catch (e) { setSignErr(W.explain(e)) }
    setSigning(false)
  }
  useEffect(() => { if (w.wallet?.kind === 'sandbox' && !signedIn && !signing) signIn() }, [w.wallet?.address, signedIn])
  const [data, err] = usePoll(() => (addr ? api<{ orders: Order[], notes: boolean }>(`/disputes?resolver=${addr}`, undefined, 'resolver') : Promise.resolve(null)), 4000, [addr, signedIn])
  return (
    <div className="dash">
      <div className="card">
        <h1>Resolve disputes</h1>
        <p className="muted">Connect the resolver wallet. You'll see open disputes for every merchant who chose it. The contract lets you do only
          two things: refund the buyer, or pay the merchant.</p>
        <WalletPicker w={w} note="Use the wallet merchants set as their resolver." />
        {w.wallet && !signedIn && (
          <p className="signin">
            <button className="small" disabled={signing} onClick={signIn}>{signing ? 'Waiting for signature…' : 'Sign in to see the notes'}</button>
            {' '}<span className="muted small">Buyer and merchant notes are private: sign a message (free, moves no funds) to read them.</span>
          </p>
        )}
        {signErr && <Result msg={{ ok: false, text: signErr }} />}
      </div>
      {err && <p className="err">{err}</p>}
      {addr && data && data.orders.length === 0 && (
        <div className="card empty"><b>No open disputes.</b> <span className="muted">When a buyer disputes a payment at a shop that chose {short(addr)} as its resolver, it appears here.</span></div>
      )}
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
      <Notes notes={o.notes?.[p.id]} />
      <div className="actions resolver">
        <button className="primary" disabled={!!busy} onClick={() => decide('refund', 'Refunded to the buyer.')}>{busy === 'refund' ? '…' : 'Refund buyer'}</button>
        <button disabled={!!busy} onClick={() => decide('release', 'Paid to the merchant.')}>{busy === 'release' ? '…' : 'Pay merchant'}</button>
      </div>
      <Result msg={msg} />
    </div>
  )
}
