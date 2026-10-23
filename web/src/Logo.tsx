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

// Webflow's mark (Simple Icons), for the dashboard's Webflow copy button. Takes the text color.
export function WebflowLogo({ size = 16 }: { size?: number }) {
  return <svg viewBox="0 4 24 16" width={size * 1.5} height={size} aria-hidden="true" style={{ flex: 'none' }}><path fill="currentColor" d="m24 4.515-7.658 14.97H9.149l3.205-6.204h-.144C9.566 16.713 5.621 18.973 0 19.485v-6.118s3.596-.213 5.71-2.435H0V4.515h6.417v5.278l.144-.001 2.622-5.277h4.854v5.244h.144l2.72-5.244H24Z" /></svg>
}
