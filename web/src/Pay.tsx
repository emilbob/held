// Buyer page (#/pay/:id): pay the order's unique address, then confirm delivery or open a dispute.
// Every action is signed by the buyer's own wallet against the merchant's HeldArbiter.
import { useEffect, useState } from 'react'
import type { Hex } from 'viem'
import QRCode from 'qrcode'
import * as W from './wallet.ts'
import { api, session, usePoll, useNow, useConfig, useWallet, WalletPicker, Badge, Steps, Result, usd, short, countdown, duration, type Msg } from './ui.tsx'
import { noteMessage, NOTE_MAX, type Order, type OrderStatus } from '../../shared/api.ts'

export default function Pay({ id }: { id: string }) {
  const now = useNow()
  const cfg = useConfig()
  const [order, err] = usePoll(() => api<Order>(`/orders/${id}`), 2000, [id])
  const w = useWallet('buyer')
  const wallet = w.wallet
  const [qr, setQr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null)
  const [disputing, setDisputing] = useState(false)
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!order || !cfg) return
    // EIP-681 payment request: token transfer to the order's address.
    QRCode.toDataURL(`ethereum:${cfg.acceptedToken}@${cfg.chainId}/transfer?address=${order.address}&uint256=${order.amount}`, { margin: 1, width: 220 }).then(setQr)
  }, [order?.address, cfg])

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key); setMsg(null)
    try { await fn(); if (done) setMsg({ ok: true, text: done }) } catch (e) { setMsg({ ok: false, text: W.explain(e) }) }
    setBusy(null)
  }

  if (err) return <p className="err">{err}</p>
  if (!order) return <p className="muted">Loading order…</p>
  const main = order.payments.find((p) => !p.wrongToken)
  const wrong = order.payments.filter((p) => p.wrongToken)
  const left = main ? main.windowEndsAt - now : 0
  const status: OrderStatus = order.status === 'held' && main && left <= 0 ? 'releasable' : order.status
  const isPayer = wallet && main && wallet.address.toLowerCase() === main.payer.toLowerCase()
  // Paid out or refunded: nothing left for the buyer to do (unless a wrong-token payment still needs returning).
  const settled = (status === 'released' || status === 'refunded') && !wrong.some((p) => p.status === 'held')
  const arbiter = order.merchantInfo.arbiter
  // This browser is signed in as the order's merchant (testing your own shop, or the sandbox): offer the way back.
  // A real buyer never sees it.
  const merchantHere = session.get()?.address.toLowerCase() === order.merchant.toLowerCase()
  const back = <a className="back" href="#/merchant">← Back to your orders</a>
  const callArbiter = (fn: W.ArbiterFn, receipt: Hex) => () => W.arbiter(wallet!, arbiter, fn, receipt)
  // Dispute on-chain first (from the buyer's wallet), then the signed note. A failed note never undoes the dispute.
  const openDispute = async (paymentId: string, receipt: Hex) => {
    await W.arbiter(wallet!, arbiter, 'dispute', receipt)
    const text = reason.trim()
    if (!text) { setMsg({ ok: true, text: 'Dispute opened.' }); return }
    try {
      const signature = await W.signMessage(wallet!, noteMessage(order.id, paymentId, text))
      await api('/notes', { paymentId, text, signature })
      setMsg({ ok: true, text: 'Dispute opened. Your note was sent to the merchant and the resolver.' })
    } catch (e) {
      setMsg({ ok: false, text: `Dispute opened, but your note wasn't sent: ${W.explain(e)}` })
    }
    setDisputing(false)
  }

  return (
    <div className="pay">
      {merchantHere && back}
      <div className="card checkout">
        <Steps status={status} />
        <div className="merchant">{order.merchantInfo.name} · Order #{order.id}</div>
        <h1>{order.item}</h1>
        <div className="big">{usd(order.amount)} <small>pathUSD</small></div>
        <Badge status={status} />

        {status === 'awaiting_payment' && (
          <>
            <p className="protect"><b>Protected by Held.</b> Your payment is held onchain for {duration(order.merchantInfo.window)} or until you
              confirm delivery. If something goes wrong, open a dispute: the funds can only go back to you or to the merchant.</p>
            <div className="payto">
              {qr && <img src={qr} alt="Payment QR code" />}
              <div>
                <label>Send exactly {usd(order.amount)} pathUSD on Tempo to</label>
                <code className="addr">{order.address}</code>
                <button className="ghost" onClick={() => navigator.clipboard.writeText(order.address).then(() => setCopied('ok'), () => setCopied('failed'))
                  .finally(() => setTimeout(() => setCopied(null), 2000))}>{copied === 'ok' ? 'Copied ✓' : 'Copy address'}</button>
                {copied === 'failed' && <span className="muted small"> Couldn't copy: select the address above instead.</span>}
                <p className="muted">Send it from your own wallet, not from an exchange: only the wallet that pays can confirm delivery, open a dispute and receive a refund. It's a plain token transfer, and this address is unique to your order.</p>
              </div>
            </div>
          </>
        )}

        {(status === 'held' || status === 'releasable') && (
          <div className="protect held">
            <b>Payment held: you're protected.</b> {usd(main!.amount)} is locked by the Tempo protocol, not by the merchant.<br />
            {status === 'held' ? <> Protection window: <b>{countdown(left)}</b> left.</> : <> The protection window is over; the merchant can now be paid.</>}
          </div>
        )}
        {status === 'disputed' && <div className="protect dispute"><b>Dispute open.</b> The resolver will decide. By contract, the money can only go back to you or to the merchant.</div>}
        {status === 'released' && <div className="protect done"><b>Delivery confirmed.</b> The merchant has been paid.</div>}
        {status === 'refunded' && <div className="protect done"><b>Refunded.</b> {usd(main!.amount)} was returned to the wallet that paid.</div>}
        {order.underpaid && <p className="warn">This order was underpaid ({usd(main!.amount)} of {usd(order.amount)}).</p>}
      </div>

      {!settled && <div className="card walletbox">
        <h2>Your wallet</h2>
        <WalletPicker w={w} />

        {wallet && status === 'awaiting_payment' && (
          <div className="actions">
            <button className="primary" disabled={!!busy} onClick={() => run('pay', () => W.transfer(wallet, order.address, order.amount))}>
              {busy === 'pay' ? 'Sending…' : `Pay ${usd(order.amount)}`}
            </button>
            {w.testnet && (
              <button className="ghost small" disabled={!!busy} title="Testnet: send a token the merchant doesn't accept"
                onClick={() => run('wrong', () => W.transfer(wallet, order.address, order.amount, W.WRONG_TOKEN))}>
                {busy === 'wrong' ? 'Sending…' : 'Test: pay with the wrong token'}
              </button>
            )}
          </div>
        )}

        {wallet && main && (status === 'held' || status === 'releasable') && (isPayer ? (
          <div className="actions">
            <button className="primary" disabled={!!busy} onClick={() => run('release', callArbiter('release', main.receipt), 'Thanks! The merchant has been paid.')}>
              {busy === 'release' ? 'Confirming…' : 'I got it: release payment'}
            </button>
            {status === 'held' && !disputing && (
              <button className="danger" disabled={!!busy} onClick={() => setDisputing(true)}>Something went wrong: open dispute</button>
            )}
            {status === 'held' && disputing && (
              <form className="disputeform" onSubmit={(e) => { e.preventDefault(); run('dispute', () => openDispute(main.id, main.receipt)) }}>
                <label htmlFor="reason">What went wrong? The merchant and the resolver will read this.</label>
                <textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={NOTE_MAX} rows={3}
                  placeholder="e.g. Nothing arrived by the promised date." />
                <p className="muted small">Your wallet opens the dispute, then signs your note so nobody else can write in your name.</p>
                <div className="row">
                  <button className="danger" disabled={!!busy}>{busy === 'dispute' ? 'Opening…' : 'Send dispute'}</button>
                  <button type="button" className="ghost" disabled={!!busy} onClick={() => setDisputing(false)}>Cancel</button>
                </div>
              </form>
            )}
          </div>
        ) : (
          <p className="muted">Only the wallet that paid ({short(main.payer)}) can confirm or dispute.</p>
        ))}

        {wallet && wrong.map((p) => (
          <div className="wrongtoken" key={p.id}>
            ⚠ You sent {usd(p.amount)} of a token this merchant doesn't accept. It's held, not lost.{' '}
            {p.status === 'held'
              ? (wallet.address.toLowerCase() === p.payer.toLowerCase()
                ? <button disabled={!!busy} onClick={() => run('wrongrefund', callArbiter('refund', p.receipt), 'Wrong token returned to you.')}>Get it back</button>
                : <span className="muted">Connect the sending wallet to get it back.</span>)
              : <b>Returned.</b>}
          </div>
        ))}
        <Result msg={msg} />
      </div>}
      {/* After an action: the wallet box disappears once the order settles, so the way back lives out here. */}
      {merchantHere && (msg?.ok || settled) && <p className="after">{back}</p>}
    </div>
  )
}
