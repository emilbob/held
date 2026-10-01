import { useEffect, useState } from 'react'
import Landing from './Landing.tsx'
import Logo from './Logo.tsx'
import Pay from './Pay.tsx'
import MerchantPage from './Merchant.tsx'
import Resolve from './Resolve.tsx'
import Sandbox from './Sandbox.tsx'
import Buy from './Buy.tsx'
import { useConfig } from './ui.tsx'

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
    : <Landing />
  return (
    <>
      <header>
        <a href="#/" className="logo"><Logo size={24} /></a>
        <span className="tag">Buyer protection for stablecoin payments{cfg?.testnet ? ' · Tempo testnet' : ' on Tempo'}</span>
        <nav>{cfg?.testnet && cfg.sandbox?.arbiter && <a href="#/sandbox">Try it</a>}<a href="#/" className="wide-only">How it works</a><a href="#/merchant"><span className="wide-only">For merchants</span><span className="narrow-only">Merchants</span></a><a href="https://tempo.xyz" target="_blank" rel="noopener noreferrer" className="ext">Tempo<span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a></nav>
      </header>
      <main>{page}</main>
      <footer>
        <p>Funds are held by Tempo's ReceivePolicyGuard; each merchant's arbiter can only pay the merchant or refund the payer.</p>
        {!route.startsWith('/resolve') && <a href="#/resolve">Resolver console</a>}
      </footer>
    </>
  )
}
