// Real Held mark + "Held" wordmark. Uses the PNG mark when present; falls back to an inline SVG
// approximation of the geometric lime H so the logo still renders if the asset fails to load.
import logoUrl from '../public/held-logo.png?url'

export default function Logo({ size = 26, className = '' }) {
  return (
    <span className={`logo ${className}`} style={{ '--logo-h': size }}>
      <img src={logoUrl} alt="Held" style={{ height: size, width: 'auto', display: 'block' }} onError={(e) => {
        e.currentTarget.onerror = null
        e.target.style.display = 'none'
        const svg = e.currentTarget.parentNode.querySelector('svg')
        if (svg) svg.style.display = 'inline-block'
      }} />
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'none' }} aria-hidden="true">
        <polygon points="6,26 6,6 8.4,6 26,24.8V26 H6Z" fill="#39FF14" transform="skewX(-12)" />
      </svg>
      <b>Held</b>
    </span>
  )
}
