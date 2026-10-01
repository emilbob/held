// Landing at #/: the pitch for merchants (buyers arrive straight on a checkout link). One idea per section, with the
// "held frame" acting out the product: hero (it plays the story on its own), then a scroll story 01-04 where the
// frame follows the step you're reading, the film, the guarantee, and a way in.
import { useEffect, useRef, useState } from 'react'
import Logo from './Logo.tsx'
import { useConfig } from './ui.tsx'
import { LineReveal, Scramble, useEntrance, useMagnetic, useScrollEntrance } from './anim.tsx'
import { HeldFrame, type FramePhase } from './HeldFrame.tsx'

// YouTube id of the product film (empty: the film section stays hidden). Loads nothing from YouTube until played.
const FILM_YOUTUBE_ID = ''
const CONTRACT_URL = 'https://github.com/emilbob/held/blob/main/contracts/HeldArbiter.sol'

const STEPS: { n: string, phase: FramePhase, title: string, text: string, state: string }[] = [
  { n: '01', phase: 'open', title: 'An order, its own address',
    text: "The merchant creates an order or a checkout link, or puts a \"Pay with Held\" button on their site. Every order gets its own pay-to address. No transaction, no cost.", state: 'order · waiting for payment' },
  { n: '02', phase: 'held', title: 'Paid, and held by Tempo',
    text: "The buyer sends a plain transfer from their own wallet: no escrow contract, no approvals. Tempo's protocol holds the payment. Not the merchant, not Held.", state: 'held by Tempo · protected' },
  { n: '03', phase: 'released', title: 'Delivered: the merchant is paid',
    text: 'The buyer confirms delivery, or the protection window ends, and the payment goes to the merchant. Instantly.', state: 'released → merchant' },
  { n: '04', phase: 'refunded', title: 'Problem: the buyer gets it back',
    text: 'The buyer opens a dispute and says what went wrong. The resolver decides, and the only other way out is back to the wallet that paid.', state: '← refunded to the buyer' },
]

export default function Landing() {
  const cfg = useConfig()
  const hero = useRef<HTMLDivElement>(null)
  const cta1 = useMagnetic<HTMLButtonElement>(), cta2 = useMagnetic<HTMLButtonElement>()
  useEntrance(hero, '.hero-copy > :not(h1):not(.ctas), .ctas .cta', true, { stagger: 0.09 })
  const sandbox = cfg?.testnet && cfg.sandbox?.arbiter
  return (
    <div className="landing2">
      <section className="hero2" ref={hero}>
        <div className="hero-copy">
          <div className="eyebrow"><Logo size={44} /><Scramble onMount ms={700} text={`Buyer protection for stablecoin payments${cfg?.testnet ? ' · Tempo testnet' : ' on Tempo'}`} /></div>
          <h1><LineReveal text="Pay a stranger on‑chain. Get your money back if it goes wrong." delay={0.15} /></h1>
          <p className="lede">Held sets up a merchant checkout where Tempo holds the buyer's payment until delivery. The Held arbiter contract is the
            only way out: it can release the funds to the merchant or refund the buyer. No custodian. No platform risk.</p>
          <div className="ctas">
            <a href="#/merchant"><button ref={cta1} className="primary cta">Start accepting payments</button></a>
            {sandbox && <a href="#/sandbox"><button ref={cta2} className="cta">Try the sandbox (2 min)</button></a>}
          </div>
          <p className="hint">Buying something? Open the checkout link your merchant sent you.</p>
        </div>
        <div className="hero-visual"><HeldFrame cycle className="frame-canvas" /></div>
        <ScrollCue />
      </section>

      <Story />
      {FILM_YOUTUBE_ID && <Film id={FILM_YOUTUBE_ID} />}
      <Guarantee />

      <section className="final">
        <h2>See it work in two minutes.</h2>
        <p>{sandbox ? 'A shop is already set up on Tempo testnet. Play merchant, buyer and resolver, and try to cheat: the contract refuses.' : 'Set up your shop from your own wallet in a few minutes.'}</p>
        <div className="ctas">
          {sandbox && <a href="#/sandbox"><button className="primary cta">Try the sandbox</button></a>}
          <a href="#/merchant"><button className={`cta ${sandbox ? '' : 'primary'}`}>Start accepting payments</button></a>
        </div>
      </section>
    </div>
  )
}

