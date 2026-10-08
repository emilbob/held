// Merchant page (#/merchant): connect a wallet, sign in, set up once (own arbiter + receive policy), then create
// orders and act on them. Every on-chain action is signed by the merchant's own wallet; Held's server holds no keys.
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CountUp, useEntrance } from './anim.tsx'
import type { Address, Hex } from 'viem'
import * as W from './wallet.ts'
import { runSetup, type MiningProgress, type SetupState, type SetupStep } from './setup.ts'
import { api, session, signInWallet, usePoll, useNow, useConfig, useWallet, WalletPicker, Badge, Result, Notes, usd, short, txUrl, addrUrl, countdown, duration, openSandboxResolver, isSandboxShop, type Msg } from './ui.tsx'
import { acceptedTokensOf, NOTE_MAX, NOTES_PER_SIDE, type CheckoutLinkView, type Config, type Merchant, type Order, type OrderStatus, type Payment } from '../../shared/api.ts'

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
      await signInWallet(w.wallet, 'merchant')
      await loadMe()
    } catch (e) { setMsg({ ok: false, text: W.explain(e) }) }
    setSigning(false)
  }

  // The sandbox wallet's key is in the browser anyway, so skip the sign-in click for it.
  useEffect(() => { if (w.wallet?.kind === 'sandbox' && !signedIn && !signing) signIn() }, [w.wallet?.address, signedIn])

  // One steady placeholder while a remembered wallet reconnects or the shop loads, instead of flashing
  // the connect and sign-in screens on the way to the dashboard.
  const autoSignIn = w.wallet?.kind === 'sandbox' && !signedIn && !msg
  if (w.restoring || (signedIn && !me) || autoSignIn) return <Loading />
  if (!w.wallet) return (
    <div className="narrow">
      <div className="card">
        <p className="kicker">For merchants</p>
        <h1>Accept stablecoin payments with buyer protection</h1>
        <p>Connect the wallet that will be your shop's checkout address. Buyers pay it; every payment is held until they
          confirm delivery or the protection window ends. You can refund anytime, and only you and the buyer's wallet ever receive the money.</p>
        <WalletPicker w={w} note="Use a wallet dedicated to your shop: after setup, every payment sent to it is held until released or refunded." />
      </div>
    </div>
  )
  if (!signedIn || !me) return (
    <div className="narrow">
      <div className="card">
        <p className="kicker">For merchants</p>
        <h1>Sign in</h1>
        <WalletPicker w={w} />
        <p className="muted">Sign a message to prove this wallet is yours. It's free and moves no funds.</p>
        <button className="primary" disabled={signing} onClick={signIn}>{signing ? 'Waiting for signature…' : 'Sign in with this wallet'}</button>
        <Result msg={msg} />
      </div>
    </div>
  )
  if (!me.merchant) return cfg && <Setup cfg={cfg} wallet={w.wallet} onDone={loadMe} />
  return <Dashboard merchant={me.merchant} w={w} testnet={!!cfg?.testnet} onChanged={loadMe} />
}

