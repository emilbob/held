// Motion, in the spirit of emilbob.github.io (expo easing, staggered entrances, text scramble, count-ups, line reveals,
// magnetic buttons), with no animation library: CSS, the Web Animations API and IntersectionObserver (~2 KB instead
// of GSAP's ~49 KB). Nothing waits on an animation, and the system's "reduce motion" setting turns it all off.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

export const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
/** GSAP's expo.out, exactly. */
export const EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)'
// GSAP's elastic.out(1, 0.35), sampled into a CSS linear() curve (a close approximation; falls back to EXPO).
const ELASTIC = (() => {
  const p = 0.35, s = p / 4
  const pts = Array.from({ length: 41 }, (_, i) => { const t = i / 40; return t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin(((t - s) * 2 * Math.PI) / p) + 1 })
  const curve = `linear(${pts.map((v) => v.toFixed(4)).join(', ')})`
  return typeof CSS !== 'undefined' && CSS.supports('transition-timing-function', curve) ? curve : EXPO
})()

// ---------------------------------------------------------------- text scramble
const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*+=<>/'
/** Decodes `text` into `el` left to right through random glyphs (like the site's "001" labels). */
export function scramble(el: HTMLElement, text: string, ms = 450) {
  if (reduced()) { el.textContent = text; return () => {} }
  const start = performance.now()
  let raf = 0
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / ms)
    const fixed = Math.floor(t * text.length)
    el.textContent = text.slice(0, fixed) + [...text.slice(fixed)].map((c) => (c === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('')
    if (t < 1) raf = requestAnimationFrame(tick)
    else el.textContent = text
  }
  raf = requestAnimationFrame(tick)
  return () => { cancelAnimationFrame(raf); el.textContent = text }
}
/** Text that scrambles into place when it changes (and, with `onMount`, when it first appears). */
export function Scramble({ text, ms, onMount = false, className }: { text: string, ms?: number, onMount?: boolean, className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef<string | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const first = prev.current === null
    prev.current = text
    if (first && !onMount) { el.textContent = text; return }
    return scramble(el, text, ms)
  }, [text])
  return <span ref={ref} className={className} aria-label={text}>{text}</span>
}

// ---------------------------------------------------------------- count-up
const easeOut3 = (t: number) => 1 - (1 - t) ** 3 // GSAP's power3.out
/** A number that rolls from its previous value (or 0 on first show) to `value`, formatted by `format`. */
export function CountUp({ value, format, ms = 900 }: { value: number, format: (n: number) => string, ms?: number }) {
  const [shown, setShown] = useState(reduced() ? value : 0)
  const from = useRef(reduced() ? value : 0)
  useEffect(() => {
    if (reduced()) { setShown(value); from.current = value; return }
    const a = from.current, start = performance.now()
    let raf = 0, cur = a
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      cur = a + (value - a) * easeOut3(t)
      setShown(cur)
      if (t < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); from.current = cur }
  }, [value])
  return <>{format(shown)}</>
}

// ---------------------------------------------------------------- entrances
const rise = (el: Element, y: number, delay: number, duration = 800) =>
  el.animate([{ opacity: 0, transform: `translateY(${y}px)` }, { opacity: 1, transform: 'none' }],
    { duration, delay, easing: EXPO, fill: 'backwards' }) // backwards: hidden until its turn; nothing left behind after
