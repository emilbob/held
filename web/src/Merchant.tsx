// Merchant page (#/merchant): connect a wallet, sign in, set up once (own arbiter + receive policy), then create
// orders and act on them. Every on-chain action is signed by the merchant's own wallet; Held's server holds no keys.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Address, Hex } from 'viem'
import * as W from './wallet.ts'
import { runSetup, type MiningProgress, type SetupState, type SetupStep } from './setup.ts'
import { api, session, usePoll, useNow, useConfig, useWallet, WalletPicker, Badge, Result, usd, short, txUrl, addrUrl, countdown, duration, type Msg } from './ui.tsx'
import { signInMessage, type Config, type Merchant, type Order, type OrderStatus, type Payment } from '../../shared/api.ts'

export default function MerchantPage() {
  const cfg = useConfig()
  const w = useWallet('merchant')
  const [me, setMe] = useState<{ address: Address, merchant: Merchant | null } | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [signing, setSigning] = useState(false)

  // A session only counts for the wallet that's connected now.
  const sess = session.get()
  const signedIn = !!w.wallet && sess?.address.toLowerCase() === w.wallet.address.toLowerCase()
  const loadMe = () => api<{ address: Address, merchant: Merchant | null }>('/me').then(setMe, () => { session.set(null); setMe(null) })
  useEffect(() => { if (signedIn) loadMe(); else setMe(null) }, [signedIn, w.wallet?.address])

  const signIn = async () => {
    if (!w.wallet) return
    setSigning(true); setMsg(null)
    try {
      const issued = Math.floor(Date.now() / 1000)
      const signature = await W.signMessage(w.wallet, signInMessage(w.wallet.address, location.host, issued))
      const r = await api<{ token: string, address: Address }>('/auth', { address: w.wallet.address, issued, signature })
      session.set(r)
      await loadMe()
    } catch (e) { setMsg({ ok: false, text: W.explain(e) }) }
    setSigning(false)
  }

  // The sandbox wallet's key is in the browser anyway, so skip the sign-in click for it.
  useEffect(() => { if (w.wallet?.kind === 'sandbox' && !signedIn && !signing) signIn() }, [w.wallet?.address, signedIn])

  if (!w.wallet) return (
    <div className="narrow">
      <div className="card">
        <h2>Accept stablecoin payments with buyer protection</h2>
        <p>Connect the wallet that will be your shop's checkout address. Buyers pay it; every payment is held until they
          confirm delivery or the protection window ends. You can refund anytime, and only you and the buyer's wallet ever receive the money.</p>
        <WalletPicker w={w} note="Use a wallet dedicated to your shop: after setup, every payment sent to it is held until released or refunded." />
      </div>
    </div>
  )
  if (!signedIn || !me) return (
    <div className="narrow">
      <div className="card">
        <h2>Sign in</h2>
        <WalletPicker w={w} />
        <p className="muted">Sign a message to prove this wallet is yours. It's free and moves no funds.</p>
        <button className="primary" disabled={signing} onClick={signIn}>{signing ? 'Waiting for signature…' : 'Sign in with this wallet'}</button>
        <Result msg={msg} />
      </div>
    </div>
  )
  if (!me.merchant) return cfg && <Setup cfg={cfg} wallet={w.wallet} onDone={loadMe} />
  return <Dashboard merchant={me.merchant} w={w} testnet={!!cfg?.testnet} />
}

// ---------------------------------------------------------------- one-time setup
const STEPS: [SetupStep, string][] = [
  ['mine', 'Create your checkout address (proof of work in this browser)'],
  ['register', 'Register it on Tempo (1 transaction)'],
  ['deploy', 'Deploy your own Held arbiter contract (1 transaction)'],
  ['policy', 'Hold incoming payments for that arbiter (1 transaction)'],
]

