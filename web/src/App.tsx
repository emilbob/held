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
  const pay = route.match(/^\/pay\/(\d+)/)
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
        <nav>{cfg?.testnet && cfg.sandbox?.arbiter && <a href="#/sandbox">Try it</a>}<a href="#/" className="wide-only">How it works</a><a href="#/merchant"><span className="wide-only">For merchants</span><span className="narrow-only">Merchants</span></a></nav>
      </header>
      <main>{page}</main>
      <footer>
        Funds are held by Tempo's ReceivePolicyGuard. Each merchant's Held arbiter contract can only release them to the merchant or refund the original payer.
        {' '}<a href="#/resolve">Resolver console</a>
      </footer>
    </>
  )
}
