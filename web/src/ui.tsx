// Shared UI: API client (with the merchant session), formatting, polling hooks, status badges and the wallet picker.
import { useEffect, useRef, useState, type DependencyList } from 'react'
import { Scramble } from './anim.tsx'
import type { Address, Hex } from 'viem'
import * as W from './wallet.ts'
import { signInMessage, type Config, type Note, type OrderStatus } from '../../shared/api.ts'

// ---------------------------------------------------------------- session + API
// Sessions from wallet sign-in, one per role, so one browser can be a shop's merchant and its resolver at once
// (the sandbox). Buyers never need one.
export interface StoredSession { token: string, address: Address }
export type SessionRole = 'merchant' | 'resolver'
const sessionKey = (role: SessionRole) => (role === 'merchant' ? 'held.session' : `held.session.${role}`)
export const session = {
  get(role: SessionRole = 'merchant'): StoredSession | null { try { return JSON.parse(localStorage.getItem(sessionKey(role)) || 'null') } catch { return null } },
  set(s: StoredSession | null, role: SessionRole = 'merchant') { try { s ? localStorage.setItem(sessionKey(role), JSON.stringify(s)) : localStorage.removeItem(sessionKey(role)) } catch {} },
}
// Sign in a wallet for a role: it signs a plain message (no transaction, no funds).
export async function signInWallet(wallet: W.Wallet, role: SessionRole) {
  const issued = Math.floor(Date.now() / 1000)
  const signature = await W.signMessage(wallet, signInMessage(wallet.address, location.host, issued))
  const r = await api<StoredSession>('/auth', { address: wallet.address, issued, signature })
  session.set(r, role)
  return r
}
export const api = async <T,>(path: string, body?: unknown, role: SessionRole = 'merchant'): Promise<T> => {
  const token = session.get(role)?.token
  const r = await fetch('/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json()
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status })
  return j as T
}
let configP: Promise<Config> | null = null
export const getConfig = () => (configP ??= api<Config>('/config'))

