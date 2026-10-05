// FAQ (#/faq): plain answers, each one true to what the contract and app actually do (contracts/HeldArbiter.sol).
import type { ReactNode } from 'react'
import { NET } from './wallet.ts'
import { usd } from './ui.tsx'

const coins = NET.tokens.map((t) => t.symbol).join(', ')
const CONTACT = 'https://github.com/emilbob/held/issues'

const sections: [string, [string, ReactNode][]][] = [
  ['For buyers', [
    ['How does Held protect my payment?',
      <>You pay with a normal stablecoin transfer to the order's own address. Tempo holds the payment instead of passing it to the
        merchant, and the merchant's contract can send it to exactly two places: the merchant, or back to the wallet that paid.
        Nobody, Held included, can redirect it anywhere else.</>],
    ['My order arrived. What do I do?',
      <>Open your order page and confirm delivery. That releases the payment to the merchant. If you don't, the merchant can release
        it themselves once the protection window ends.</>],
    ['Something is wrong with my order.',
      <>Open a dispute on your order page before the protection window ends. The payment then stays frozen until the shop's resolver
        decides: refund you, or pay the merchant. The merchant can also refund you at any time.</>],
    ['How long am I protected?',
      <>Each shop sets its protection window ({NET.testnet ? 'from 5 minutes on testnet' : 'from 1 to 14 days, usually 7'}). Your
        order page shows exactly how much time is left.</>],
    ['Can I pay from an exchange?',
      <>Pay from your own wallet. Only the wallet that paid can confirm, dispute or receive a refund, so a payment sent from an exchange
        isn't protected: a refund would go back to the exchange, not to you.</>],
    ['What if I send the wrong token or the wrong amount?',
      <>A token the shop doesn't accept never reaches the merchant; it can only be returned to the wallet that sent it. If you pay less
        than the price, your order page says so; ask the merchant, who can refund you.</>],
    ['Do I need an account?',
      <>No. You only need a wallet, such as Tempo Wallet or a browser wallet like MetaMask. Held never asks for your email.</>],
  ]],
  ['For merchants', [
    ['How do I start accepting payments?',
      <>Go to <a href="#/merchant">For merchants</a> and connect a wallet. A one-time setup deploys your own Held contract and takes
        3 transactions. Use a wallet dedicated to your shop: after setup, every payment sent to it is held.</>],
    ['When do I get paid?',
      <>As soon as the buyer confirms delivery, or when you release the payment yourself after the protection window ends.</>],
    ['Can I refund a buyer?',
      <>Yes, at any time until the payment is settled, including during a dispute. The refund can only go to the wallet that paid.</>],
    ['Who is the resolver?',
      <>The address you choose at setup to decide disputes. By default it's Held's resolver, or you can name your own. A resolver can
        only refund the buyer or pay you; it can never send the money anywhere else, and it can't be changed after setup.</>],
    ['Which stablecoins can I accept?',
      <>Up to 3 per shop. {NET.testnet ? 'On testnet: ' : 'Available: '}{coins}.</>],
  ]],
  ['Safety and trust', [
    ['Who actually holds the money?',
      <>Tempo does. The payment sits in Tempo's ReceivePolicyGuard under the rules of the merchant's own contract. Held's server holds
        no keys and never signs a release or refund: every action is signed by the wallet of the person taking it.</>],
    ['What if Held\'s website goes down?',
      <>Your money stays held on Tempo, and the contract keeps working without Held. Anyone can still confirm, dispute or refund
        under the same rules by calling the contract directly, though for now that takes a developer tool.</>],
    ['What if the resolver never decides a dispute?',
      <>The payment stays held until the resolver decides or the merchant refunds. Nobody else can move it.</>],
    ['Has the contract been audited?',
      <>Not yet. It's tested extensively, including randomized tests of every rule, but an independent audit comes after the beta.
        Until then orders are capped at {NET.testnet ? '$250 on mainnet' : usd(NET.maxOrder)}. See the <a href="#/roadmap">roadmap</a>.</>],
  ]],
  ['Costs and the beta', [
    ['What does Held cost?',
      <>Nothing until mid-2027. You only pay Tempo's network fee for each transaction, a cent or less, in stablecoins.
        After that, Held plans a 1% fee on released payments, fixed in each shop's contract when it's set up so it can never
        be raised. Refunds are always free. See the <a href="#/roadmap">roadmap</a>.</>],
    ['Is this real money?',
      NET.testnet
        ? <>Not on this site: it runs on Tempo testnet with free test funds. A free beta on mainnet is next on the <a href="#/roadmap">roadmap</a>.</>
        : <>Yes. Held runs on Tempo mainnet with real stablecoins, as a free beta.</>],
  ]],
]

export default function Faq() {
  return (
    <div className="narrow legal faq">
      <div className="card">
        <h1>Questions and answers</h1>
        <p className="muted small">Short answers about how Held works. The full rules are in the <a href="#/terms">terms</a>.</p>
        {sections.map(([title, qs]) => (
          <section key={title}>
            <h2>{title}</h2>
            {qs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
          </section>
        ))}
        <p className="muted small">Something not answered here? <a href="#/feedback">Send us feedback</a> or <a href={CONTACT} target="_blank" rel="noopener noreferrer">open an issue on GitHub</a>.</p>
      </div>
    </div>
  )
}
