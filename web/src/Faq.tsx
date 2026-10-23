// FAQ (#/faq): plain answers, each one true to what the contract and app actually do (contracts/HeldArbiter.sol).
import { useEffect, type ReactNode } from 'react'
import { NET } from './wallet.ts'
import { usd } from './ui.tsx'

const coins = NET.tokens.map((t) => t.symbol).join(', ')
const CONTACT = 'https://github.com/emilbob/held/issues'

// A question can carry an id: #/faq/<id> opens it and scrolls to it (the landing links to #/faq/website).
const sections: [string, [string, ReactNode, string?][]][] = [
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
        decides: refund you, or pay the merchant. The merchant can also refund you at any time, and if you sort it out with the
        merchant you can withdraw your dispute, which pays them.</>],
    ['How long am I protected?',
      <>Each shop sets its protection window ({NET.testnet ? 'from 5 minutes on testnet' : 'from 1 to 14 days, usually 7'}). Your
        order page shows exactly how much time is left.</>],
    ['Can I pay from an exchange?',
      <>Pay from your own wallet. Only the wallet that paid can confirm, dispute or receive a refund, so a payment sent from an exchange
        isn't protected: a refund would go back to the exchange, not to you.</>],
    ['What if I send the wrong token or the wrong amount?',
      <>A token the shop doesn't accept never reaches the merchant; it can only be returned to the wallet that sent it. If you pay less
        than the price, your order page says so; ask the merchant, who can refund you.</>],
    ['Why does my order page say a refund to my wallet would fail?',
      <>Some wallets accept payments only from certain senders, for example a Held shop's own checkout wallet. A refund has to be
        accepted by the wallet that paid, so pay from an ordinary wallet instead.</>],
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
      <>Held's neutral resolver decides disputes for every shop; a shop can't name its own. The resolver can only refund the buyer
        or pay you; it can never send the money anywhere else. After the beta it becomes a multisig, and later independent resolvers
        Held has approved can join.</>],
    ['Which stablecoins can I accept?',
      <>Up to 3 per shop. {NET.testnet ? 'On testnet: ' : 'Available: '}{coins}.</>],
    ['Can I add a "Pay with Held" button to my website?',
      <>Yes. Make a checkout link on your dashboard, then under <b>Put it on your site</b> pick <b>Framer</b>, <b>Webflow</b>, <b>WordPress</b> or{' '}
        <b>HTML button</b> for any other site that accepts HTML. The Framer, Webflow and WordPress buttons show the link's live price and grey out if
        you turn the link off. In Framer, add a new code file (Assets → Code) and paste it; in Webflow, paste it into a Code Embed
        (paid Webflow site plans; on a free plan, point a normal Button at your checkout link). In WordPress, install the
        Held plugin (download it from the WordPress button), then add the <b>Pay with Held</b> block and paste your link.</>, 'website'],
  ]],
  ['Safety and trust', [
    ['Who actually holds the money?',
      <>Tempo does. The payment sits in Tempo's ReceivePolicyGuard under the rules of the merchant's own contract. Held's server holds
        no keys and never signs a release or refund: every action is signed by the wallet of the person taking it.</>],
    ['Could a merchant switch the protection off?',
      <>A merchant controls their own wallet's settings, and Tempo can't lock them. So before you pay, your order page checks on the
        chain itself, not by asking Held, that the shop still holds every payment for its Held contract, and checks again when you press
        Pay. If it doesn't, the page says <b>Don't pay</b> and hides the address. Payments already held stay protected either way.</>],
    ['What if Held\'s website goes down?',
      <>Your money stays held on Tempo, and the contract keeps working without Held. Anyone can still confirm, dispute or refund
        under the same rules by calling the contract directly, though for now that takes a developer tool.</>],
    ['What if the resolver never decides a dispute?',
      <>Each shop sets a deadline for its resolver at setup ({NET.testnet ? 'from 10 minutes on testnet' : '3, 7 or 14 days'}), shown on
        the order. If the resolver hasn't decided by then, the buyer gets their money back: anyone can trigger the refund, and it always
        goes to the wallet that paid. After the deadline the resolver can no longer pay the merchant.</>],
    ['Has the contract been audited?',
      <>Not by an outside firm yet. It's tested extensively, including randomized tests of every rule, and was security-reviewed
        before mainnet, with what that review found fixed. Mainnet starts as a beta with low limits; an independent audit comes before
        those limits rise.{NET.testnet ? '' : ` Orders are capped at ${usd(NET.maxOrder)}.`} See the <a href="#/roadmap">roadmap</a>.</>],
  ]],
  ['Costs and the beta', [
    ['What does Held cost?',
      <>Nothing until mid-2027. You only pay Tempo's network fee for each transaction, a cent or less, in stablecoins.
        After that, Held plans a 1% fee on released payments, fixed in each shop's contract when it's set up so it can never
        be raised. Refunds are always free. See the <a href="#/roadmap">roadmap</a>.</>],
    ['Is this real money?',
      NET.testnet
        ? <>Not on this site: it runs on Tempo testnet with free test funds. A free beta on mainnet with low limits is next, see the <a href="#/roadmap">roadmap</a>.</>
        : <>Yes. Held runs on Tempo mainnet with real stablecoins, as a free beta.</>],
  ]],
]

export default function Faq({ open }: { open?: string }) {
  useEffect(() => { if (open) document.getElementById(`faq-${open}`)?.scrollIntoView({ block: 'center' }) }, [open])
  return (
    <div className="narrow legal faq">
      <div className="card">
        <h1>Questions and answers</h1>
        <p className="muted small">Short answers about how Held works. The full rules are in the <a href="#/terms">terms</a>.</p>
        {sections.map(([title, qs]) => (
          <section key={title}>
            <h2>{title}</h2>
            {qs.map(([q, a, id]) => <details key={q} id={id && `faq-${id}`} open={!!id && id === open}><summary>{q}</summary><p>{a}</p></details>)}
          </section>
        ))}
        <p className="muted small">Something not answered here? <a href="#/feedback">Send us feedback</a> or <a href={CONTACT} target="_blank" rel="noopener noreferrer">open an issue on GitHub</a>.</p>
      </div>
    </div>
  )
}
