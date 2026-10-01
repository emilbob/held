// The "held frame": Held's signature object for the landing page. A tunnel of rounded frames (the shape of the app's
// cards) in hairline lime, turning slowly in 3D, with the payment suspended in the middle. It acts out the product:
//   open      an order: loose, twisted, dim
//   held      the payment arrives and the frames lock into a tight, bright tunnel
//   released  the payment leaves toward the merchant (right, green)
//   refunded  the payment goes back to the buyer (left, violet)
// Plain canvas 2D, no library. Pauses off-screen and in background tabs; reduced motion draws one still frame.
import { useEffect, useRef } from 'react'
import { reduced } from './anim.tsx'

export type FramePhase = 'open' | 'held' | 'released' | 'refunded'
const TARGET: Record<FramePhase, { twist: number, spread: number, alpha: number, lock: number, token: number, tokenIn: number }> = {
  open: { twist: 1, spread: 1, alpha: 0.32, lock: 0, token: 0, tokenIn: 0 },
  held: { twist: 0.12, spread: 0.55, alpha: 0.95, lock: 1, token: 0, tokenIn: 1 },
  released: { twist: 0.12, spread: 0.6, alpha: 0.6, lock: 0.3, token: 1, tokenIn: 1 },
  refunded: { twist: 0.12, spread: 0.6, alpha: 0.6, lock: 0.3, token: -1, tokenIn: 1 },
}
const LIME = [213, 249, 79], GREEN = [63, 185, 80], VIOLET = [151, 117, 250]
const N = 13 // frames

// Rounded rectangle outline (card shape), as points in the XY plane.
const OUTLINE = (() => {
  const w = 0.82, h = 0.52, r = 0.16, pts: [number, number][] = []
  const corners: [number, number, number][] = [[w - r, h - r, 0], [-w + r, h - r, Math.PI / 2], [-w + r, -h + r, Math.PI], [w - r, -h + r, 1.5 * Math.PI]]
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= 8; k++) { const a = a0 + (k / 8) * (Math.PI / 2); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]) }
  return pts
})()