/** Staggered fade-up of `selector` inside `scope`, once `ready` is true (e.g. when data has loaded). */
export function useEntrance(scope: RefObject<HTMLElement | null>, selector: string, ready = true, opts: { y?: number, stagger?: number } = {}) {
  useLayoutEffect(() => {
    if (!ready || reduced() || !scope.current) return
    const anims = [...scope.current.querySelectorAll(selector)].map((el, i) => rise(el, opts.y ?? 22, i * (opts.stagger ?? 0.08) * 1000))
    return () => anims.forEach((a) => a.cancel())
  }, [ready])
}
/** Same, but plays when the block scrolls into view (once). */
export function useScrollEntrance(scope: RefObject<HTMLElement | null>, selector: string, opts: { y?: number, stagger?: number } = {}) {
  useLayoutEffect(() => {
    const root = scope.current
    if (!root || reduced()) return
    const els = [...root.querySelectorAll<HTMLElement>(selector)]
    els.forEach((el) => { el.style.opacity = '0' })
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      els.forEach((el, i) => { el.style.opacity = ''; rise(el, opts.y ?? 30, i * (opts.stagger ?? 0.1) * 1000) })
    }, { rootMargin: '0px 0px -12% 0px' })
    io.observe(root)
    return () => { io.disconnect(); els.forEach((el) => { el.style.opacity = '' }) }
  }, [])
}

// ---------------------------------------------------------------- headline line reveal
/** Text whose lines rise out of a mask. Renders the words, measures where the browser wrapped them, animates each
 *  line, then goes back to plain text (so later resizes wrap naturally). */
export function LineReveal({ text, delay = 0.1 }: { text: string, delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [lines, setLines] = useState<string[] | null>(null)
  const [done, setDone] = useState(reduced())
  // 1. Measure: which words share a line.
  useLayoutEffect(() => {
    if (done || lines || !ref.current) return
    const rows: string[][] = []
    let top = -1
    for (const w of ref.current.querySelectorAll<HTMLElement>('[data-w]')) {
      if (w.offsetTop !== top) { rows.push([]); top = w.offsetTop }
      rows[rows.length - 1].push(w.textContent ?? '')
    }
    setLines(rows.map((r) => r.join(' ')))
  }, [done, lines])
  // 2. Animate the lines, then hand back plain text.
  useLayoutEffect(() => {
    if (!lines || done || !ref.current) return
    const anims = [...ref.current.querySelectorAll('[data-l]')].map((el, i) =>
      el.animate([{ transform: 'translateY(110%)' }, { transform: 'none' }], { duration: 1100, delay: delay * 1000 + i * 120, easing: EXPO, fill: 'backwards' }))
    Promise.all(anims.map((a) => a.finished)).then(() => setDone(true), () => {})
    return () => anims.forEach((a) => a.cancel())
  }, [lines])
  if (done) return <>{text}</>
  if (!lines) return <span ref={ref}>{text.split(' ').map((w, i) => <span key={i}><span data-w>{w}</span>{' '}</span>)}</span>
  return <span ref={ref}>{lines.map((l, i) => <span key={i} style={{ display: 'block', overflow: 'hidden' }}><span data-l style={{ display: 'block' }}>{l}</span></span>)}</span>
}

// ---------------------------------------------------------------- magnetic buttons
/** The element leans toward the pointer while it's over it, then springs back (pointer devices only). */
export function useMagnetic<T extends HTMLElement>(strength = 0.3) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || reduced() || !matchMedia('(pointer: fine)').matches) return
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      el.style.transition = `transform .35s ${EXPO}`
      el.style.transform = `translate(${(e.clientX - (r.left + r.width / 2)) * strength}px, ${(e.clientY - (r.top + r.height / 2)) * strength}px)`
    }
    const leave = () => { el.style.transition = `transform .7s ${ELASTIC}`; el.style.transform = '' }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerleave', leave)
    return () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); el.style.transform = ''; el.style.transition = '' }
  }, [strength])
  return ref
}

// ---------------------------------------------------------------- back to top
/** A round button that appears after scrolling down about a screen and smoothly returns to the top. */
export function ToTop() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const f = () => setShown(scrollY > innerHeight * 0.9)
    f(); addEventListener('scroll', f, { passive: true }); return () => removeEventListener('scroll', f)
  }, [])
  const up = () => {
    scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' })
    document.querySelector<HTMLElement>('header .logo')?.focus({ preventScroll: true })
  }
  return (
    <button type="button" className={`totop${shown ? ' on' : ''}`} onClick={up} aria-label="Back to top" tabIndex={shown ? 0 : -1} aria-hidden={!shown}>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
  )
}
