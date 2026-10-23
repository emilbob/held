// Judge path (#/cheat, testnet only): pay $1 into the Sandbox Shop, then try every way to take it. Each attempt is a
// real transaction from the sandbox's PUBLIC merchant or resolver key, so its failure is on Tempo's explorer; Held's
// fee wallet is only a dry run (its key never goes in a web page). Then the only two ways out: release or refund.
import { useRef, useState } from 'react'
import { BaseError, ContractFunctionRevertedError, parseAbi, parseAbiItem, parseEventLogs, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import * as W from './wallet.ts'
import { api, getConfig, useConfig, useNow, usd, short, txUrl, addrUrl, countdown, Result, type Msg } from './ui.tsx'
import { useEntrance } from './anim.tsx'
import { signInMessage, type Order } from '../../shared/api.ts'

const GUARD: Address = '0xB10C000000000000000000000000000000000000'
const guardAbi = parseAbi(['function claim(address to, bytes receipt)', 'function balanceOf(bytes receipt) view returns (uint256)'])
const TransferBlocked = parseAbiItem('event TransferBlocked(address indexed token, address indexed receiver, uint64 indexed blockedNonce, uint256 amount, uint8 receiptVersion, bytes receipt)')
const FeeCharged = parseAbiItem('event FeeCharged(bytes32 indexed id, address indexed token, address indexed recipient, uint256 fee)')
const badReceiptAbi = [...W.arbiterAbi, { name: 'BadReceipt', type: 'error', inputs: [] }] as const
const AMOUNT = '1'

type Who = 'merchant' | 'resolver' | 'held'
interface Cheat { id: string, who: Who, label: string, refused: string }
const CHEATS: Cheat[] = [
  { id: 'early', who: 'merchant', label: 'Pay myself now, before the buyer has the goods',
    refused: 'Only the buyer can pay the merchant before the protection window ends.' },
  { id: 'guard', who: 'merchant', label: "Skip Held's contract: claim the $1 straight from Tempo",
    refused: "Tempo only lets this shop's Held contract move held money. The merchant's own key can't." },
  { id: 'third', who: 'resolver', label: 'Send the $1 to a wallet of my choice',
    refused: 'Even the resolver can only pay the merchant or refund the buyer. There is no third address.' },
  { id: 'held', who: 'held', label: "Held takes the $1 with its own wallet",
    refused: "Held's fee wallet can't claim it either." },
  { id: 'padded', who: 'merchant', label: 'Replay the payment receipt with extra bytes',
    refused: 'The contract only accepts the exact receipt. We found this hole ourselves on Oct 7 and closed it in contract v4.' },
]
const WHO: Record<Who, string> = { merchant: 'Merchant', resolver: 'Resolver', held: 'Held' }

type Attempt = { busy?: boolean, refused?: boolean, reason?: string, tx?: Hex, dry?: boolean, error?: string }
interface Paid { order: Order, receipt: Hex, tx: Hex, at: number }

// The sandbox keys are shared: send their transactions one at a time (fast clicks would reuse a nonce), and retry once
// when another visitor's transaction took the same nonce.
let queue: Promise<unknown> = Promise.resolve()
const oneAtATime = <T,>(fn: () => Promise<T>): Promise<T> => {
  const retry = () => fn().catch(async (e) => {
    if (!/nonce|invalid parameters/i.test(String((e as Error)?.message))) throw e
    await new Promise((r) => setTimeout(r, 1200))
    return fn()
  })
  const p = queue.then(retry, retry)
  queue = p.catch(() => {})
  return p
}

// Sign in as the sandbox merchant for this page only (no stored session), to create the $1 order.
async function sandboxOrder(merchantKey: Hex): Promise<Order> {
  const acct = privateKeyToAccount(merchantKey)
  const issued = Math.floor(Date.now() / 1000)
  const signature = await acct.signMessage({ message: signInMessage(acct.address, location.host, issued) })
  const { token } = await api<{ token: string }>('/auth', { address: acct.address, issued, signature })
  const r = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ amount: AMOUNT, item: 'Try to steal this dollar' }) })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || r.statusText)
  return j as Order
}

// Testnet: make sure the buyer's test wallet holds $1 of pathUSD (same faucet as the buyer page).
async function fundBuyer(address: Address) {
  if ((await W.tokenBalance(address)) >= 1_000_000n) return
  await api('/faucet', { address }).catch(() => {})
  for (let i = 0; i < 12; i++) {
    if ((await W.tokenBalance(address).catch(() => 0n)) >= 1_000_000n) return
    await new Promise((r) => setTimeout(r, 1500))
  }
  throw new Error("The test funds didn't arrive. Try again in a minute.")
}

