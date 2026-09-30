// Sandbox (#/sandbox, testnet only): try every role in a couple of minutes with a shared shop that's already set up.
// Merchant and resolver use the sandbox's PUBLIC test keys; the buyer uses a test wallet of their own.
import { useConfig } from './ui.tsx'

const go = (role: 'merchant' | 'resolver', hash: string) => {
  try { localStorage.setItem(`held.walletKind.${role}`, 'sandbox') } catch {}
  location.hash = hash
}

export default function Sandbox() {
  const cfg = useConfig()
  if (cfg && (!cfg.testnet || !cfg.sandbox?.arbiter)) return <p className="muted">The sandbox is only available on testnet.</p>
  return (
    <div className="narrow">
      <div className="card sandbox">
        <h1>Try Held in 2 minutes</h1>
        <p>A shared <b>Sandbox Shop</b> is already set up on Tempo testnet, so you can play every role without installing
          anything. Test funds are free and added automatically.</p>
        <ol className="roles">
          <li>
            <b>Be the merchant.</b> Open the shop's dashboard and create an order, then open its buyer page.
            <button className="primary" onClick={() => go('merchant', '#/merchant')}>Open the Sandbox Shop</button>
          </li>
          <li>
            <b>Be the buyer.</b> On the buyer page, choose <i>Test wallet in this browser</i> and pay. The payment is held by
            Tempo, not the merchant. Then confirm delivery, or open a dispute within the 5-minute protection window.
          </li>
          <li>
            <b>Try to cheat.</b> Back on the dashboard, press <i>Try to pay yourself early</i>. The contract refuses.
          </li>
          <li>
            <b>Be the resolver.</b> Decide the dispute: refund the buyer or pay the merchant. Those are the only two options.
            <button onClick={() => go('resolver', '#/resolve')}>Open the resolver console</button>
          </li>
        </ol>
        <p className="muted small">Shared by everyone, so you'll see other visitors' sandbox orders. The sandbox merchant and resolver
          use public test keys that hold only test funds; they're never offered on mainnet. Want your own shop? <a href="#/merchant">Set one up</a>:
          it takes a few minutes once.</p>
      </div>
    </div>
  )
}
