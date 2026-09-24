import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import * as W from './wallet.js'

// ---------------------------------------------------------------- helpers
const api = async (path, body) => {
  const r = await fetch('/api' + path, body ? {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-held-admin': localStorage.getItem('held.admin') || 'demo' },
    body: JSON.stringify(body),
  } : undefined)
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || r.statusText)
  return j
}
const usd = (base) => (Number(base) / 1e6).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '')
const txUrl = (h) => `${W.explorer}/tx/${h}`
const addrUrl = (a) => `${W.explorer}/address/${a}`

function usePoll(fn, ms, deps) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let live = true
    const tick = () => fn().then((d) => live && (setData(d), setError(null)), (e) => live && setError(e.message))
    tick()
    const t = setInterval(tick, ms)
    return () => { live = false; clearInterval(t) }
  }, deps)
  return [data, error]
}
function useNow() {
  const [now, setNow] = useState(Math.floor(Date.now() / 1000))
  useEffect(() => { const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t) }, [])
  return now
}
function useRoute() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => { const f = () => setHash(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return hash.replace(/^#/, '') || '/'
}
const countdown = (secs) => {
  if (secs <= 0) return '0:00'
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, '0')}`
}

const STATUS = {
  awaiting_payment: ['Awaiting payment', 'grey'],
  held: ['Held: protected', 'blue'],
  releasable: ['Window over: releasable', 'amber'],
  disputed: ['Disputed', 'red'],
  released: ['Paid to merchant', 'green'],
  refunded: ['Refunded to buyer', 'violet'],
}
const Badge = ({ status }) => {
  const [label, color] = STATUS[status] || [status, 'grey']
  return <span className={`badge ${color}`}>{label}</span>
}

// ---------------------------------------------------------------- app
export default function App() {
  const route = useRoute()
  const pay = route.match(/^\/pay\/(\d+)/)
  return (
    <>
      <header>
        <a href="#/" className="logo">🛡️ Held</a>
        <span className="tag">Buyer protection for stablecoin payments · Tempo testnet</span>
      </header>
      <main>{pay ? <PayPage id={pay[1]} /> : <Dashboard />}</main>
      <footer>
        Funds are held by Tempo's ReceivePolicyGuard. The Held arbiter contract can only release them to the merchant or refund the original payer.
      </footer>
    </>
  )
}

// ---------------------------------------------------------------- merchant dashboard
function Dashboard() {
  const [cfg] = usePoll(() => api('/config'), 10000, [])
  const [data, err] = usePoll(() => api('/orders'), 1500, [])
  const [balance, setBalance] = useState(null)
  const [item, setItem] = useState('Hand-bound notebook')
  const [amount, setAmount] = useState('20')
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState(null)

  useEffect(() => {
    if (!cfg) return
    const f = () => W.tokenBalance(cfg.merchant).then(setBalance).catch(() => {})
    f(); const t = setInterval(f, 3000); return () => clearInterval(t)
  }, [cfg?.merchant])

  const create = async (e) => {
    e.preventDefault(); setBusy(true); setFormErr(null)
    try { await api('/orders', { item, amount }) } catch (x) { setFormErr(x.message) }
    setBusy(false)
  }
  const orders = data?.orders || []
  const heldTotal = orders.flatMap((o) => o.payments).filter((p) => ['held', 'disputed'].includes(p.status)).reduce((a, p) => a + Number(p.amount), 0)

  return (
    <div className="dash">
      <section className="how">
        <div><b>1 · Order</b><span>Each order gets its own pay-to address. No transaction, no cost.</span></div>
        <div><b>2 · Buyer pays</b><span>A plain transfer from any wallet. Tempo's protocol holds it, not the merchant.</span></div>
        <div><b>3 · Delivered?</b><span>Buyer confirms, or the window closes, and the money goes to the merchant.</span></div>
        <div><b>4 · Problem?</b><span>Buyer disputes. The resolver can only refund the buyer or pay the merchant.</span></div>
      </section>
      <section className="summary">
        <div><label>Merchant checkout address</label>{cfg ? <a href={addrUrl(cfg.merchant)} target="_blank">{short(cfg.merchant)}</a> : '…'}</div>
        <div><label>Merchant balance</label><b>{balance === null ? '…' : usd(balance)}</b></div>
        <div><label>Held for buyers</label><b>{usd(heldTotal)}</b></div>
        <div><label>Protection window</label>{cfg ? countdown(Number(cfg.window)) : '…'}</div>
        <div><label>Arbiter contract</label>{cfg ? <a href={addrUrl(cfg.arbiter)} target="_blank">{short(cfg.arbiter)}</a> : '…'}</div>
      </section>

      <form className="card neworder" onSubmit={create}>
        <h3>New order</h3>
        <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Item" />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (USD)" className="amt" />
        <button disabled={busy}>{busy ? 'Creating…' : 'Create order'}</button>
        {formErr && <span className="err">{formErr}</span>}
      </form>

      {err && <p className="err">API: {err}</p>}
      {cfg?.indexerError && <p className="err">Indexer: {cfg.indexerError}</p>}
      {orders.length === 0 && data && <p className="muted">No orders yet. Create one above, then open its buyer page.</p>}
      {orders.map((o) => <OrderCard key={o.id} order={o} />)}
    </div>
  )
}

function OrderCard({ order: o }) {
  const now = useNow()
  const [log, setLog] = useState([])
  const [busy, setBusy] = useState(null)
  const main = o.payments.find((p) => !p.wrongToken)
  const wrong = o.payments.filter((p) => p.wrongToken)
  const left = main ? main.windowEndsAt - now : 0
  const status = o.status === 'held' && main && left <= 0 ? 'releasable' : o.status

  const act = async (action, p, label) => {
    setBusy(action)
    try {
      const r = await api(`/admin/${action}`, { paymentId: p.id })
      setLog((l) => [{ label, ...r }, ...l].slice(0, 4))
    } catch (e) { setLog((l) => [{ label, ok: false, error: e.message }, ...l]) }
    setBusy(null)
  }
  const B = ({ action, p, label, kind = '' }) => (
    <button className={kind} disabled={!!busy} onClick={() => act(action, p, label)}>{busy === action ? '…' : label}</button>
  )

  return (
    <div className="card order">
      <div className="row">
        <div className="oid">#{o.id}</div>
        <div className="item">{o.item}</div>
        <div className="amount">{usd(o.amount)}</div>
        <Badge status={status} />
        <a className="buyerlink" href={`#/pay/${o.id}`} target="_blank">Buyer page ↗</a>
      </div>
      <div className="meta">
        Pay-to address <code title={o.address}>{short(o.address)}</code> (unique to this order)
        {main && <> · paid by <a href={addrUrl(main.payer)} target="_blank">{short(main.payer)}</a> · <a href={txUrl(main.txHash)} target="_blank">payment tx</a></>}
        {o.underpaid && <span className="warn"> · underpaid ({usd(main.amount)})</span>}
        {status === 'held' && <> · window closes in <b>{countdown(left)}</b></>}
      </div>

      {main && (status === 'held') && (
        <div className="actions">
          <B action="refund" p={main} label="Refund buyer" />
          <span className="sep">Try to cheat:</span>
          <B action="release" p={main} label="Release to myself early" kind="ghost" />
          <B action="try-grab" p={main} label="Take funds from the guard directly" kind="ghost" />
        </div>
      )}
      {main && status === 'releasable' && (
        <div className="actions">
          <B action="release" p={main} label="Release to merchant (window over: anyone can)" kind="primary" />
          <B action="refund" p={main} label="Refund buyer" />
        </div>
      )}
      {main && status === 'disputed' && (
        <div className="actions resolver">
          <span className="sep">Resolver decision:</span>
          <B action="resolve-release" p={main} label="Pay merchant" />
          <B action="resolve-refund" p={main} label="Refund buyer" kind="primary" />
          <span className="muted">(these are the only two options the contract allows)</span>
        </div>
      )}
      {wrong.map((p) => (
        <div className="wrongtoken" key={p.id}>
          ⚠ Wrong token received: {usd(p.amount)} of <code>{short(p.token)}</code> from {short(p.payer)}. Held, not accepted.{' '}
          {p.status === 'held' ? <B action="refund" p={p} label="Return to sender" /> : <b>{p.status === 'refunded' ? 'Returned to sender' : p.status}</b>}
        </div>
      ))}
      {main && main.history.length > 1 && (
        <div className="history">
          {main.history.slice(1).map((h, i) => <span key={i}>{h.status} <a href={txUrl(h.tx)} target="_blank">tx</a>{h.by ? ` by ${short(h.by)}` : ''}</span>)}
        </div>
      )}
      {log.map((l, i) => (
        <div key={i} className={`result ${l.ok ? 'ok' : 'blocked'}`}>
          {l.label}: {l.ok ? <>done {l.tx && <a href={txUrl(l.tx)} target="_blank">tx</a>}</> : <>🔒 blocked by the contract ({l.error})</>}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- buyer page
function PayPage({ id }) {
  const now = useNow()
  const [order, err] = usePoll(() => api(`/orders/${id}`), 1500, [id])
  const [cfg] = usePoll(() => api('/config'), 30000, [])
  const [wallet, setWallet] = useState(null)
  const [bal, setBal] = useState(null)
  const [qr, setQr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    if (!order) return
    // EIP-681 payment request: token transfer to the order's address.
    QRCode.toDataURL(`ethereum:${W.PATHUSD}@42431/transfer?address=${order.address}&uint256=${order.amount}`, { margin: 1, width: 220 }).then(setQr)
  }, [order?.address])
  useEffect(() => {
    const k = localStorage.getItem('held.walletKind')
    if (k === 'demo') W.connect('demo').then(async (w) => {
      setWallet(w)
      if ((await W.tokenBalance(w.address)) < 1_000_000n) api('/faucet', { address: w.address }).catch(() => {})
    })
  }, [])
  useEffect(() => {
    if (!wallet) return
    const f = () => W.tokenBalance(wallet.address).then(setBal).catch(() => {})
    f(); const t = setInterval(f, 3000); return () => clearInterval(t)
  }, [wallet?.address])

  const run = async (key, fn, done) => {
    setBusy(key); setMsg(null)
    try { await fn(); if (done) setMsg({ ok: true, text: done }) } catch (e) { setMsg({ ok: false, text: W.explain(e) }) }
    setBusy(null)
  }
  const connect = (kind) => run('connect', async () => {
    const w = await W.connect(kind)
    localStorage.setItem('held.walletKind', kind)
    setWallet(w)
    // Testnet: top up any freshly connected wallet so the demo never stalls on an empty balance.
    if ((await W.tokenBalance(w.address)) < 1_000_000n) await api('/faucet', { address: w.address }).catch(() => {})
  })

  if (err) return <p className="err">{err}</p>
  if (!order) return <p className="muted">Loading order…</p>
  const main = order.payments.find((p) => !p.wrongToken)
  const wrong = order.payments.filter((p) => p.wrongToken)
  const left = main ? main.windowEndsAt - now : 0
  const status = order.status === 'held' && main && left <= 0 ? 'releasable' : order.status
  const isPayer = wallet && main && wallet.address.toLowerCase() === main.payer.toLowerCase()
  const arb = cfg?.arbiter

  return (
    <div className="pay">
      <div className="card checkout">
        <div className="merchant">Order #{order.id}</div>
        <h2>{order.item}</h2>
        <div className="big">{usd(order.amount)} <small>pathUSD</small></div>
        <Badge status={status} />

        {status === 'awaiting_payment' && (
          <>
            <p className="protect">🛡️ <b>Protected by Held.</b> Your payment is held onchain until you confirm delivery.
              If something goes wrong, open a dispute and the funds can only go back to you or to the merchant.</p>
            <div className="payto">
              {qr && <img src={qr} alt="QR" />}
              <div>
                <label>Send exactly {usd(order.amount)} pathUSD on Tempo to</label>
                <code className="addr">{order.address}</code>
                <button className="ghost" onClick={() => navigator.clipboard.writeText(order.address)}>Copy address</button>
                <p className="muted">Any wallet or exchange works: it's a plain token transfer. This address is unique to your order.</p>
              </div>
            </div>
          </>
        )}

        {(status === 'held' || status === 'releasable') && (
          <div className="protect on">
            🛡️ <b>Payment held: you're protected.</b> {usd(main.amount)} is locked by the Tempo protocol, not by the merchant.
            {status === 'held' ? <> Protection window: <b>{countdown(left)}</b> left.</> : <> The protection window is over; the merchant can now be paid.</>}
          </div>
        )}
        {status === 'disputed' && <div className="protect dispute">⚖️ <b>Dispute open.</b> The resolver will decide. By contract, the money can only go back to you or to the merchant.</div>}
        {status === 'released' && <div className="protect done">✅ Delivery confirmed. The merchant has been paid.</div>}
        {status === 'refunded' && <div className="protect done">↩️ Refunded. {usd(main.amount)} was returned to the wallet that paid.</div>}
        {order.underpaid && <p className="warn">This order was underpaid ({usd(main.amount)} of {usd(order.amount)}).</p>}
      </div>

      <div className="card walletbox">
        <h3>Your wallet</h3>
        {!wallet ? (
          <div className="actions">
            <button className="primary" onClick={() => connect('tempo')} disabled={!!busy}>{busy === 'connect' ? 'Connecting…' : 'Pay with Tempo Wallet'}</button>
            <button onClick={() => connect('demo')} disabled={!!busy}>Use demo wallet</button>
            {W.hasInjected() && <button className="ghost" onClick={() => connect('injected')} disabled={!!busy}>Connect browser wallet</button>}
            <p className="muted small">Tempo Wallet signs with a passkey (Face ID / Touch ID). No extension, no seed phrase.</p>
          </div>
        ) : (
          <p><a href={addrUrl(wallet.address)} target="_blank">{short(wallet.address)}</a> · {bal === null ? '…' : usd(bal)} pathUSD
            {wallet.kind === 'demo' && <span className="muted"> (demo wallet in this browser)</span>}
            {wallet.kind === 'tempo' && <span className="muted"> (Tempo Wallet)</span>}
            {wallet.kind === 'injected' && <span className="muted"> (browser wallet)</span>}
            {' '}<button className="ghost small" onClick={() => { localStorage.removeItem('held.walletKind'); setWallet(null); setBal(null) }}>Switch</button></p>
        )}

        {wallet && status === 'awaiting_payment' && (
          <div className="actions">
            <button className="primary" disabled={!!busy} onClick={() => run('pay', () => W.transfer(wallet, order.address, order.amount))}>
              {busy === 'pay' ? 'Sending…' : `Pay ${usd(order.amount)}`}
            </button>
            <button className="ghost small" disabled={!!busy} title="Demo: send a token the merchant doesn't accept"
              onClick={() => run('wrong', () => W.transfer(wallet, order.address, order.amount, W.WRONG_TOKEN))}>
              {busy === 'wrong' ? 'Sending…' : 'Demo: pay with the wrong token'}
            </button>
          </div>
        )}

        {wallet && main && (status === 'held' || status === 'releasable') && (isPayer ? (
          <div className="actions">
            <button className="primary" disabled={!!busy} onClick={() => run('release', () => W.arbiter(wallet, arb, 'release', main.receipt), 'Thanks! The merchant has been paid.')}>
              {busy === 'release' ? 'Confirming…' : 'I got it: release payment'}
            </button>
            {status === 'held' && (
              <button className="danger" disabled={!!busy} onClick={() => run('dispute', () => W.arbiter(wallet, arb, 'dispute', main.receipt), 'Dispute opened.')}>
                {busy === 'dispute' ? 'Opening…' : 'Something went wrong: open dispute'}
              </button>
            )}
          </div>
        ) : (
          <div className="actions">
            <p className="muted">Only the wallet that paid ({short(main.payer)}) can confirm or dispute.</p>
            <button className="ghost small" disabled={!!busy} onClick={() => run('dispute', () => W.arbiter(wallet, arb, 'dispute', main.receipt))}>
              Try to dispute from this wallet
            </button>
          </div>
        ))}

        {wallet && wrong.map((p) => (
          <div className="wrongtoken" key={p.id}>
            ⚠ You sent {usd(p.amount)} of a token this merchant doesn't accept. It's held, not lost.{' '}
            {p.status === 'held'
              ? (wallet.address.toLowerCase() === p.payer.toLowerCase()
                ? <button disabled={!!busy} onClick={() => run('wrongrefund', () => W.arbiter(wallet, arb, 'refund', p.receipt), 'Wrong token returned to you.')}>Get it back</button>
                : <span className="muted">Connect the sending wallet to get it back.</span>)
              : <b>Returned.</b>}
          </div>
        ))}
        {msg && <div className={`result ${msg.ok ? 'ok' : 'blocked'}`}>{msg.ok ? '' : '🔒 '}{msg.text}</div>}
      </div>
    </div>
  )
}