export default function Cheat() {
  const cfg = useConfig()
  const now = useNow()
  const root = useRef<HTMLDivElement>(null)
  useEntrance(root, ':scope > .card', true, { stagger: 0.08 })
  const [paid, setPaid] = useState<Paid | null>(null)
  const [step, setStep] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [locked, setLocked] = useState<bigint | null>(null)
  const [tries, setTries] = useState<Record<string, Attempt>>({})
  const [out, setOut] = useState<{ kind: 'release' | 'refund', tx: Hex, fee: bigint } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [doneAt, setDoneAt] = useState<number | null>(null)
  const [start, setStart] = useState(0)

  if (cfg && (!cfg.testnet || !cfg.sandbox?.arbiter)) return <p className="muted">This page is only available on testnet.</p>
  const sb = cfg?.sandbox
  const arbiter = sb?.arbiter as Address | undefined
  const windowLeft = paid ? paid.at + paid.order.merchantInfo.window - now : 0
  const readLocked = (receipt: Hex) => W.pub.readContract({ address: GUARD, abi: guardAbi, functionName: 'balanceOf', args: [receipt] }).then(setLocked, () => {})
  const wallet = async (who: 'merchant' | 'resolver') => W.connect('sandbox', undefined, who, (await getConfig()).sandbox![who === 'merchant' ? 'merchantKey' : 'resolverKey'])

  const pay = async () => {
    if (!sb) return
    setMsg(null); setTries({}); setOut(null); setDoneAt(null); setLocked(null); setStart(Math.floor(Date.now() / 1000))
    try {
      setStep('Creating a $1 order at the Sandbox Shop…')
      const buyer = await W.connect('demo', undefined, 'buyer')
      const [order] = await Promise.all([sandboxOrder(sb.merchantKey), fundBuyer(buyer.address)])
      setStep('Paying $1 from a test wallet in this browser…')
      const rc = await W.transfer(buyer, order.address, order.amount, W.PATHUSD)
      const held = parseEventLogs({ abi: [TransferBlocked], logs: rc.logs })[0]
      if (rc.status !== 'success' || !held) throw new Error('The payment did not go through. Try again.')
      setPaid({ order, receipt: held.args.receipt as Hex, tx: rc.transactionHash, at: Math.floor(Date.now() / 1000) })
      readLocked(held.args.receipt as Hex)
    } catch (e) { setMsg({ ok: false, text: W.explain(e) }) }
    setStep(null)
  }

  // Ask the chain first (gives the exact reason), then send the real transaction so its failure is on the explorer.
  const attempt = async (c: Cheat) => {
    if (!paid || !arbiter || !cfg) return
    setTries((t) => ({ ...t, [c.id]: { busy: true } }))
    const receipt = c.id === 'padded' ? (paid.receipt + '00'.repeat(32)) as Hex : paid.receipt
    const from = c.who === 'held' ? cfg.fee.recipient : c.who === 'resolver' ? sb!.resolver : sb!.merchant
    const viaGuard = c.id === 'guard' || c.id === 'third' || c.id === 'held'
    const to = c.id === 'third' ? privateKeyToAccount(generatePrivateKey()).address : from
    const call = viaGuard
      ? { address: GUARD, abi: guardAbi, functionName: 'claim', args: [to, receipt] } as const
      : { address: arbiter, abi: badReceiptAbi, functionName: 'release', args: [receipt] } as const
    // Ask the chain first for the exact reason. A busy RPC is not a refusal: then only the real transaction decides.
    let allowed = false, reason: string | undefined
    try { await W.pub.simulateContract({ account: from, ...call } as never); allowed = true } catch (e) {
      const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null : null
      if (rev) reason = rev.data?.errorName ? `Reverted: ${rev.data.errorName}` : "Reverted by Tempo's ReceivePolicyGuard"
    }
    let r: Attempt
    if (allowed) r = { refused: false, reason: 'The chain would allow this, so nothing was sent.' }
    else if (c.who === 'held') r = reason ? { refused: true, reason, dry: true } : { error: "Tempo's testnet didn't answer. Try again." }
    else {
      try {
        const w = await wallet(c.who as 'merchant' | 'resolver')
        const { hash, rc } = await oneAtATime(async () => {
          const hash = await w.client.writeContract({ ...call, gas: 2_000_000n, feeToken: W.PATHUSD } as never)
          return { hash, rc: await W.pub.waitForTransactionReceipt({ hash }) }
        })
        r = rc.status === 'success' ? { refused: false, reason: 'This went through.', tx: hash } : { refused: true, reason: reason ?? 'Reverted', tx: hash }
      } catch (e) { r = { error: W.explain(e) } }
    }
    setTries((t) => ({ ...t, [c.id]: r }))
    readLocked(paid.receipt)
  }

  const finish = async (kind: 'release' | 'refund') => {
    if (!paid || !arbiter) return
    setBusy(kind); setMsg(null)
    try {
      const w = kind === 'release' ? await W.connect('demo', undefined, 'buyer') : await wallet('merchant')
      const rc = await oneAtATime(() => W.arbiter(w, arbiter, kind, paid.receipt, cfg!.tokens.map((t) => t.address)))
      const fee = parseEventLogs({ abi: [FeeCharged], logs: rc.logs })[0]?.args.fee ?? 0n
      setOut({ kind, tx: rc.transactionHash, fee }); setDoneAt(Math.floor(Date.now() / 1000))
      readLocked(paid.receipt)
    } catch (e) { setMsg({ ok: false, text: W.explain(e) }) }
    setBusy(null)
  }

  const tried = Object.values(tries).filter((t) => !t.busy && !t.error).length
  const refused = Object.values(tries).filter((t) => t.refused).length
  const amount = paid ? BigInt(paid.order.amount) : 0n
  return (
    <div className="narrow cheat" ref={root}>
      <div className="card">
        <h1>Try to steal $1</h1>
        <p>Pay $1 into a test shop on Tempo testnet, then try every way to take it. Each attempt is a real transaction,
          and the chain refuses it. About 60 seconds, nothing to install.</p>
        {!paid && <button className="primary" disabled={!!step || !cfg} onClick={pay}>{step ? 'Working…' : '1. Pay $1 into the Sandbox Shop'}</button>}
        {step && <p className="muted small">{step}</p>}
        {paid && !out && (
          <div className="protect held">
            <b>Your $1 is held.</b> It sits with Tempo's protocol, not in the merchant's wallet and not in Held's.{' '}
            Locked for this payment right now: <b>{locked === null ? '…' : usd(locked)}</b>.{' '}
            <a href={txUrl(paid.tx)} target="_blank" rel="noreferrer">payment tx ↗</a>
            <br />Protection window: <b>{countdown(windowLeft)}</b> left (short in the sandbox; days in a real shop).
          </div>
        )}
        <Result msg={msg} />
      </div>

      {paid && (
        <div className="card">
          <h2>2. Try to cheat</h2>
          {windowLeft <= 0 && !out && <p className="warn">The protection window is over, so the merchant may now be paid. Start again to try the cheats.</p>}
          <ul className="cheats">
            {CHEATS.map((c) => {
              const t = tries[c.id]
              return (
                <li key={c.id}>
                  <div className="try">
                    <span className="who">{WHO[c.who]}</span>
                    <span>{c.label}</span>
                    <button className="ghost small" disabled={!!t?.busy || windowLeft <= 0 || !!out} onClick={() => attempt(c)}>
                      {t?.busy ? 'Trying…' : t ? 'Try again' : 'Try it'}</button>
                  </div>
                  {t?.error && <p className="warn small">{t.error}</p>}
                  {t && !t.busy && !t.error && (t.refused
                    ? <div className="result blocked" role="status">🔒 Refused. {c.refused}{' '}
                        <span className="muted small">{t.reason}{t.dry ? " (dry run from Held's fee wallet: its key never goes in a web page)" : ''}
                          {t.tx && <> · <a href={txUrl(t.tx)} target="_blank" rel="noreferrer">failed tx ↗</a></>}
                        </span></div>
                    : <div className="result ok" role="status">{t.reason}</div>)}
                </li>
              )
            })}
          </ul>
          {tried > 0 && !out && <p className="muted small">{tried} of {CHEATS.length} tried. Still locked: <b className="ink">{locked === null ? '…' : usd(locked)}</b>.</p>}
        </div>
      )}

      {paid && (
        <div className="card">
          <h2>3. The only two ways out</h2>
          {!out ? <>
            <p>The money can leave only to the merchant or back to the buyer. Pick one:</p>
            <div className="actions">
              <button className="primary" disabled={!!busy} onClick={() => finish('release')}>{busy === 'release' ? 'Releasing…' : 'Buyer: I got it, pay the merchant'}</button>
              <button className="secondary" disabled={!!busy} onClick={() => finish('refund')}>{busy === 'refund' ? 'Refunding…' : 'Merchant: refund the buyer'}</button>
            </div>
            <p className="muted small">Or open a dispute on the <a href={`#/pay/${paid.order.key ?? paid.order.id}`}>buyer page</a>: the resolver
              also gets only these two buttons.</p>
          </> : (
            <div className="protect done">
              {out.kind === 'release'
                ? <><b>Paid to the merchant:</b> {usd(amount - out.fee)} to <a href={addrUrl(sb!.merchant)} target="_blank" rel="noreferrer">{short(sb!.merchant)}</a>
                    {out.fee > 0n && <>, plus Held's {usd(out.fee)} fee</>}.</>
                : <><b>Refunded:</b> {usd(amount)} back to the wallet that paid.</>}{' '}
              <a href={txUrl(out.tx)} target="_blank" rel="noreferrer">tx ↗</a>
              <br />{tried ? `${tried} cheat${tried === 1 ? '' : 's'} tried, ${refused === tried ? 'all' : refused} refused` : 'Done'} in {countdown((doneAt ?? now) - start)}.
              {' '}<button className="ghost small" onClick={() => { setPaid(null); setOut(null) }}>Again</button>
            </div>
          )}
        </div>
      )}
      <p className="muted small after">Want the full tour: shop dashboard, disputes, the resolver's view? <a href="#/sandbox">Try the sandbox</a>.</p>
    </div>
  )
}