// ---------------------------------------------------------------- formatting
export const usd = (base: string | bigint | number) => (Number(base) / 1e6).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
export const short = (a?: string) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '')
export const txUrl = (h: Hex) => `${W.explorer}/tx/${h}`
export const addrUrl = (a: Address) => `${W.explorer}/address/${a}`
export const countdown = (secs: number) => {
  if (secs <= 0) return '0:00'
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, '0')}`
}
export const duration = (secs: number) =>
  secs % 86400 === 0 ? `${secs / 86400} day${secs === 86400 ? '' : 's'}` : secs % 3600 === 0 ? `${secs / 3600} hour${secs === 3600 ? '' : 's'}` : `${Math.round(secs / 60)} minutes`

// ---------------------------------------------------------------- hooks
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: DependencyList): [T | null, string | null, () => void] {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    const tick = () => fn().then((d) => live && (setData(d), setError(null)), (e: Error) => live && setError(e.message))
    tick()
    const t = setInterval(tick, ms)
    return () => { live = false; clearInterval(t) }
  }, [...deps, n])
  return [data, error, () => setN((x) => x + 1)]
}
export function useNow() {
  const [now, setNow] = useState(Math.floor(Date.now() / 1000))
  useEffect(() => { const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000); return () => clearInterval(t) }, [])
  return now
}
export function useConfig() {
  const [cfg, setCfg] = useState<Config | null>(null)
  useEffect(() => { getConfig().then(setCfg, () => {}) }, [])
  return cfg
}

// ---------------------------------------------------------------- status
const STATUS: Record<OrderStatus, [label: string, color: string]> = {
  awaiting_payment: ['Awaiting payment', 'grey'],
  held: ['Held: protected', 'lime'],
  releasable: ['Window over: releasable', 'amber'],
  disputed: ['Disputed', 'red'],
  released: ['Paid to merchant', 'green'],
  refunded: ['Refunded to buyer', 'violet'],
}
// A status change is an event: the label decodes into place and the badge pulses once.
export const Badge = ({ status }: { status: OrderStatus }) => {
  const [label, color] = STATUS[status] ?? [status, 'grey']
  const prev = useRef(status)
  const [changed, setChanged] = useState(false)
  useEffect(() => {
    if (prev.current === status) return
    prev.current = status
    setChanged(true)
    const t = setTimeout(() => setChanged(false), 900)
    return () => clearTimeout(t)
  }, [status])
  return <span className={`badge ${color}${changed ? ' changed' : ''}`}><Scramble text={label} ms={500} /></span>
}

// Buyer progress: pay -> held until delivery -> settled (paid to merchant or refunded).
export function Steps({ status }: { status: OrderStatus }) {
  const at = status === 'awaiting_payment' ? 0 : status === 'released' || status === 'refunded' ? 3 : 1
  const labels = ['Pay', status === 'disputed' ? 'Disputed' : 'Held until delivery',
    status === 'refunded' ? 'Refunded' : status === 'released' ? 'Paid to merchant' : 'Settled']
  return (
    <ol className="steps" aria-label="Payment progress">
      {labels.map((l, i) => (
        <li key={i} className={`${i < at ? 'done' : i === at ? 'now' : ''} ${i === 1 && status === 'disputed' ? 'dispute' : ''}`}
          aria-current={i === at ? 'step' : undefined}>{l}</li>
      ))}
    </ol>
  )
}

// Result line under an action. A busy testnet RPC is not a rule violation, so it gets no lock.
export type Msg = { ok: boolean, text: string } | null
export const Result = ({ msg }: { msg: Msg }) => msg &&
  <div className={`result ${msg.ok ? 'ok' : 'blocked'}`} role="status" aria-live="polite">{msg.ok || msg.text.startsWith("Tempo's testnet is busy") ? '' : '🔒 '}{msg.text}</div>

// ---------------------------------------------------------------- wallet
// One wallet per role and page. A remembered test wallet reconnects by itself; other wallets ask again.
/** Sandbox only: open the resolver console as the sandbox's shared test resolver. */
export const openSandboxResolver = () => {
  try { localStorage.setItem('held.walletKind.resolver', 'sandbox') } catch {}
  location.hash = '#/resolve'
}
export const isSandboxShop = (cfg: Config | null, merchant: string) =>
  !!cfg?.testnet && !!cfg.sandbox?.merchant && cfg.sandbox.merchant.toLowerCase() === merchant.toLowerCase()

export function useWallet(role: W.Role) {
  const cfg = useConfig()
  const rememberKey = role === 'buyer' ? 'held.walletKind' : `held.walletKind.${role}`
  const [wallet, setWallet] = useState<W.Wallet | null>(null)
  // Per stablecoin of this network (lowercase address -> base units), and their total.
  const [balances, setBalances] = useState<Record<string, bigint> | null>(null)
  const balance = balances ? Object.values(balances).reduce((a, b) => a + b, 0n) : null
  const [installed, setInstalled] = useState<W.InjectedWallet[]>([])
  const [busy, setBusy] = useState(false)
  const [toppingUp, setToppingUp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => W.watchWallets(setInstalled), [])
  // Testnet: top up a freshly connected wallet so trying Held never stalls on an empty balance. "Adding free test
  // funds" shows from the first moment (not a false "$0.00, add funds" warning), and stays until the funds are
  // actually visible: the faucet answers before the balance poll would notice.
  const topUp = async (w: W.Wallet) => {
    if (!(await getConfig()).testnet) return
    setToppingUp(true)
    try {
      if ((await W.tokenBalance(w.address)) >= 1_000_000n) return
      await api('/faucet', { address: w.address }).catch(() => {})
      const tokens = W.NET.tokens.map((t) => t.address)
      for (let i = 0; i < 12; i++) {
        const b = await W.tokenBalances(w.address, tokens).catch(() => null)
        if (b) {
          setBalances(Object.fromEntries(tokens.map((t, j) => [t.toLowerCase(), b[j]])))
          if (b.some((x) => x >= 1_000_000n)) return
        }
        await new Promise((r) => setTimeout(r, 1500))
      }
    } finally { setToppingUp(false) }
  }
  const sandboxKey = async () => {
    const sb = (await getConfig()).sandbox
    return role === 'merchant' ? sb?.merchantKey : role === 'resolver' ? sb?.resolverKey : undefined
  }
  // A browser wallet (MetaMask) or Tempo Wallet also remembers which one and which account, to reconnect it quietly
  // on reload or on the next page (connected on the landing, used on the dashboard).
  const injectedKey = `${rememberKey}.injected`
  // True while a remembered wallet reconnects, so pages don't flash "connect a wallet" first.
  const [restoring, setRestoring] = useState(() => ['demo', 'sandbox', 'injected', 'tempo'].includes(localStorage.getItem(rememberKey) ?? ''))
  useEffect(() => {
    const k = localStorage.getItem(rememberKey)
    const done = () => setRestoring(false)
    if (k === 'injected' || k === 'tempo') {
      let saved: { rdns: string, address: string } | null = null
      try { saved = JSON.parse(localStorage.getItem(injectedKey) || 'null') } catch {}
      if (!saved) done()
      else (k === 'tempo' ? W.reconnectTempo(saved.address) : W.reconnectInjected(saved.rdns, saved.address))
        .then((w) => { if (w) { setWallet(w); topUp(w) } }, () => {}).finally(done)
    }
    if (k === 'demo') W.connect('demo', undefined, role).then((w) => { setWallet(w); topUp(w) }).finally(done)
    if (k === 'sandbox') sandboxKey().then((key) => W.connect('sandbox', undefined, role, key)).then((w) => { setWallet(w); topUp(w) }, () => localStorage.removeItem(rememberKey)).finally(done)
  }, [])
  useEffect(() => {
    if (!wallet) return
    const tokens = W.NET.tokens.map((t) => t.address)
    const f = () => W.tokenBalances(wallet.address, tokens).then((b) => setBalances(Object.fromEntries(tokens.map((t, i) => [t.toLowerCase(), b[i]])))).catch(() => {})
    f(); const t = setInterval(f, 4000); return () => clearInterval(t)
  }, [wallet?.address])
  const connect = async (kind: W.WalletKind, injected?: W.InjectedWallet) => {
    setBusy(true); setError(null)
    try {
      const w = await W.connect(kind, injected, role, kind === 'sandbox' ? await sandboxKey() : undefined)
      localStorage.setItem(rememberKey, kind)
      if (kind === 'injected' || kind === 'tempo') localStorage.setItem(injectedKey, JSON.stringify({ rdns: kind === 'tempo' ? 'tempo' : injected?.rdns ?? 'injected', address: w.address }))
      setWallet(w)
      await topUp(w)
    } catch (e) { setError(W.explain(e)) }
    setBusy(false)
  }
  const disconnect = () => { localStorage.removeItem(rememberKey); localStorage.removeItem(injectedKey); setWallet(null); setBalances(null) }
  // External wallets: if the wallet disconnects or switches to another account, drop the stale connection so the
  // page asks again instead of failing on the next action.
  useEffect(() => {
    const p = wallet?.provider
    if (!p) return
    const onAccounts = (accs: readonly string[]) => {
      if (!accs.length || accs[0].toLowerCase() !== wallet.address.toLowerCase()) {
        disconnect(); setError('Your wallet disconnected or switched accounts. Connect it again.')
      }
    }
    const onDisconnect = () => { disconnect(); setError('Your wallet disconnected. Connect it again.') }
    p.on('accountsChanged', onAccounts)
    p.on('disconnect', onDisconnect)
    return () => { p.removeListener('accountsChanged', onAccounts); p.removeListener('disconnect', onDisconnect) }
  }, [wallet])
  return { wallet, restoring, balance, balances, toppingUp, installed, busy, error, connect, disconnect, testnet: !!cfg?.testnet, role }
}

/** Which wallets a picker offers: 'test' only the test wallet in this browser (paying the sandbox shop), 'real' only
 *  Tempo Wallet and browser wallets (paying a real shop), 'any' both (test wallet on testnet only). */
export type WalletChoice = 'any' | 'test' | 'real'
export const walletFits = (kind: W.WalletKind, choice: WalletChoice) =>
  choice === 'any' || (choice === 'test' ? kind === 'demo' : kind === 'tempo' || kind === 'injected')

export function WalletPicker({ w, note, choice = 'any' }: { w: ReturnType<typeof useWallet>, note?: string, choice?: WalletChoice }) {
  // A connected wallet of a kind this picker doesn't offer (e.g. a test wallet on a real shop) counts as none.
  if (w.wallet && walletFits(w.wallet.kind, choice)) return (
    <p className="walletline"><a href={addrUrl(w.wallet.address)} target="_blank">{short(w.wallet.address)}</a> · {w.balance === null ? '…' : usd(w.balance)} {W.NET.tokens.length > 1 ? 'in stablecoins' : W.NET.tokens[0].symbol}
      <span className="muted"> ({w.wallet.name})</span>
      {' '}<button className="secondary small" onClick={w.disconnect}>Change wallet</button></p>
  )
  return (
    <div className="actions picker">
      {/* No sandbox button here: the sandbox is entered only from #/sandbox, so a real merchant or resolver is never
          steered into the shared test shop. */}
      {choice !== 'test' && <>
        <button className="primary" onClick={() => w.connect('tempo')} disabled={w.busy}>{w.busy ? 'Connecting…' : 'Tempo Wallet'}</button>
        {w.installed.map((iw) => (
          <button key={iw.rdns} className="ghost" onClick={() => w.connect('injected', iw)} disabled={w.busy}>
            {iw.icon && <img src={iw.icon} alt="" className="wicon" />}{iw.name}
          </button>
        ))}
      </>}
      {w.testnet && choice !== 'real' && <button className={choice === 'test' ? 'primary' : 'secondary'} onClick={() => w.connect('demo')} disabled={w.busy}>
        {w.busy && choice === 'test' ? 'Connecting…' : 'Test wallet in this browser'}</button>}
      <p className="muted small">{note ?? (choice === 'test' ? 'A throwaway wallet kept in this browser, topped up with free test funds.'
        : 'Tempo Wallet signs with a passkey (Face ID / Touch ID). No extension, no seed phrase.')}</p>
      {w.error && <Result msg={{ ok: false, text: w.error }} />}
    </div>
  )
}

// Dispute notes (merchant dashboard and resolver console).
// `me` names the viewer's own side "You".
export const Notes = ({ notes, me }: { notes?: Note[], me?: Note['by'] }) => notes?.length ? (
  <div className="notes">
    {notes.map((n, i) => <p key={i} className={`note ${n.by}`}><b>{n.by === me ? 'You' : n.by === 'buyer' ? 'Buyer' : 'Merchant'}:</b> {n.text}</p>)}
  </div>
) : null
