// Feedback (#/feedback): what people think after trying Held. No account; the contact is optional. Stored apart from
// orders and readable only by Held's owner (see POST/GET /api/feedback).
import { useState, type FormEvent } from 'react'
import { api, session, signInWallet, usePoll, useWallet, WalletPicker, Result, type Msg } from './ui.tsx'
import { explain } from './wallet.ts'
import { FEEDBACK_MAX, CONTACT_MAX, QUOTE_NAME_MAX, type FeedbackView, type FeedbackRole } from '../../shared/api.ts'

const ROLES: [FeedbackRole, string][] = [['buyer', 'I paid as a buyer'], ['merchant', 'I set up or ran a shop'], ['looking', 'Just looking']]

export default function Feedback() {
  const [role, setRole] = useState<FeedbackRole>('looking')
  const [text, setText] = useState('')
  const [contact, setContact] = useState('')
  const [quote, setQuote] = useState(false)
  const [quoteName, setQuoteName] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  const send = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try { await api('/feedback', { role, text, contact, quote, quoteName: quote ? quoteName : '' }); setSent(true) } catch (x) { setMsg({ ok: false, text: (x as Error).message }) }
    setBusy(false)
  }

  if (sent) return (
    <div className="narrow">
      <div className="card" role="status">
        <h1>Thank you</h1>
        <p>Your feedback reached Held. {contact ? "If there's a question, we'll get back to you." : ''}</p>
        <p className="muted small"><a href="#/">Back to Held</a> · <a href="#/roadmap">See the roadmap</a></p>
      </div>
    </div>
  )

  return (
    <div className="narrow">
      <form className="card setup feedback" onSubmit={send}>
        <h1>Tell us what you think</h1>
        <p className="muted">Held is in beta, and honest feedback shapes what gets built next. Two minutes, no account.</p>
        <label id="rolelabel">What did you do?</label>
        <div className="choices" role="group" aria-labelledby="rolelabel">
          {ROLES.map(([r, label]) => (
            <button type="button" key={r} aria-pressed={role === r} className={role === r ? 'primary' : 'ghost'} onClick={() => setRole(r)}>{label}</button>
          ))}
        </div>
        <label htmlFor="fbtext">What would stop you using Held? Anything confusing, missing, or great?</label>
        <textarea id="fbtext" rows={5} value={text} onChange={(e) => setText(e.target.value)} maxLength={FEEDBACK_MAX} required
          placeholder="e.g. I'd use it if…" />
        <label htmlFor="fbcontact">Contact <span className="muted">(optional: email, X or Telegram, only if you'd like a reply)</span></label>
        <input id="fbcontact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={CONTACT_MAX} autoComplete="off" />
        <label className="check">
          <input type="checkbox" checked={quote} onChange={(e) => setQuote(e.target.checked)} />
          <span>You can quote this on the Held website (only the name or handle you give below, never your contact)</span>
        </label>
        {quote && <>
          <label htmlFor="fbname">Name or handle to show <span className="muted">(optional, e.g. "Ana" or "@ana")</span></label>
          <input id="fbname" value={quoteName} onChange={(e) => setQuoteName(e.target.value)} maxLength={QUOTE_NAME_MAX} autoComplete="off" />
        </>}
        <button className="primary" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send feedback'}</button>
        <p className="muted small">{quote ? 'It will appear on the Held website with the name you give, or as Anonymous.' : "Only Held's developer reads this; it stays private."} See the <a href="#/privacy">privacy page</a>.</p>
        <Result msg={msg} />
      </form>
    </div>
  )
}

// Inbox (#/feedback/inbox): everything sent through the form, for Held's owner only (the server checks the session is
// the owner wallet, network.defaultResolver). Quotable ones also show on the landing (GET /api/quotes) unless hidden
// here; hiding never deletes, and "Show again" puts a quote back.
const ROLE_SHORT: Record<FeedbackRole, string> = { buyer: 'Buyer', merchant: 'Merchant', looking: 'Just looking' }
export function FeedbackInbox() {
  const w = useWallet('resolver')
  const addr = w.wallet?.address
  const signedIn = !!addr && session.get('resolver')?.address.toLowerCase() === addr.toLowerCase()
  const [signing, setSigning] = useState(false)
  const [signErr, setSignErr] = useState<string | null>(null)
  const [onlyQuotes, setOnlyQuotes] = useState(false)
  const signIn = async () => {
    if (!w.wallet) return
    setSigning(true); setSignErr(null)
    try { await signInWallet(w.wallet, 'resolver') } catch (e) { setSignErr(explain(e)) }
    setSigning(false)
  }
  const [data, err, refresh] = usePoll(() => (signedIn ? api<{ feedback: FeedbackView[] }>('/feedback', undefined, 'resolver') : Promise.resolve(null)), 30_000, [signedIn])
  const [toggling, setToggling] = useState<string | null>(null)
  const [hideErr, setHideErr] = useState<string | null>(null)
  const setHidden = async (f: FeedbackView, hidden: boolean) => {
    setToggling(f.key); setHideErr(null)
    try { await api('/feedback/hide', { key: f.key, hidden }, 'resolver'); refresh() } catch (e) { setHideErr((e as Error).message) }
    setToggling(null)
  }
  const all = data?.feedback ?? []
  const list = onlyQuotes ? all.filter((f) => f.quote) : all
  return (
    <div className="narrow inbox">
      <div className="card">
        <h1>Feedback inbox</h1>
        <p className="muted">Only Held's owner wallet can read this. Sign a message (free, moves no funds) to open it.</p>
        <WalletPicker w={w} choice="real" note="Connect Held's owner wallet." />
        {w.wallet && !signedIn && <p className="signin"><button className="primary small" disabled={signing} onClick={signIn}>{signing ? 'Waiting for signature…' : 'Sign in to read feedback'}</button></p>}
        {signErr && <Result msg={{ ok: false, text: signErr }} />}
        {err && <Result msg={{ ok: false, text: err }} />}
        {hideErr && <Result msg={{ ok: false, text: hideErr }} />}
        {data && (
          <div className="filters" role="group" aria-label="Show">
            <button type="button" className={onlyQuotes ? 'ghost small' : 'primary small'} aria-pressed={!onlyQuotes} onClick={() => setOnlyQuotes(false)}>All ({all.length})</button>
            <button type="button" className={onlyQuotes ? 'primary small' : 'ghost small'} aria-pressed={onlyQuotes} onClick={() => setOnlyQuotes(true)}>Can be quoted ({all.filter((f) => f.quote).length})</button>
          </div>
        )}
      </div>
      {data && !list.length && <p className="muted">{onlyQuotes ? 'No quotable feedback yet.' : 'No feedback yet.'}</p>}
      {list.map((f, i) => (
        <div key={`${f.key}-${i}`} className={`card fb${f.quote && !f.hidden ? ' quotable' : ''}`}>
          <div className="meta">
            <span>{new Date(f.at * 1000).toLocaleString()}</span>
            <span>· {ROLE_SHORT[f.role]}</span>
            {f.quote && (f.hidden ? <span className="badge grey">Hidden from the landing</span>
              : <span className="badge lime">On the landing{f.quoteName ? ` as ${f.quoteName}` : ''}</span>)}
            {f.quote && <button type="button" className="ghost small hide" disabled={toggling === f.key} onClick={() => setHidden(f, !f.hidden)}>
              {toggling === f.key ? '…' : f.hidden ? 'Show again' : 'Hide'}</button>}
          </div>
          <p className="text">{f.text}</p>
          {f.contact && <p className="contact muted">Contact: {f.contact}</p>}
        </div>
      ))}
    </div>
  )
}
