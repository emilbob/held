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