function Setup({ cfg, wallet, onDone }: { cfg: Config, wallet: W.Wallet, onDone: () => void }) {
  const saveKey = `held.setup.${wallet.address.toLowerCase()}`
  const saved = (): SetupState => { try { return JSON.parse(localStorage.getItem(saveKey) || '{}') } catch { return {} } }
  const [name, setName] = useState('')
  const windows = cfg.testnet ? [300, 86400, 7 * 86400] : [86400, 7 * 86400, 14 * 86400]
  const [window, setWindow] = useState(cfg.defaultWindow)
  const [resolver, setResolver] = useState<string>(cfg.defaultResolver)
  const [step, setStep] = useState<SetupStep | null>(null)
  const [mining, setMining] = useState<MiningProgress | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const start = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null)
    if (!/^0x[0-9a-fA-F]{40}$/.test(resolver)) return setMsg({ ok: false, text: 'The resolver must be a wallet address (0x…).' })
    abort.current = new AbortController()
    try {
      const r = await runSetup({ wallet, pub: W.pub as never, resolver: resolver as Address, token: cfg.acceptedToken, window, state: saved(),
        save: (s) => localStorage.setItem(saveKey, JSON.stringify(s)), onStep: setStep, onProgress: setMining, signal: abort.current.signal })
      await api('/merchants', { name: name || 'My shop', arbiter: r.arbiter, masterId: r.masterId })
      localStorage.removeItem(saveKey)
      onDone()
    } catch (x) { setMsg({ ok: false, text: W.explain(x) }); setStep(null) }
  }

  const at = step ? STEPS.findIndex(([s]) => s === step) : -1
  const expected = mining && mining.rate > 0 ? 2 ** 32 / mining.rate : 0
  return (
    <div className="narrow">
      <form className="card setup" onSubmit={start}>
        <h2>Set up your shop</h2>
        <p className="muted">One time, from your wallet ({short(wallet.address)}). Your checkout address and your own arbiter contract: Held's server never holds your keys or your funds.</p>
        <label>Shop name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My shop" maxLength={60} disabled={!!step} />
        <label>Protection window (how long buyers can dispute)</label>
        <div className="choices">
          {windows.map((s) => <button type="button" key={s} className={window === s ? 'primary' : 'ghost'} disabled={!!step} onClick={() => setWindow(s)}>{duration(s)}</button>)}
        </div>
        <details>
          <summary>Resolver (who decides disputes)</summary>
          <p className="muted small">Held's resolver by default. It can only refund the buyer or pay you, never anything else.</p>
          <input value={resolver} onChange={(e) => setResolver(e.target.value.trim())} disabled={!!step} />
        </details>
        <ol className="setupsteps">
          {STEPS.map(([s, label], i) => (
            <li key={s} className={i < at || step === 'done' ? 'done' : i === at ? 'now' : ''}>
              {label}
              {s === 'mine' && step === 'mine' && mining && (
                <span className="muted small"> · {(mining.attempts / 1e6).toFixed(0)}M tries at {(mining.rate / 1e6).toFixed(1)}M/s
                  {expected > 0 && <> · usually ~{Math.max(1, Math.round(expected / 60))} min at this speed, sometimes longer</>}</span>
              )}
            </li>
          ))}
        </ol>
        {!step && <button className="primary">{saved().salt ? 'Continue setup' : 'Start setup'}</button>}
        {step && step !== 'done' && <p className="muted small">Keep this tab open. Progress is saved: if you reload, setup continues where it stopped.</p>}
        <Result msg={msg} />
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- dashboard
function Dashboard({ merchant: m, w, testnet }: { merchant: Merchant, w: ReturnType<typeof useWallet>, testnet: boolean }) {
  const [data, err, refresh] = usePoll(() => api<{ orders: Order[] }>('/orders'), 2500, [])
  const [item, setItem] = useState('')
  const [amount, setAmount] = useState('')
  const [created, setCreated] = useState<Order | null>(null)
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const create = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setFormErr(null)
    try { setCreated(await api<Order>('/orders', { item, amount })); setItem(''); setAmount(''); refresh() } catch (x) { setFormErr((x as Error).message) }
    setBusy(false)
  }
  const orders = data?.orders || []
  const heldTotal = orders.flatMap((o) => o.payments).filter((p) => ['held', 'disputed'].includes(p.status)).reduce((a, p) => a + Number(p.amount), 0)
  const link = (id: number) => `${location.origin}/#/pay/${id}`

  return (
    <div className="dash">
      <section className="summary">
        <div><label>{m.name}</label><a href={addrUrl(m.address)} target="_blank">{short(m.address)}</a></div>
        <div><label>Balance</label><b>{w.balance === null ? '…' : usd(w.balance)}</b></div>
        <div><label>Held for buyers</label><b>{usd(heldTotal)}</b></div>
        <div><label>Protection window</label>{duration(m.window)}</div>
        <div><label>Your arbiter · resolver</label><a href={addrUrl(m.arbiter)} target="_blank">{short(m.arbiter)}</a> · <a href={addrUrl(m.resolver)} target="_blank">{short(m.resolver)}</a></div>
      </section>

      <form className="card neworder" onSubmit={create}>
        <h3>New order</h3>
        <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Item" required />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount (USD)" className="amt" required />
        <button disabled={busy}>{busy ? 'Creating…' : 'Create order'}</button>
        {formErr && <span className="err">{formErr}</span>}
        {created && (
          <p className="created">Order #{created.id} created. Send your buyer this link: <a href={link(created.id)} target="_blank">{link(created.id)}</a>
            {' '}<button type="button" className="ghost small" onClick={() => navigator.clipboard.writeText(link(created.id)).catch(() => {})}>Copy link</button></p>
        )}
      </form>

      {err && <p className="err">{err}</p>}
      {orders.length === 0 && data && <p className="muted">No orders yet. Create one above and send the link to your buyer.</p>}
      {orders.map((o) => <OrderCard key={o.id} order={o} wallet={w.wallet} merchant={m} testnet={testnet} />)}
    </div>
  )
}