/** "Free until 1 July 2027, then 1% of each released payment (at most $5)." from the network's fee settings. */
function feeText(fee: Config['fee']): string {
  if (!fee.bps) return 'none.'
  const pct = `${fee.bps / 100}% of each released payment${fee.cap !== '0' ? ` (at most ${usd(Number(fee.cap))})` : ''}`
  if (fee.start * 1000 <= Date.now()) return pct[0].toUpperCase() + pct.slice(1) + '.'
  const date = new Date(fee.start * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  return `free until ${date}, then ${pct}.`
}

const Loading = () => <div className="narrow"><div className="card loading" aria-busy="true"><p className="muted">Loading your shop…</p></div></div>

/** A duration picked on a slider that snaps to `steps` (seconds). */
function StepSlider({ id, label, steps, value, onChange, disabled }: { id: string, label: string, steps: number[], value: number, onChange: (s: number) => void, disabled?: boolean }) {
  // A value between stops (e.g. a network default) shows at the nearest stop.
  const at = steps.reduce((best, s, i) => (Math.abs(s - value) < Math.abs(steps[best] - value) ? i : best), 0)
  return (
    <div className="stepslider">
      <label htmlFor={id}>{label}: <b className="ink">{duration(steps[at])}</b></label>
      <input id={id} type="range" min={0} max={steps.length - 1} step={1} value={at} disabled={disabled}
        aria-valuetext={duration(steps[at])} onChange={(e) => onChange(steps[Number(e.target.value)])} />
      <div className="ends muted small"><span>{duration(steps[0])}</span><span>{duration(steps[steps.length - 1])}</span></div>
    </div>
  )
}

const PAGE = 20
type OrderFilter = 'action' | 'unpaid' | 'settled' | 'all'
const FILTERS: [OrderFilter, string][] = [['action', 'Needs action'], ['unpaid', 'Awaiting payment'], ['settled', 'Settled'], ['all', 'All']]

// ---------------------------------------------------------------- one-time setup
const STEPS: [SetupStep, string][] = [
  ['mine', 'Create your checkout address (proof of work in this browser)'],
  ['register', 'Register it on Tempo (1 transaction)'],
  ['deploy', 'Deploy your own Held arbiter contract (1 transaction)'],
  ['policy', 'Hold incoming payments for that arbiter (1 transaction)'],
]

// New shop: all four steps. `current` set: the shop changes its settings, which deploys a new arbiter for new payments
// (steps 3-4 only; same checkout address, same locked fee). Both end with a review before anything is deployed.
function Setup({ cfg, wallet, onDone, current, onCancel }: { cfg: Config, wallet: W.Wallet, onDone: () => void, current?: Merchant, onCancel?: () => void }) {
  const saveKey = `held.setup.${wallet.address.toLowerCase()}${current ? '.change' : ''}`
  const saved = (): SetupState => {
    let s: SetupState = {}
    try { s = JSON.parse(localStorage.getItem(saveKey) || '{}') } catch {}
    return current ? { ...s, masterId: current.masterId } : s
  }
  const fee = current?.fee ?? cfg.fee // a shop keeps the fee it was set up with
  const [name, setName] = useState('')
  const [review, setReview] = useState(false)
  // Slider stops (seconds). Testnet starts in minutes so the whole flow can be tried quickly.
  const H = 3600, D = 86400
  const windows = cfg.testnet ? [300, 600, 1800, H, 6 * H, 12 * H, D, 2 * D, 3 * D, 5 * D, 7 * D, 10 * D, 14 * D]
    : [D, 2 * D, 3 * D, 5 * D, 7 * D, 10 * D, 14 * D, 21 * D, 30 * D]
  const [window, setWindow] = useState(current?.window ?? cfg.defaultWindow)
  // The resolver's deadline (contract v3): undecided disputes refund the buyer after it. Testnet offers a short one to try it.
  const resolveWindows = cfg.testnet ? [600, 1800, H, 6 * H, 12 * H, D, 2 * D, 3 * D, 5 * D, 7 * D, 14 * D]
    : [D, 2 * D, 3 * D, 5 * D, 7 * D, 10 * D, 14 * D, 21 * D, 30 * D]
  const [resolveWindow, setResolveWindow] = useState(current?.resolveWindow ?? cfg.defaultResolveWindow)
  const [resolver, setResolver] = useState<string>(current?.resolver ?? cfg.defaultResolver)
  const [step, setStep] = useState<SetupStep | null>(null)
  const [mining, setMining] = useState<MiningProgress | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])

  const start = async (e: FormEvent) => {
    e.preventDefault(); setMsg(null)
    if (!/^0x[0-9a-fA-F]{40}$/.test(resolver)) return setMsg({ ok: false, text: 'The resolver must be a wallet address (0x…).' })
    if (!review) { setReview(true); return } // first press: show what gets written into the contract
    setReview(false)
    abort.current = new AbortController()
    try {
      // Changing settings: re-check right before the first transaction that nothing is held (the server refuses then,
      // and a deployed-but-refused arbiter would leave new payments held for a contract Held doesn't list).
      if (current) {
        const { orders } = await api<{ orders: Order[] }>('/orders')
        if (orders.some((o) => o.payments.some((p) => p.status === 'held' || p.status === 'disputed')))
          throw new Error('Some of your payments are still held. Release or refund them first: they keep the settings they were paid under.')
      }
      const r = await runSetup({ wallet, pub: W.pub as never, resolver: resolver as Address, tokens: cfg.tokens.map((t) => t.address), window, resolveWindow, fee, state: saved(),
        save: (s) => localStorage.setItem(saveKey, JSON.stringify(s)), onStep: setStep, onProgress: setMining, signal: abort.current.signal })
      await api('/merchants', { name: current ? current.name : name || 'My shop', arbiter: r.arbiter, masterId: r.masterId })
      localStorage.removeItem(saveKey)
      onDone()
    } catch (x) { setMsg({ ok: false, text: W.explain(x) }); setStep(null) }
  }

  const steps = current ? STEPS.filter(([s]) => s === 'deploy' || s === 'policy') : STEPS
  const at = step ? steps.findIndex(([s]) => s === step) : -1
  const locked = !!step || review
  const expected = mining && mining.rate > 0 ? 2 ** 32 / mining.rate : 0
  return (
    <div className="narrow">
      <form className="card setup" onSubmit={start}>
        <p className="kicker">For merchants{current ? ` · ${current.name}` : ''}</p>
        <h1>{current ? 'Change shop settings' : 'Set up your shop'}</h1>
        {current
          ? <p className="muted">These settings are written into your arbiter contract, so changing them deploys a new one for your next payments
              (2 transactions, a few cents). Payments made before keep the settings they were paid under. Your checkout address and your fee stay the same.</p>
          : <p className="muted">One time, from your wallet ({short(wallet.address)}). Your checkout address and your own arbiter contract: Held's server never holds your keys or your funds.</p>}
        {!current && <>
          <label htmlFor="shopname">Shop name</label>
          <input id="shopname" value={name} onChange={(e) => setName(e.target.value)} placeholder="My shop" maxLength={60} disabled={locked} />
        </>}
        <StepSlider id="window" label="Protection window (how long buyers can dispute)" steps={windows} value={window} onChange={setWindow} disabled={locked} />
        <StepSlider id="resolve" label="Resolver's deadline (how long disputes can take)" steps={resolveWindows} value={resolveWindow} onChange={setResolveWindow} disabled={locked} />
        <p className="muted small">If the resolver hasn't decided a dispute by then, the buyer gets their money back. Buyers see this deadline at checkout.</p>
        <details>
          <summary>Resolver (who decides disputes)</summary>
          <p className="muted small">Held's resolver by default. It can only refund the buyer or pay you, never anything else.</p>
          <input value={resolver} onChange={(e) => setResolver(e.target.value.trim())} aria-label="Resolver address" disabled={locked} />
        </details>
        <p className="muted small feeline"><b>Held's fee:</b> {feeText(fee)} Refunds are always free. It's written into your
          contract at setup, so Held can never raise it.</p>
        {review && (
          <div className="review">
            <p><b>Check before deploying.</b> These are written into your contract and can't be edited afterwards
              {current ? ' (you can change them again later, with a new contract)' : ' (you can change them later from your dashboard, with a new contract)'}:</p>
            <ul>
              <li>Protection window: <b>{duration(window)}</b></li>
              <li>Resolver's deadline: <b>{duration(resolveWindow)}</b></li>
              <li>Resolver: <b>{resolver.toLowerCase() === cfg.defaultResolver.toLowerCase() ? `Held's resolver (${short(resolver)})` : short(resolver)}</b></li>
              <li>Held's fee: <b>{feeText(fee)}</b></li>
            </ul>
          </div>
        )}
        <ol className="setupsteps">
          {steps.map(([s, label], i) => (
            <li key={s} className={i < at || step === 'done' ? 'done' : i === at ? 'now' : ''}>
              {label}
              {s === 'mine' && step === 'mine' && mining && (
                <span className="muted small"> · {(mining.attempts / 1e6).toFixed(0)}M tries at {(mining.rate / 1e6).toFixed(1)}M/s
                  {expected > 0 && <> · usually ~{Math.max(1, Math.round(expected / 60))} min at this speed, sometimes longer</>}</span>
              )}
            </li>
          ))}
        </ol>
        {!step && (
          <div className="row">
            <button className="primary">{review ? (current ? 'Deploy new settings' : 'Looks right: start setup') : current ? 'Review changes' : saved().salt ? 'Continue setup' : 'Review and start setup'}</button>
            {review && <button type="button" className="ghost" onClick={() => setReview(false)}>Back to edit</button>}
            {!review && onCancel && <button type="button" className="ghost" onClick={onCancel}>Cancel</button>}
          </div>
        )}
        {step && step !== 'done' && <p className="muted small">Keep this tab open. Progress is saved: if you reload, setup continues where it stopped.</p>}
        <Result msg={msg} />
      </form>
    </div>
  )
}

