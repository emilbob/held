import { useEffect, useState } from 'react'
import Landing from './Landing.tsx'
import Logo from './Logo.tsx'
import Pay from './Pay.tsx'
import MerchantPage from './Merchant.tsx'
import Resolve from './Resolve.tsx'
import Sandbox from './Sandbox.tsx'
import Buy from './Buy.tsx'
import { Terms, Privacy } from './Legal.tsx'
import Roadmap from './Roadmap.tsx'
import Faq from './Faq.tsx'
import Feedback from './Feedback.tsx'
import { useConfig } from './ui.tsx'
import { ToTop } from './anim.tsx'

function useRoute() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => { const f = () => setHash(location.hash); addEventListener('hashchange', f); return () => removeEventListener('hashchange', f) }, [])
  return hash.replace(/^#/, '') || '/'
}

export default function App() {
  const route = useRoute()
  const cfg = useConfig()
  const pay = route.match(/^\/pay\/([\w-]{1,32})/)
  const buy = route.match(/^\/buy\/([\w-]{6,16})/)
  const page = pay ? <Pay id={pay[1]} />
    : buy ? <Buy id={buy[1]} />
    : route.startsWith('/merchant') || route.startsWith('/dashboard') ? <MerchantPage />
    : route.startsWith('/resolve') ? <Resolve />
    : route.startsWith('/sandbox') ? <Sandbox />
    : route.startsWith('/terms') ? <Terms />
    : route.startsWith('/privacy') ? <Privacy />
    : route.startsWith('/roadmap') ? <Roadmap />
    : route.startsWith('/faq') ? <Faq />
    : route.startsWith('/feedback') ? <Feedback />
    : <Landing />
  return (
    <>
      <header>
        <a href="/" className="logo" onClick={(e) => { e.preventDefault(); location.href = "/"; if (location.hash === "" || location.hash === "#/") location.reload() }}><Logo size={24} /></a>
        <a href="#/roadmap" className="beta" title="Held is in beta: see the roadmap">Beta</a>
        <span className="tag">Buyer protection for stablecoin payments{cfg?.testnet ? ' · Tempo testnet' : ' on Tempo'}</span>
        <nav>{cfg?.testnet && cfg.sandbox?.arbiter && <a href="#/sandbox">Try it</a>}<a href="#/" className="wide-only">How it works</a><a href="#/merchant"><span className="wide-only">For merchants</span><span className="narrow-only">Merchants</span></a><a href="#/roadmap">Roadmap</a><a href="#/faq" className="wide-only">FAQ</a><a href="https://tempo.xyz" target="_blank" rel="noopener noreferrer" className="ext wide-only">Tempo<span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a></nav>
      </header>
      <main>{page}</main>
      <footer>
        <p>Funds are held by Tempo's ReceivePolicyGuard; each merchant's arbiter can only pay the merchant or refund the payer.</p>
        <span className="footlinks">{!route.startsWith('/resolve') && <a href="#/resolve">Resolver</a>}<a href="#/feedback">Feedback</a><a href="#/faq">FAQ</a><a href="#/terms">Terms</a><a href="#/privacy">Privacy</a><a href="https://x.com/tempoheld" target="_blank" rel="noopener noreferrer">X<span className="sr-only"> (@tempoheld, opens in a new tab)</span></a></span>
      </footer>
      <ToTop />
      {!route.startsWith('/feedback') && <a href="#/feedback" className="fbfloat">Feedback</a>}
    </>
  )
}
