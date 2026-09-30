// Landing at #/: the pitch for merchants (buyers arrive straight on a checkout link).
import Logo from './Logo.tsx'
import { useConfig } from './ui.tsx'

export default function Landing() {
  const cfg = useConfig()
  return (
    <div className="landing">
      <div className="card">
        <div className="logo"><Logo size={80} /></div>
        <div className="tag">Buyer protection for stablecoin payments{cfg?.testnet ? ' · Tempo testnet' : ' on Tempo'}</div>
        <h2>Pay a stranger on-chain. Get your money back if it goes wrong.</h2>
        <p>
          Held sets up a merchant checkout where Tempo holds the buyer's payment until delivery. The Held arbiter
          contract is the only way out: it can release the funds to the merchant or refund the buyer. No custodian.
          No platform risk. Just a plain token transfer from any wallet.
        </p>
        <a href="#/merchant"><button className="primary cta">Start accepting payments</button></a>
        <p className="hint">Buying something? Open the checkout link your merchant sent you.
          {cfg?.testnet && ' Running on Tempo Moderato testnet: test wallets and test funds are free.'}</p>
      </div>
      <section className="how">
        <div><b>1 · Order</b><span>Each order gets its own pay-to address. No transaction, no cost.</span></div>
        <div><b>2 · Buyer pays</b><span>A plain transfer from any wallet. Tempo's protocol holds it, not the merchant.</span></div>
        <div><b>3 · Delivered?</b><span>Buyer confirms, or the window closes, and the money goes to the merchant.</span></div>
        <div><b>4 · Problem?</b><span>Buyer disputes. The resolver can only refund the buyer or pay the merchant.</span></div>
      </section>
    </div>
  )
}