/** "Scroll" with a dot sliding down a hairline; fades once the page moves, and takes you to "How it works". */
function ScrollCue() {
  const [gone, setGone] = useState(false)
  useEffect(() => {
    const f = () => setGone(scrollY > 40)
    f(); addEventListener('scroll', f, { passive: true })
    return () => removeEventListener('scroll', f)
  }, [])
  return (
    <button type="button" className={`scroll-cue${gone ? ' gone' : ''}`} aria-label="Scroll to how it works"
      onClick={() => document.querySelector('.story')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}>
      <span>Scroll</span><i />
    </button>
  )
}

/** 01-04: the text scrolls, the frame stays (sticky) and follows the step in the middle of the screen. */
function Story() {
  const [active, setActive] = useState(0)
  const refs = useRef<(HTMLLIElement | null)[]>([])
  const head = useRef<HTMLDivElement>(null)
  useScrollEntrance(head, ':scope > *')
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i))
    }, { rootMargin: '-45% 0px -45% 0px' }) // the step crossing the middle band of the viewport
    refs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [])
  return (
    <section className="story" aria-labelledby="how-title">
      <div className="story-head" ref={head}>
        <span className="kicker">How it works</span>
        <h2 id="how-title">A protected space between paying and getting paid.</h2>
      </div>
      <div className="story-body">
        <ol className="story-steps">
          {STEPS.map((s, i) => (
            <li key={s.n} data-i={i} ref={(el) => { refs.current[i] = el }} className={i === active ? 'on' : ''}>
              <div className="step-visual" aria-hidden="true"><HeldFrame phase={s.phase} className="frame-canvas" /></div>
              <span className="num">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
        <div className="story-visual">
          <HeldFrame phase={STEPS[active].phase} className="frame-canvas" />
          <div className="frame-caption"><span>{STEPS[active].n}</span> <Scramble text={STEPS[active].state} ms={400} /></div>
        </div>
      </div>
    </section>
  )
}

/** The product film: a poster until played, then YouTube's privacy-enhanced player (nothing loads before the click). */
function Film({ id }: { id: string }) {
  const [play, setPlay] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useScrollEntrance(box, ':scope > *')
  return (
    <section className="film" aria-labelledby="film-title" ref={box}>
      <span className="kicker">The film</span>
      <h2 id="film-title">Held in under three minutes.</h2>
      <div className="film-frame">
        {play
          ? <iframe src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`} title="Held: product film" allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen />
          : <button className="film-poster" onClick={() => setPlay(true)} aria-label="Play the Held film">
              <img src="/film-poster.jpg" alt="" loading="lazy" />
              <span className="play">▶</span>
            </button>}
      </div>
    </section>
  )
}

/** The trust claim, in the contract's own words. */
function Guarantee() {
  const box = useRef<HTMLDivElement>(null)
  useScrollEntrance(box, ':scope > *', { stagger: 0.12 })
  return (
    <section className="guarantee" aria-labelledby="g-title" ref={box}>
      <span className="kicker">The guarantee</span>
      <h2 id="g-title">Two ways out. No third.</h2>
      <p>Each shop deploys its own arbiter contract. It can send a held payment to exactly two places, and it has no code that
        could send it anywhere else: not to Held, not to the resolver, not to anyone.</p>
      <pre className="code"><code>
        <span className="ln cm">// release: to the merchant</span>
        <span className="ln"><span className="fn">GUARD.claim</span>(merchant, receipt);</span>
        <span className="ln cm">// refund: back to the wallet that paid</span>
        <span className="ln"><span className="fn">GUARD.claim</span>(r.originator, receipt);</span>
      </code></pre>
      <p className="muted small"><a href={CONTRACT_URL} target="_blank" rel="noopener">Read the whole contract</a> (175 lines) · built on Tempo:
        per-order virtual addresses, protocol-level receive policies, stablecoin gas, instant finality.</p>
    </section>
  )
}