/** `phase` drives the state; with `cycle`, it plays the story on its own (hero). */
export function HeldFrame({ phase = 'held', cycle = false, className }: { phase?: FramePhase, cycle?: boolean, className?: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const phaseRef = useRef<FramePhase>(phase)
  phaseRef.current = phase

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext('2d')!
    const still = reduced()
    const s = { ...TARGET[cycle ? 'open' : phase] } // current (eased) state
    let w = 0, h = 0, dpr = 1, raf = 0, visible = true, last = performance.now(), t = 0, cycleT = 0

    const resize = () => {
      dpr = Math.min(2, devicePixelRatio || 1)
      w = c.clientWidth; h = c.clientHeight
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr)
      if (still) draw()
    }
    // Hero: open (2.4 s) -> held (3.6 s) -> released (2.2 s) -> open -> held -> refunded, forever.
    const CYCLE: [FramePhase, number][] = [['open', 2.4], ['held', 3.6], ['released', 2.2], ['open', 2.4], ['held', 3.6], ['refunded', 2.2]]
    const cyclePhase = () => {
      const total = CYCLE.reduce((a, [, d]) => a + d, 0)
      let x = cycleT % total
      for (const [p, d] of CYCLE) { if (x < d) return p; x -= d }
      return 'open'
    }

    function draw() {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const scale = Math.min(w, h) * 0.46, cx = w / 2, cy = h / 2
      const yaw = Math.sin(t * 0.25) * 0.55 + 0.35, pitch = 0.42 + Math.sin(t * 0.18) * 0.08
      const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
      const project = (x: number, y: number, z: number): [number, number, number] => {
        const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw // yaw (around Y)
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp // pitch (around X)
        const f = 3 / (3 + z2)
        return [cx + x1 * f * scale, cy - y2 * f * scale, z2]
      }
      ctx.lineWidth = 1
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1) - 0.5 // -0.5 .. 0.5 along the tunnel
        const z = u * 1.9 * s.spread
        const rot = s.twist * u * 2.4 + Math.sin(t * 0.4 + i * 0.5) * 0.04 * s.twist
        const cr = Math.cos(rot), sr = Math.sin(rot)
        const front = 1 - (u + 0.5) // nearer frames brighter
        const a = s.alpha * (0.28 + 0.72 * front) * (0.6 + 0.4 * s.lock)
        ctx.strokeStyle = `rgba(${LIME[0]},${LIME[1]},${LIME[2]},${a.toFixed(3)})`
        ctx.beginPath()
        OUTLINE.forEach(([px, py], k) => {
          const [X, Y] = project(px * cr - py * sr, px * sr + py * cr, z)
          if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y)
        })
        ctx.closePath(); ctx.stroke()
      }
      // Lock: an outer frame tightens around the tunnel when the payment is held.
      if (s.lock > 0.02) {
        ctx.strokeStyle = `rgba(${LIME[0]},${LIME[1]},${LIME[2]},${(0.5 * s.lock).toFixed(3)})`
        ctx.lineWidth = 1.5
        ctx.beginPath()
        const g = 1.12 + (1 - s.lock) * 0.25
        OUTLINE.forEach(([px, py], k) => { const [X, Y] = project(px * g, py * g, -0.95 * s.spread - 0.02); if (k === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y) })
        ctx.closePath(); ctx.stroke()
      }
      // The payment: a small card with the amount, suspended in the middle; it leaves right (merchant) or left (buyer).
      if (s.tokenIn > 0.02) {
        const col = s.token > 0.05 ? GREEN : s.token < -0.05 ? VIOLET : LIME
        const mix = Math.min(1, Math.abs(s.token) * 1.6)
        const rgb = LIME.map((v, k) => Math.round(v + (col[k] - v) * mix))
        // Released / refunded: the payment moves straight sideways on screen (right = merchant, left = buyer) and rests
        // just outside the frame, whatever the frame's current rotation.
        const [tx, ty] = [cx + s.token * scale * 0.86, cy]
        const tw = scale * 0.34, th = scale * 0.16, op = s.tokenIn
        ctx.save()
        ctx.globalAlpha = Math.max(0, op)
        // The payment, drawn like the frames: a hairline outline chip, no fill, no glow.
        ctx.strokeStyle = `rgb(${rgb})`; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.roundRect(tx - tw / 2, ty - th / 2, tw, th, th * 0.3); ctx.stroke()
        ctx.globalAlpha = Math.max(0, op) * 0.45; ctx.lineWidth = 1
        ctx.beginPath(); ctx.roundRect(tx - tw / 2 + 4, ty - th / 2 + 4, tw - 8, th - 8, th * 0.22); ctx.stroke()
        ctx.restore()
      }
    }

    const step = (now: number) => {
      raf = requestAnimationFrame(step)
      const dt = Math.min(0.05, (now - last) / 1000); last = now
      if (!visible || document.hidden) return
      t += dt; cycleT += dt
      const target = TARGET[cycle ? cyclePhase() : phaseRef.current]
      const k = 1 - Math.exp(-dt * 3.2)
      for (const key of Object.keys(s) as (keyof typeof s)[]) {
        // A released/refunded payment re-enters from the centre, not by flying back across.
        if (key === 'token' && target.token === 0 && Math.abs(s.token) > 0.6) { s.token = 0; s.tokenIn = 0; continue }
        s[key] += (target[key] - s[key]) * (key === 'token' ? k * 0.8 : k)
      }
      draw()
    }

    const ro = new ResizeObserver(resize); ro.observe(c); resize()
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting }); io.observe(c)
    if (still) { Object.assign(s, TARGET.held); draw() } else raf = requestAnimationFrame(step)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect() }
  }, [cycle])

  return <canvas ref={canvas} className={className} role="img" aria-label="A payment held in a protected frame: it can only leave to the merchant or back to the buyer." />
}
