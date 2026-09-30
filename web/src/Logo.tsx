// Real Held mark + "Held" wordmark. Uses the PNG mark when present; falls back to an inline SVG
// approximation of the geometric lime H so the logo still renders if the asset fails to load.
import type { CSSProperties, SyntheticEvent } from 'react'
import logoUrl from '../public/held-logo.png?url'

export default function Logo({ size = 26, className = '' }: { size?: number, className?: string }) {
  const onError = (e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    img.onerror = null
    img.style.display = 'none'
    const svg = img.parentElement?.querySelector('svg')
    if (svg) svg.style.display = 'inline-block'
  }
  return (
    <span className={`logo ${className}`} style={{ '--logo-h': size } as CSSProperties}>
      <img src={logoUrl} alt="Held" style={{ height: size, width: 'auto', display: 'block' }} onError={onError} />
      <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg"
        style={{ display: 'none' }} aria-hidden="true">
        <polygon points="6,26 6,6 8.4,6 26,24.8V26 H6Z" fill="#39FF14" transform="skewX(-12)" />
      </svg>
      <b>Held</b>
    </span>
  )
}
