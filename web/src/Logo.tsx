// Held mark (transparent PNG, lime on anything) + "Held" wordmark.
import logoUrl from './assets/held-logo.png'

export default function Logo({ size = 26, className = '' }: { size?: number, className?: string }) {
  return (
    <span className={`logo ${className}`}>
      <img src={logoUrl} alt="" style={{ height: size, width: 'auto', display: 'block' }} />
      <b>Held</b>
    </span>
  )
}

// Framer's mark, for "works with Framer" spots (landing pill, dashboard copy button). Takes the text color.
export function FramerLogo({ size = 16 }: { size?: number }) {
  return <svg viewBox="0 0 14 21" width={size * 2 / 3} height={size} aria-hidden="true" style={{ flex: 'none' }}><path fill="currentColor" d="M0 0h14v7H7zM0 7h7l7 7H0zM0 14h7v7z" /></svg>
}
