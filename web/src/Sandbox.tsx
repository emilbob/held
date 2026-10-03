// Sandbox (#/sandbox, testnet only): try every role in a couple of minutes with a shared shop that's already set up.
// Merchant and resolver use the sandbox's PUBLIC test keys; the buyer uses a test wallet of their own.
import { useRef } from 'react'
import { useConfig } from './ui.tsx'
import { useEntrance } from './anim.tsx'

const go = (role: 'merchant' | 'resolver', hash: string) => {
  try { localStorage.setItem(`held.walletKind.${role}`, 'sandbox') } catch {}
  location.hash = hash
}

// Own shop: forget the remembered sandbox merchant, or #/merchant would reopen the Sandbox Shop.
const ownShop = () => { try { localStorage.removeItem('held.walletKind.merchant') } catch {} }

export default function Sandbox() {
  const cfg = useConfig()
  const root = useRef<HTMLDivElement>(null)
  useEntrance(root, 'h1, :scope > .card > p, .roles li', true, { stagger: 0.08 })
  if (cfg && (!cfg.testnet || !cfg.sandbox?.arbiter)) return <p className="muted">The sandbox is only available on testnet.</p>
  return (
    <div className="narrow" ref={root}>
      <div className="card sandbox">
        <h1>Try Held in 2 minutes</h1>
        <p>A shared <b>Sandbox Shop</b> is already set up on Tempo testnet, so you can play every role without installing
          anything or using your own wallet. Test funds are free and added automatically. Follow these steps:</p>
        <ol className="roles">
          <li>
            <b>Open the shop as the merchant.</b> You'll see the Sandbox Shop's dashboard.
            <button className="primary" onClick={() => go('merchant', '#/merchant')}>Open the Sandbox Shop</button>
          </li>
          <li>
            <b>Create an order.</b> Under <i>New order</i>, type an item and a price (e.g. <i>Mug</i>, <i>1</i>) and press
            {' '}<i>Create order</i>. On your new order, press <i>Buyer page →</i>.
          </li>
          <li>
            <b>Pay as the buyer.</b> Choose <i>Test wallet in this browser</i>, wait a few seconds for the free test funds,
            then press <i>Pay $1.00</i>. You'll see <i>Held: protected</i>: Tempo holds the money, not the merchant.
          </li>
          <li>
            <b>Try to cheat as the merchant.</b> Go back to the dashboard (<i>← Back to your orders</i> at the top of the buyer
            page, or <i>Dashboard</i> in the menu) and press <i>Try to pay yourself early</i> on that order. The contract refuses.
            Then return with <i>Buyer page →</i>.
          </li>
          <li>
            <b>Finish the order.</b> On the buyer page, either press <i>I got it: release payment</i> (the merchant is paid),
            or <i>Something went wrong: open dispute</i>, write a note and press <i>Send dispute</i>. The protection window is
            5 minutes here, so do it before it ends.
          </li>
          <li>
            <b>Decide the dispute as the resolver.</b> On the disputed order, press <i>Decide this dispute as the resolver →</i>,
            then <i>Refund buyer</i> or <i>Pay merchant</i>. Those are the only two options the contract allows.
            <button onClick={() => go('resolver', '#/resolve')}>Open the resolver console</button>
          </li>
        </ol>
        <p className="muted small">Shared by everyone, so you'll see other visitors' sandbox orders. The sandbox merchant and resolver
          use public test keys that hold only test funds; they're never offered on mainnet. Want your own shop? <a href="#/merchant" onClick={ownShop}>Set one up</a>:
          it takes a few minutes once.</p>
        <p className="tryfeedback">Tried it? <a href="#/feedback">Tell us what you think</a>: what would stop you using Held?</p>
      </div>
    </div>
  )
}
