// Buyer page (#/pay/:key): pay the order's unique address, then confirm delivery or open a dispute.
// Every action is signed by the buyer's own wallet against the merchant's HeldArbiter.
import { useEffect, useRef, useState } from 'react'
import { CountUp, useEntrance } from './anim.tsx'
import type { Hex } from 'viem'
import QRCode from 'qrcode'
import * as W from './wallet.ts'
import { api, session, usePoll, useNow, useConfig, useWallet, WalletPicker, walletFits, Badge, Steps, Result, Notes, usd, short, countdown, duration, openSandboxResolver, isSandboxShop, addrUrl, type Msg } from './ui.tsx'
import { noteMessage, NOTE_MAX, NOTES_PER_SIDE, tokenSymbol, type Order, type OrderStatus } from '../../shared/api.ts'
import type { Address } from 'viem'

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
  const [followUp, setFollowUp] = useState('')
  const [chosen, setChosen] = useState<Address | null>(null)
  const root = useRef<HTMLDivElement>(null)
  useEntrance(root, ':scope > .card', !!order)

  useEffect(() => {
    if (!order || !cfg) return
    // EIP-681 payment request: token transfer to the order's address.
    const token = order.merchantInfo.acceptedTokens[0] ?? W.PATHUSD
    QRCode.toDataURL(`ethereum:${token}@${cfg.chainId}/transfer?address=${order.address}&uint256=${order.amount}`, { margin: 1, width: 220 }).then(setQr)
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
  // Each payment is decided by the arbiter it was held for (a shop that changed settings has a new one for new payments).
  const arbiterFor = (receipt: Hex) => order.payments.find((p) => p.receipt === receipt)?.arbiter ?? order.merchantInfo.arbiter
  // v3 shops: the resolver must decide within resolveWindow, else the buyer can take a refund; the buyer can also
  // withdraw their dispute. Older shops have neither.
  const resolveWindow = order.merchantInfo.resolveWindow
  const deadlineLeft = main?.resolveBy ? main.resolveBy - now : null
  const deadlinePassed = deadlineLeft !== null && deadlineLeft <= 0
  // The sandbox shop is paid with a test wallet; a real shop with Tempo Wallet or a browser wallet.
  const sandbox = isSandboxShop(cfg, order.merchant)
  const choice = sandbox ? 'test' : 'real'
  // Only for paying: an order already paid stays with the wallet that paid it, whatever kind it is.
  const wrongKind = status === 'awaiting_payment' && !!wallet && !walletFits(wallet.kind, choice)
  // Sandbox only, and only if this browser is signed in as its merchant: the way back to the dashboard. Buyers of a
  // real shop never see it.
  const merchantHere = sandbox && session.get()?.address.toLowerCase() === order.merchant.toLowerCase()
  const back = <a className="back" href="#/merchant">← Back to your orders</a>
  const accepted = order.merchantInfo.acceptedTokens
  const me = wallet?.address.toLowerCase()
  const ownRole = !me ? null : me === order.merchant.toLowerCase() ? 'merchant' : me === order.merchantInfo.resolver.toLowerCase() ? 'resolver' : null
  // Who decides disputes, shown before paying: the buyer should know if the merchant resolves its own disputes.
  // Only for payments under the shop's current arbiter (an older one may have had another resolver).
  const resolver = order.merchantInfo.resolver
  const resolverKind = sandbox ? 'sandbox' : resolver.toLowerCase() === order.merchant.toLowerCase() ? 'merchant'
    : cfg && resolver.toLowerCase() === cfg.defaultResolver.toLowerCase() ? 'held' : 'other'
  const resolverLine = (!main?.arbiter || main.arbiter.toLowerCase() === order.merchantInfo.arbiter.toLowerCase()) && (
    <><br />Disputes are decided by {{
      held: <b>Held's neutral resolver</b>,
      merchant: <b>the merchant itself</b>,
      other: <b>a resolver the merchant chose</b>,
      sandbox: <b>the sandbox's test resolver</b>,
    }[resolverKind]} (<a href={addrUrl(resolver)} target="_blank" rel="noreferrer">{short(resolver)}</a>).</>
  )
  const sym = (t: string) => tokenSymbol(W.NET, t)
  const accepts = accepted.map(sym).join(', ').replace(/, ([^,]*)$/, ' or $1')
  // Pay with: the stablecoin the buyer picked, else the first accepted one they hold enough of.
  const bal = (t: Address) => w.balances?.[t.toLowerCase()] ?? 0n
  const enough = accepted.filter((t) => bal(t) >= BigInt(order.amount))
  const payToken = chosen && accepted.includes(chosen) ? chosen : enough[0] ?? accepted[0]
  const callArbiter = (fn: W.ArbiterFn, receipt: Hex) => () => W.arbiter(wallet!, arbiterFor(receipt), fn, receipt, accepted)
  // A buyer's note is signed by the wallet that paid, so nobody else can write in the buyer's name.
  const sendNote = async (paymentId: string, text: string) => {
    const signature = await W.signMessage(wallet!, noteMessage(order.id, paymentId, text))
    await api('/notes', { paymentId, text, signature })
  }
  // Dispute on-chain first (from the buyer's wallet), then the signed note. A failed note never undoes the dispute.
  const openDispute = async (paymentId: string, receipt: Hex) => {
    await W.arbiter(wallet!, arbiterFor(receipt), 'dispute', receipt, accepted)
    const text = reason.trim()
    if (!text) { setMsg({ ok: true, text: 'Dispute opened.' }); return }
    try {
      await sendNote(paymentId, text)
      setMsg({ ok: true, text: 'Dispute opened. Your note was sent to the merchant and the resolver.' })
    } catch (e) {
      setMsg({ ok: false, text: `Dispute opened, but your note wasn't sent: ${W.explain(e)}` })
    }
    setDisputing(false)
  }

  return (
    <div className="pay" ref={root}>
      <div className="card checkout">
        <Steps status={status} />
        <div className="merchant">{order.merchantInfo.name} · Order #{order.id}</div>
        <h1>{order.item}</h1>
        <div className="big"><CountUp value={Number(order.amount)} format={usd} /> <small>{accepted.length > 1 ? 'in stablecoins' : sym(accepted[0])}</small></div>
        <Badge status={status} />

        {status === 'awaiting_payment' && (
          <>
            <p className="protect"><b>Protected by Held.</b> Your payment is held onchain for {duration(order.merchantInfo.window)} or until you
              confirm delivery. If something goes wrong, open a dispute: the funds can only go back to you or to the merchant.
              {resolveWindow ? <> The resolver has {duration(resolveWindow)} to decide; if they don't, you get your money back.</> : null}
              {resolverLine}</p>
            <div className="payto">
              {qr && <img src={qr} alt="Payment QR code" />}
              <div>
                <label>Send exactly {usd(order.amount)} in {accepts} on Tempo to</label>
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
        {status === 'disputed' && <div className="protect dispute"><b>Dispute open.</b> The resolver will decide. By contract, the money can only go back to you or to the merchant.
          {resolverLine}
          {deadlineLeft !== null && (deadlinePassed
            ? <><br /><b>The resolver's deadline has passed:</b> the money can now only go back to you.</>
            : <><br />The resolver has <b>{countdown(deadlineLeft)}</b> left to decide. If they don't, you get your money back.</>)}</div>}
        {status === 'disputed' && main && (order.notes?.[main.id]?.length
          ? <Notes notes={order.notes[main.id]} me={isPayer ? 'buyer' : undefined} />
          : <p className="muted small">No notes yet. The merchant's replies will show here.</p>)}
        {status === 'disputed' && isSandboxShop(cfg, order.merchant) && (
          <div className="resolvecall">
            <p><b>In the sandbox, you're the resolver too.</b> Read both sides and decide: refund the buyer or pay the merchant.</p>
            <button className="primary" onClick={openSandboxResolver}>Decide this dispute as the resolver →</button>
          </div>
        )}
        {status === 'released' && <div className="protect done"><b>Delivery confirmed.</b> The merchant has been paid.</div>}
        {status === 'refunded' && <div className="protect done"><b>Refunded.</b> {usd(main!.amount)} was returned to the wallet that paid.</div>}
        {settled && <p className="askfb">How was paying with Held? <a href="#/feedback">Tell us in two minutes</a>: it decides what we build next.</p>}
        {order.underpaid && <p className="warn">This order was underpaid ({usd(main!.amount)} of {usd(order.amount)}).</p>}
      </div>

      {!settled && <div className="card walletbox">
        <h2>Your wallet</h2>
        <WalletPicker w={w} choice={status === 'awaiting_payment' ? choice : 'any'} />

        {wallet && !wrongKind && status === 'awaiting_payment' && (
          <div className="actions">
            {accepted.length > 1 && (
              <div className="paywith" role="group" aria-label="Pay with">
                <span className="muted small">Pay with</span>
                {accepted.map((t) => (
                  <button key={t} type="button" className={`chip ${t === payToken ? 'on' : ''}`} aria-pressed={t === payToken} onClick={() => setChosen(t)}>
                    {sym(t)} <span>{w.balances ? usd(bal(t)) : '…'}</span>
                  </button>
                ))}
              </div>
            )}
            {w.toppingUp && <p className="muted small">Adding free test funds to this wallet…</p>}
            {!w.toppingUp && w.balances && bal(payToken) < BigInt(order.amount) && (
              <p className="warn small">This wallet has {usd(bal(payToken))} {sym(payToken)}. {enough.length ? `Choose ${sym(enough[0])} above.` : `Add ${usd(order.amount)} in ${accepts} first.`}</p>
            )}
            {/* Several wallets (e.g. synced passkeys) make it easy to pay from the wrong one: say which one pays, and refuse
                this shop's own merchant or resolver wallet, which must never also be its buyer. */}
            {ownRole
              ? <p className="warn">This wallet ({short(wallet.address)}) is this shop's {ownRole}. Pay from your own wallet: press <i>Change wallet</i> above.</p>
              : <p className="payingfrom">Paying from <b>{short(wallet.address)}</b> <span className="muted">({wallet.name})</span></p>}
            <button className="primary" disabled={!!busy || !!ownRole || w.toppingUp || (!!w.balances && bal(payToken) < BigInt(order.amount))} onClick={() => run('pay', () => W.transfer(wallet, order.address, order.amount, payToken))}>
              {busy === 'pay' ? 'Sending…' : `Pay ${usd(order.amount)}${accepted.length > 1 ? ` in ${sym(payToken)}` : ''}`}
            </button>
            {w.testnet && W.WRONG_TOKEN && (
              <button className="ghost small" disabled={!!busy} title="Testnet: send a token the merchant doesn't accept"
                onClick={() => run('wrong', () => W.transfer(wallet, order.address, order.amount, W.WRONG_TOKEN!))}>
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

        {/* v3 shops: past the deadline any wallet can trigger the buyer's refund (it always goes to the wallet that paid);
            before it, the paying wallet can withdraw its dispute by paying the merchant itself. */}
        {wallet && main && status === 'disputed' && deadlinePassed && (
          <div className="actions">
            <button className="primary" disabled={!!busy} onClick={() => run('deadline', callArbiter('refund', main.receipt), 'Refunded to the wallet that paid.')}>
              {busy === 'deadline' ? 'Refunding…' : isPayer ? 'Get my refund' : `Refund the buyer (${short(main.payer)})`}
            </button>
          </div>
        )}
        {wallet && main && status === 'disputed' && isPayer && resolveWindow && (
          <div className="actions">
            <button className="ghost" disabled={!!busy} onClick={() => run('withdraw', callArbiter('release', main.receipt), 'Dispute withdrawn: the merchant has been paid.')}>
              {busy === 'withdraw' ? 'Paying…' : 'Sorted it out? Withdraw dispute and pay the merchant'}
            </button>
          </div>
        )}
        {/* Dispute open: the paying wallet can keep its side of the story going, until the resolver's deadline. */}
        {wallet && main && status === 'disputed' && isPayer && !deadlinePassed && (() => {
          const mine = (order.notes?.[main.id] ?? []).filter((n) => n.by === 'buyer').length
          return mine < NOTES_PER_SIDE ? (
            <form className="replyform" onSubmit={(e) => { e.preventDefault()
              run('note', () => sendNote(main.id, followUp.trim()).then(() => setFollowUp('')), 'Note sent to the merchant and the resolver.') }}>
              <label htmlFor="followup" className="muted small">Add a note for the merchant and the resolver ({NOTES_PER_SIDE - mine} left).
                {resolveWindow ? null : 'Sorted it out with the merchant? Say so here: the resolver can then pay them.'}</label>
              <textarea id="followup" value={followUp} onChange={(e) => setFollowUp(e.target.value)} maxLength={NOTE_MAX} rows={2} />
              <button className="small" disabled={!!busy || !followUp.trim()}>{busy === 'note' ? 'Sending…' : 'Send note'}</button>
            </form>
          ) : <p className="muted small">You've sent the maximum of {NOTES_PER_SIDE} notes. The resolver will decide.</p>
        })()}

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
      {/* Below the wallet box, so it's still there once the order settles and the box disappears. */}
      {merchantHere && <p className="after">{back}</p>}
    </div>
  )
}
