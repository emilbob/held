// Roadmap (#/roadmap): where Held is and what comes next. No dates on purpose.
import { NET } from './wallet.ts'

const coins = NET.tokens.map((t) => t.symbol).join(', ')

const stages = [
  {
    when: 'Now', badge: NET.testnet ? 'Live on testnet' : 'Live', cls: 'lime',
    items: [
      'Buyer protection with the two-destination guarantee: a held payment can only go to the merchant or back to the payer',
      'Self-serve shops, set up from the merchant\'s own wallet',
      'Up to 3 accepted stablecoins per shop',
      'Disputes decided by the resolver the merchant chose',
      'Held\'s server holds no keys and never signs a release or refund',
    ],
  },
  {
    when: 'Next', badge: 'Free beta on mainnet', cls: 'amber',
    items: [
      'Real stablecoins on Tempo mainnet (USDC.e, USDT0)',
      'Orders capped at $250 while the contract is unaudited',
      'No Held fee until mid-2027: you only pay Tempo\'s network fees, cents or less',
    ],
  },
  {
    when: 'Later', badge: 'After the beta', cls: 'grey',
    items: [
      'Independent security audit of the arbiter contract',
      'Multisig resolver',
      'Refunds to an address the buyer chooses, so payments sent from an exchange are protected too',
      'Higher order limits',
      'From mid-2027: a 1% fee on released payments, written into each shop\'s contract when it\'s set up. Refunds are always free',
    ],
  },
]

export default function Roadmap() {
  return (
    <div className="narrow legal roadmap">
      <div className="card">
        <h1>Roadmap</h1>
        <p className="muted small">Held is in beta{NET.testnet ? ' and runs on Tempo testnet: test funds only' : ''}. Accepted stablecoins today: {coins}.</p>
        <ol>
          {stages.map((s) => (
            <li key={s.when}>
              <h2>{s.when} <span className={`badge ${s.cls}`}>{s.badge}</span></h2>
              <ul>{s.items.map((i) => <li key={i}>{i}</li>)}</ul>
            </li>
          ))}
        </ol>
        <p className="muted small">Questions or ideas? <a href="https://github.com/emilbob/held/issues" target="_blank" rel="noopener noreferrer">Open an issue on GitHub</a>.</p>
      </div>
    </div>
  )
}