// ---------------------------------------------------------------- dashboard
function Dashboard({ merchant: m, w, testnet, onChanged }: { merchant: Merchant, w: ReturnType<typeof useWallet>, testnet: boolean, onChanged: () => void }) {
  const cfg = useConfig()
  const [data, err, refresh] = usePoll(() => api<{ orders: Order[] }>('/orders'), 2500, [])
  const [changing, setChanging] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEntrance(root, '.summary > div, :scope > .card, .ordercard', data !== null, { stagger: 0.05 })
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
  // Orders a merchant should look at: held or releasable (can release/refund), disputed, or a wrong token to return.
  const needsAction = (o: Order) => ['held', 'releasable', 'disputed'].includes(o.status) || o.payments.some((p) => p.wrongToken && p.status === 'held')
  const groups: Record<OrderFilter, Order[]> = {
    action: orders.filter(needsAction),
    unpaid: orders.filter((o) => o.status === 'awaiting_payment' && !needsAction(o)),
    settled: orders.filter((o) => o.status === 'released' || o.status === 'refunded'),
    all: orders,
  }
  const [filter, setFilter] = useState<OrderFilter>('all')
  // Long lists: the newest PAGE orders first, then "Show more" (new orders arrive at the top, so no numbered pages).
  const [limit, setLimit] = useState(PAGE)
  const all = groups[filter]
  const shown = all.slice(0, limit)
  const more = Math.min(PAGE, all.length - shown.length)
  const heldTotal = orders.flatMap((o) => o.payments).filter((p) => ['held', 'disputed'].includes(p.status)).reduce((a, p) => a + Number(p.amount), 0)
  const link = (o: Order) => `${location.origin}/#/pay/${o.key ?? o.id}`
  const showTokens = () => { if (w.wallet) W.showTokensInWallet(w.wallet, acceptedTokensOf(m)).catch(() => {}) }
  // Draw the dashboard once its orders are in: drawing the shell first made the entrance replay over it ("refresh").
  if (data === null && !err) return <Loading />
  // Settings change only while nothing is held: every held payment stays with the arbiter it was paid under.
  const stillHeld = orders.flatMap((o) => o.payments).some((p) => p.status === 'held' || p.status === 'disputed')
  const sandbox = w.wallet?.kind === 'sandbox'
  if (changing && cfg && w.wallet) return <Setup cfg={cfg} wallet={w.wallet} current={m} onCancel={() => setChanging(false)} onDone={() => { setChanging(false); onChanged() }} />

  return (
    <div className="dash" ref={root}>
      <p className="kicker">For merchants · {m.name} dashboard</p>
      <h1 className="sr-only">{m.name} dashboard</h1>
      {w.wallet?.kind === 'sandbox'
        ? <div className="resolvecall top">
            <p><b>This is the shared Sandbox Shop.</b> Everyone trying Held uses it, with public test keys.</p>
            <button className="primary" onClick={w.disconnect}>Set up your own shop →</button>
          </div>
        : <p className="askfb top">Held is in beta: your feedback decides what we build next. <a href="#/feedback">Tell us what you need</a></p>}
      <section className="summary">
        <div><label>{m.name}</label><a href={addrUrl(m.address)} target="_blank">{short(m.address)}</a></div>
        <div><label>Balance</label><b>{w.balance === null ? '…' : <CountUp value={Number(w.balance)} format={usd} />}</b>
          {w.wallet?.kind === 'injected' && <button type="button" className="ghost small showtokens" onClick={showTokens}>See it in {w.wallet.name}</button>}</div>
        <div><label>Held for buyers</label><b><CountUp value={heldTotal} format={usd} /></b></div>
        <div><label>Protection window</label>{duration(m.window)}</div>
        {m.resolveWindow ? <div><label>Resolver's deadline</label>{duration(m.resolveWindow)}</div> : null}
        <div><label>Your arbiter</label><a href={addrUrl(m.arbiter)} target="_blank">{short(m.arbiter)}</a></div>
        <div><label>Resolver</label><a href={addrUrl(m.resolver)} target="_blank">{short(m.resolver)}</a></div>
      </section>
      {/* The sandbox's settings are shared by everyone trying it, so they stay as they are. */}
      {!sandbox && (
        <p className="settingsline muted small">
          <button type="button" className="ghost small" disabled={stillHeld} onClick={() => setChanging(true)}>Change settings</button>
          {stillHeld ? ' Release or refund your held payments first: they keep the settings they were paid under.' : ' Protection window, resolver deadline or resolver, for your next payments.'}
        </p>
      )}

      <form className="card neworder" onSubmit={create}>
        <div className="nohead"><h2>New order</h2><span className="muted small">For one buyer: send them its buyer page</span></div>
        <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Item" aria-label="Item" required />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Price (USD, total)" aria-label="Price in USD, the total the buyer pays" inputMode="decimal" className="amt" required />
        <button disabled={busy}>{busy ? 'Creating…' : 'Create order'}</button>
        {formErr && <span className="err">{formErr}</span>}
        {created && (
          <p className="created"><span>Order #{created.id} created. Send your buyer this link: <a href={link(created)} target="_blank">{link(created)}</a></span>
            <button type="button" className="ghost small" onClick={() => navigator.clipboard.writeText(link(created)).catch(() => {})}>Copy link</button></p>
        )}
      </form>

      <Links />

      {err && <p className="err">{err}</p>}
      <section className="orders" aria-labelledby="orders-title">
        <div className="orders-head">
          <h2 id="orders-title">Orders</h2>
          <div className="chips" role="group" aria-label="Show orders">
            {FILTERS.map(([k, label]) => (
              <button key={k} className={`chip ${filter === k ? 'on' : ''} ${k === 'action' && groups.action.length ? 'attention' : ''}`}
                aria-pressed={filter === k} onClick={() => { setFilter(k); setLimit(PAGE) }}>{label} <span>{groups[k].length}</span></button>
            ))}
          </div>
        </div>
        {data && orders.length === 0 && <p className="muted">No orders yet. Create one above, or make a checkout link, and send it to your buyer.</p>}
        {data && orders.length > 0 && shown.length === 0 && <p className="muted">Nothing here right now.</p>}
        {shown.map((o) => <OrderCard key={o.id} order={o} wallet={w.wallet} merchant={m} testnet={testnet} />)}
        {more > 0 && (
          <div className="more">
            <span className="muted small">Showing {shown.length} of {all.length}</span>
            <button className="secondary" onClick={() => setLimit(limit + PAGE)}>Show {more} more</button>
          </div>
        )}
      </section>
    </div>
  )
}

function OrderCard({ order: o, wallet, merchant, testnet }: { order: Order, wallet: W.Wallet | null, merchant: Merchant, testnet: boolean }) {
  const cfg = useConfig()
  const now = useNow()
  const [msg, setMsg] = useState<Msg>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const main = o.payments.find((p) => !p.wrongToken)
  const wrong = o.payments.filter((p) => p.wrongToken)
  const left = main ? main.windowEndsAt - now : 0
  const status: OrderStatus = o.status === 'held' && main && left <= 0 ? 'releasable' : o.status
  const isMe = wallet?.address.toLowerCase() === merchant.address.toLowerCase()
  const [copied, setCopied] = useState(false)
  const copyLink = () => navigator.clipboard.writeText(`${location.origin}/#/pay/${o.key ?? o.id}`)
    .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => {})

  // Signed by the merchant's wallet; the contract decides what's allowed.
  const act = async (key: string, fn: W.ArbiterFn, p: Payment, done: string) => {
    if (!wallet) return
    setBusy(key); setMsg(null)
    try { await W.arbiter(wallet, p.arbiter ?? merchant.arbiter, fn, p.receipt as Hex, acceptedTokensOf(merchant)); setMsg({ ok: true, text: done }) } catch (e) { setMsg({ ok: false, text: W.explain(e) }) }
    setBusy(null)
  }
  const B = ({ k, fn, p, label, done, kind = '' }: { k: string, fn: W.ArbiterFn, p: Payment, label: string, done: string, kind?: string }) => (
    <button className={kind} disabled={!!busy || !isMe} onClick={() => act(k, fn, p, done)}>{busy === k ? '…' : label}</button>
  )

  return (
    <div className="card order ordercard">
      <div className="row">
        <div className="oid">#{o.id}</div>
        <div className="item">{o.item}</div>
        <div className="amount">{usd(o.amount)}</div>
        <Badge status={status} />
        {/* Sandbox: one person plays every role, so jump to the buyer page. A real shop sends the link to its buyer
            instead; opening it here would put merchant and buyer in one window. */}
        {isSandboxShop(cfg, merchant.address)
          ? <a className="buyerlink" href={`#/pay/${o.key ?? o.id}`}>Buyer page →</a>
          : <button type="button" className="ghost small buyerlink" onClick={copyLink}>{copied ? 'Copied ✓' : 'Copy buyer link'}</button>}
      </div>
      <div className="meta">
        {o.linkId && <>From checkout link · </>}Pay-to address <code title={o.address}>{short(o.address)}</code>
        {main && <> · paid by <a href={addrUrl(main.payer)} target="_blank">{short(main.payer)}</a> · <a href={txUrl(main.txHash)} target="_blank">payment tx</a></>}
        {o.underpaid && <span className="warn"> · underpaid ({usd(main!.amount)})</span>}
        {main?.status === 'released' && main.fee && BigInt(main.fee) > 0n &&
          <> · you received <b>{usd(BigInt(main.amount) - BigInt(main.fee))}</b> (Held's fee {usd(main.fee)})</>}
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
          <span className="muted">Disputed: the resolver ({short(merchant.resolver)}) decides
            {main.resolveBy ? (main.deadlinePassed ? '. Their deadline has passed, so the buyer gets a refund.' : <> within <b className="ink">{countdown(main.resolveBy - now)}</b>, or the buyer is refunded</> ) : ''}.
            {' '}Agree with the buyer? <b className="ink">Refund buyer</b> ends the dispute right away.</span>
          <B k="refund" fn="refund" p={main} label="Refund buyer" done="Refunded to the buyer." />
          {isSandboxShop(cfg, merchant.address) && <button className="primary" onClick={openSandboxResolver}>Decide as the resolver →</button>}
          <Notes notes={o.notes?.[main.id]} me="merchant" />
          {!o.notes?.[main.id]?.length && <p className="muted small">The buyer didn't leave a note.</p>}
          {(o.notes?.[main.id] ?? []).filter((n) => n.by === 'merchant').length < NOTES_PER_SIDE ? (
            <form className="replyform" onSubmit={async (e) => {
              e.preventDefault(); setMsg(null)
              try { await api('/notes', { paymentId: main.id, text: reply }); setReply(''); setMsg({ ok: true, text: 'Your reply was sent to the buyer and the resolver.' }) }
              catch (x) { setMsg({ ok: false, text: (x as Error).message }) }
            }}>
              <label htmlFor={'reply' + o.id} className="muted small">Your side, for the buyer and the resolver (e.g. tracking number,
                {' '}{NOTES_PER_SIDE - (o.notes?.[main.id] ?? []).filter((n) => n.by === 'merchant').length} left):</label>
              <textarea id={'reply' + o.id} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={NOTE_MAX} rows={2} />
              <button className="small" disabled={!reply.trim()}>Send reply</button>
            </form>
          ) : <p className="muted small">You've sent the maximum of {NOTES_PER_SIDE} replies. The resolver will decide.</p>}
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

// ---------------------------------------------------------------- checkout links + "Pay with Held" button
const linkUrl = (id: string) => `${location.origin}/#/buy/${id}`
// Plain HTML with inline styles and no script, so it works on any website builder. Only stable public paths.
export const buttonHtml = (id: string, amount: string) =>
  `<a href="${linkUrl(id)}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:10px;padding:12px 20px;` +
  `border-radius:10px;background:#0b0d10;border:1px solid #D5F94F;color:#fff;font:600 15px/1.2 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;` +
  `text-decoration:none"><img src="${location.origin}/held-favicon.png" width="20" height="20" alt="" style="display:block">` +
  `Pay ${usd(amount)} with Held<span style="font-weight:400;font-size:12px;color:#D5F94F">buyer protected</span></a>`

function Links() {
  const [data, err, refresh] = usePoll(() => api<{ links: CheckoutLinkView[] }>('/links'), 5000, [])
  const [item, setItem] = useState('')
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null) // link id waiting for "Remove for good?"
  const copy = (key: string, text: string) => navigator.clipboard.writeText(text)
    .then(() => { setCopied(key); setTimeout(() => setCopied(null), 1800) }, () => setCopied('failed'))

  const create = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setFormErr(null)
    try { await api('/links', { item, amount }); setItem(''); setAmount(''); refresh() } catch (x) { setFormErr((x as Error).message) }
    setBusy(false)
  }
  const toggle = async (l: CheckoutLinkView) => { await api(`/links/${l.id}`, { active: !l.active }).catch(() => {}); refresh() }
  const remove = async (l: CheckoutLinkView) => { await api(`/links/${l.id}`, { removed: true }).catch(() => {}); setRemoving(null); refresh() }
  const links = data?.links ?? []

  const renderLink = (l: CheckoutLinkView) => (
    <div key={l.id} className={`link ${l.active ? '' : 'off'}`}>
      <div className="row">
        <div className="item">{l.item}</div>
        <div className="amount">{usd(l.amount)}</div>
        <span className="muted small">{l.orders} order{l.orders === 1 ? '' : 's'} · {l.paid} paid</span>
        <button className="ghost small" onClick={() => toggle(l)}>{l.active ? 'Turn off' : 'Turn on'}</button>
        <button className="ghost small" onClick={() => setRemoving(l.id)}>Remove</button>
      </div>
      {removing === l.id && (
        <div className="removeask">
          <span className="small">Remove this link for good? Buyers who open it will see it's no longer available. Its orders stay in your Orders list.</span>
          <button className="danger small" onClick={() => remove(l)}>Remove link</button>
          <button className="ghost small" onClick={() => setRemoving(null)}>Cancel</button>
        </div>
      )}
      {l.active ? (
        <>
          <code className="addr">{linkUrl(l.id)}</code>
          <div className="actions">
            <button className="small" onClick={() => copy('url' + l.id, linkUrl(l.id))}>{copied === 'url' + l.id ? 'Copied ✓' : 'Copy link'}</button>
            <button className="small" onClick={() => copy('btn' + l.id, buttonHtml(l.id, l.amount))}>{copied === 'btn' + l.id ? 'Copied ✓' : 'Copy button code'}</button>
            {/* Only a picture of the button: clicking it here would make the merchant a buyer and create a new order. */}
            <span className="preview" title="Preview of the button for your website" aria-hidden="true" inert dangerouslySetInnerHTML={{ __html: buttonHtml(l.id, l.amount) }} />
          </div>
          {copied === 'failed' && <p className="muted small">Couldn't copy: select the link above instead.</p>}
        </>
      ) : <p className="muted small">Turned off: buyers who open it see that it's no longer available.</p>}
    </div>
  )

  return (
    <section className="card links">
      <h2>Checkout links</h2>
      <p className="muted small"><b className="ink">One link for many buyers.</b> A reusable link for one product at a fixed price. Every buyer who opens it gets their own protected order.
        Share it anywhere, or put the "Pay with Held" button on your website.</p>
      <form className="neworder" onSubmit={create}>
        <input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Product" aria-label="Product" required />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Price (USD)" aria-label="Price in USD" inputMode="decimal" className="amt" required />
        <button disabled={busy}>{busy ? 'Creating…' : 'Create link'}</button>
        {formErr && <span className="err">{formErr}</span>}
      </form>
      {err && <p className="err">{err}</p>}
      {links.filter((l) => l.active).map(renderLink)}
      {links.some((l) => !l.active) && (
        <details className="offlinks">
          <summary>Turned off ({links.filter((l) => !l.active).length})</summary>
          {links.filter((l) => !l.active).map(renderLink)}
        </details>
      )}
    </section>
  )
}
