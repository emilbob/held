// Terms (#/terms) and Privacy (#/privacy) for the free beta. Plain language, and only what the app actually does.
import { NET } from './wallet.ts'
import { usd } from './ui.tsx'

const UPDATED = '1 October 2026'
const CONTACT = 'https://github.com/emilbob/held/issues'
const coins = NET.tokens.map((t) => t.symbol).join(', ')

export function Terms() {
  return (
    <div className="narrow legal">
      <div className="card">
        <h1>Terms of use</h1>
        <p className="muted small">Free beta · last updated {UPDATED}</p>

        <h2>What Held is</h2>
        <p>Held is software for buyer protection on stablecoin payments on Tempo{NET.testnet ? ' (this site runs on Tempo testnet: test funds only, no real value)' : ''}.
          A buyer pays a merchant with a plain token transfer. Tempo's protocol holds the payment, and the merchant's own arbiter contract
          can send it to exactly two places: the merchant (release) or the wallet that paid (refund).</p>

        <h2>Held never holds your money</h2>
        <p>Held's server holds no keys and cannot move funds. Every release, refund and dispute is signed in the wallet of the person
          acting. Payments are held by Tempo's ReceivePolicyGuard under rules set by the merchant's own contract, which nobody, Held
          included, can change after it's deployed.</p>

        <h2>Free beta</h2>
        <ul>
          <li>Held charges no fees during the beta. Tempo network fees (cents or less) are paid to the network, not to Held.</li>
          <li>Each order is limited to {usd(NET.maxOrder)} while Held is in beta. Accepted stablecoins: {coins}.</li>
          <li>Held is provided "as is", without warranties. It is new software; its contract is tested extensively but has not had an
            independent security audit yet. Use amounts you are comfortable with.</li>
        </ul>

        <h2>How protection works</h2>
        <ul>
          <li><b>Buyers:</b> pay from your own wallet. Only the wallet that paid can confirm delivery, open a dispute or receive a
            refund. A payment sent from an exchange is not protected: a refund would go back to the exchange, not to you.</li>
          <li><b>Protection window:</b> the buyer can dispute until the window shown on the order ends. After that, anyone can release
            the payment to the merchant.</li>
          <li><b>Disputes:</b> decided by the resolver the merchant chose at setup. The resolver can only refund the buyer or pay the
            merchant; that decision happens on-chain and is final.</li>
          <li><b>Wrong token:</b> a payment in a token the shop doesn't accept is never paid to the merchant; the payer can take it back.</li>
        </ul>

        <h2>Merchants</h2>
        <p>You are responsible for what you sell, for delivering it, and for your own legal and tax obligations. Held may remove a shop
          from the site (its on-chain contract keeps working; buyers can still release or get refunds).</p>

        <h2>Risks you accept</h2>
        <p>Blockchains, wallets and stablecoins carry risks Held can't control: lost keys, a mistyped address, network outages, or a
          stablecoin losing its peg. Transactions on Tempo can't be reversed except as the contract allows.</p>

        <h2>Liability</h2>
        <p>To the extent the law allows, Held and its developer are not liable for indirect or consequential losses, or for losses
          caused by things outside Held's control, including the blockchain, wallets, stablecoin issuers, or a merchant or buyer.</p>

        <h2>Changes and contact</h2>
        <p>These terms may change; the date above shows the latest version. Questions: <a href={CONTACT} target="_blank" rel="noopener">open an issue on GitHub</a>.
          See also the <a href="#/privacy">privacy page</a>.</p>
      </div>
    </div>
  )
}

export function Privacy() {
  return (
    <div className="narrow legal">
      <div className="card">
        <h1>Privacy</h1>
        <p className="muted small">Free beta · last updated {UPDATED}</p>

        <p>Held collects as little as it can. No accounts, no email, no analytics, no ads, no tracking cookies, and nothing is sold.</p>

        <h2>What Held stores</h2>
        <ul>
          <li><b>Merchants:</b> your wallet address, your shop name, your contract address, your orders and checkout links (item and price).</li>
          <li><b>Payments:</b> what's already public on Tempo: amounts, wallet addresses, transaction hashes, and the payment's status.</li>
          <li><b>Dispute notes:</b> what the buyer and merchant write. Only that merchant and their resolver can read them; they never
            appear on public pages.</li>
          <li><b>Sign-in sessions:</b> stored as a one-way hash, and deleted after they expire (7 days).</li>
          <li><b>Abuse protection:</b> a short one-way hash of your IP address for a few seconds when you open a checkout link; never the
            IP itself, and cleared daily.</li>
        </ul>

        <h2>On-chain data is public</h2>
        <p>Payments, releases, refunds and disputes are transactions on Tempo. They are public and permanent, and Held can't delete them.</p>

        <h2>In your browser</h2>
        <p>Held uses your browser's local storage (not cookies) to remember your sign-in and which wallet you chose
          {NET.testnet ? ', and the key of a test wallet if you create one (testnet only)' : ''}. Clearing your browser's site data removes it.</p>

        <h2>Where it lives</h2>
        <p>Held's servers run on Vercel, which keeps short-lived request logs (including IP addresses) as part of hosting. The
          database is Supabase (Postgres, US East); daily backups are kept for 7 days in Upstash. The page talks to Tempo's network
          directly from your browser; if you use Tempo Wallet, Tempo provides it.</p>

        <h2>Order pages</h2>
        <p>Each order has its own buyer link with a random key. Anyone you share that link with can see the order (item, price, status),
          so share it only with your buyer.</p>

        <h2>Your choices</h2>
        <p>To have your shop or its off-chain data removed, <a href={CONTACT} target="_blank" rel="noopener">open an issue on GitHub</a>.
          On-chain data can't be removed by anyone.</p>
      </div>
    </div>
  )
}