function OrderCard({ order: o, wallet, merchant, testnet }: { order: Order, wallet: W.Wallet | null, merchant: Merchant, testnet: boolean }) {
  const now = useNow()
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const main = o.payments.find((p) => !p.wrongToken)
  const wrong = o.payments.filter((p) => p.wrongToken)
  const left = main ? main.windowEndsAt - now : 0
  const status: OrderStatus = o.status === 'held' && main && left <= 0 ? 'releasable' : o.status
  const isMe = wallet?.address.toLowerCase() === merchant.address.toLowerCase()

  // Signed by the merchant's wallet; the contract decides what's allowed.
  const act = async (key: string, fn: W.ArbiterFn, p: Payment, done: string) => {
    if (!wallet) return
    setBusy(key); setMsg(null)
    try { await W.arbiter(wallet, merchant.arbiter, fn, p.receipt as Hex); setMsg({ ok: true, text: done }) } catch (e) { setMsg({ ok: false, text: W.explain(e) }) }
    setBusy(null)
  }
  const B = ({ k, fn, p, label, done, kind = '' }: { k: string, fn: W.ArbiterFn, p: Payment, label: string, done: string, kind?: string }) => (
    <button className={kind} disabled={!!busy || !isMe} onClick={() => act(k, fn, p, done)}>{busy === k ? '…' : label}</button>
  )

  return (
    <div className="card order">
      <div className="row">
        <div className="oid">#{o.id}</div>
        <div className="item">{o.item}</div>
        <div className="amount">{usd(o.amount)}</div>
        <Badge status={status} />
        <a className="buyerlink" href={`#/pay/${o.id}`}>Buyer page →</a>
      </div>
      <div className="meta">
        Pay-to address <code title={o.address}>{short(o.address)}</code>
        {main && <> · paid by <a href={addrUrl(main.payer)} target="_blank">{short(main.payer)}</a> · <a href={txUrl(main.txHash)} target="_blank">payment tx</a></>}
        {o.underpaid && <span className="warn"> · underpaid ({usd(main!.amount)})</span>}
        {status === 'held' && <> · window closes in <b>{countdown(left)}</b></>}
      </div>

      {main && status === 'held' && (
        <div className="actions">
          <B k="refund" fn="refund" p={main} label="Refund buyer" done="Refunded to the buyer." />
          {testnet && <><span className="sep">Test the guarantee:</span>
            <B k="early" fn="release" p={main} label="Try to pay yourself early" done="Unexpected: released." kind="ghost" /></>}
        </div>
      )}
      {main && status === 'releasable' && (
        <div className="actions">
          <B k="release" fn="release" p={main} label="Release to me (window over)" done="Released to you." kind="primary" />
          <B k="refund" fn="refund" p={main} label="Refund buyer" done="Refunded to the buyer." />
        </div>
      )}
      {main && status === 'disputed' && (
        <div className="actions">
          <span className="muted">Disputed: the resolver ({short(merchant.resolver)}) decides. You can still refund the buyer.</span>
          <B k="refund" fn="refund" p={main} label="Refund buyer" done="Refunded to the buyer." />
        </div>
      )}
      {wrong.map((p) => (
        <div className="wrongtoken" key={p.id}>
          ⚠ Wrong token received: {usd(p.amount)} of <code>{short(p.token)}</code> from {short(p.payer)}. Held, not accepted.{' '}
          {p.status === 'held' ? <B k={'w' + p.id} fn="refund" p={p} label="Return to sender" done="Returned to the sender." /> : <b>{p.status === 'refunded' ? 'Returned to sender' : p.status}</b>}
        </div>
      ))}
      {main && main.history.length > 1 && (
        <div className="history">
          {main.history.slice(1).map((h, i) => <span key={i}>{h.status} <a href={txUrl(h.tx)} target="_blank">tx</a>{h.by ? ` by ${short(h.by)}` : ''}</span>)}
        </div>
      )}
      <Result msg={msg} />
    </div>
  )
}
