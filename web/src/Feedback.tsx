// Feedback (#/feedback): what people think after trying Held. No account; the contact is optional. Stored apart from
// orders and readable only by Held's owner (see POST/GET /api/feedback).
import { useState, type FormEvent } from 'react'
import { api, Result, type Msg } from './ui.tsx'
import { FEEDBACK_MAX, CONTACT_MAX, QUOTE_NAME_MAX, type FeedbackRole } from '../../shared/api.ts'

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
        <p className="muted small">{quote ? 'Held may quote this, and picks which quotes to show.' : "Only Held's developer reads this; it stays private."} See the <a href="#/privacy">privacy page</a>.</p>
        <Result msg={msg} />
      </form>
    </div>
  )
}
