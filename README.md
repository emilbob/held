# Held

Buyer protection for stablecoin payments on Tempo.

The buyer pays with a plain transfer from their own wallet. The chain holds the money until delivery, and a limited
arbiter contract can only release it to the merchant or refund the buyer.

Built for the Colosseum Crypto World's Fair, Tempo track.

## How it works

1. The merchant's checkout address has a Tempo receive policy (TIP-1028) that holds every incoming transfer
   in the protocol's `ReceivePolicyGuard`. The policy's recovery authority is the `HeldArbiter` contract.
2. Each order gets its own virtual address (TIP-1022, userTag = order id). Payments match orders with no
   per-order transaction or cost.
3. `HeldArbiter` is the only party that can claim held funds, and it can only send them to two places:
   - **release** → the merchant (a "resume" claim)
   - **refund** → the original payer (a "reroute" claim)

| Action | Who can call it |
|---|---|
| `release` | the buyer (confirming delivery) at any time; **anyone** after the protection window; only the resolver if disputed |
| `dispute` | only the original payer, only inside the window, only once |
| `refund` | the merchant (voluntary); the resolver if disputed; the payer themselves if they sent a token the merchant doesn't accept |

Every payment gets exactly one decision. No party can send held funds anywhere else, including the merchant, the resolver and Held.

## How the dApp works

- **Merchants** open `#/merchant`, connect the wallet that will be their checkout address, sign in (a signed message,
  no transaction) and run a one-time setup from that wallet: mine the checkout address's TIP-1022 salt in the browser,
  register it, deploy their own `HeldArbiter`, and set the receive policy. Held's server then verifies the setup
  on-chain before listing the merchant, including a byte-for-byte check that the arbiter is the genuine contract.
- **Buyers** open the checkout link (`#/pay/:id`), pay from any wallet, then confirm delivery or open a dispute.
- **Resolvers** decide disputes at `#/resolve`: refund the buyer or pay the merchant, nothing else.

Held's server holds no keys and signs nothing. Every release, refund, dispute and resolution is signed by that
party's own wallet, and the arbiter contract enforces who may do what.

## Layout

```
contracts/HeldArbiter.sol   the arbiter (one per merchant; recovery authority for that merchant's payments)
shared/                     data types shared by server and web; HeldArbiter.json (ABI + bytecode)
server/                     API, sign-in, on-chain merchant verification (merchants.ts), multi-merchant indexer
web/                        React app: landing, merchant setup + dashboard, buyer page, resolver console
network.json                network settings: chain, accepted stablecoin, default resolver, default window
docs/                       test run logs
```

## Run it

```bash
npm install && npm run compile
(cd web && npm install && npm run build)
npm run server                      # http://localhost:8787, then open #/merchant to set up a shop
```

## Tests

### Unit tests (Foundry, Tempo fork)

```bash
foundryup -n tempo        # Tempo's Foundry fork (forge 1.8.3+)
forge test                # or: npm test
```

`test/HeldArbiter.t.sol` has 33 tests: 29 unit tests and 4 fuzz tests (512 runs each). They run on Tempo Foundry's
local EVM with the **real protocol precompiles**: TIP-20 tokens, TIP-403 receive policies, the ReceivePolicyGuard and
the virtual-address registry. Nothing is mocked; every held payment and claim goes through the same code as on
testnet. Coverage:
- every rule and every negative case (who can release, dispute or refund, and when; one decision per payment; the window boundary)
- no wallet can claim from the guard directly; a tampered receipt can't redirect a refund; the arbiter ignores
  receipts held under another authority or for another merchant
- fuzz: any amount moves exactly; any random caller is powerless; for any sequence of 6 actions by any mix of
  buyer, merchant, resolver or stranger, held money only ever reaches the merchant or the original payer, all or nothing

Mutation check: breaking the early-release rule makes 5 tests fail, and redirecting merchant refunds to the merchant
makes 3 fail. Log: [`docs/forge-test-run.log`](docs/forge-test-run.log).

### Live testnet checks (Tempo Moderato, chainId 42431)

| Script | What it checks | Result |
|---|---|---|
| `npm run spike:day1` | contract as recovery authority: all rules + negative tests | 29/29 ([log](docs/day1-testnet-run.log)) |
| `npm run test:virtual` | per-order virtual-address payments through the arbiter | 12/12 ([log](docs/day2-virtual-address-run.log)) |
| `npm run test:e2e` | the real dApp: a new merchant sets up from its own wallet, sign-in, on-chain registration (fake and 1-byte-tampered arbiters refused), orders, release, merchant refund, dispute decided by the resolver's wallet | 24/24 ([log](docs/merchant-e2e-run.log)) |

### Wallets (browser end-to-end)

Buyers, merchants and resolvers each sign from their own wallet. The wallet picker offers:
- **Tempo Wallet** (wallet.tempo.xyz passkey account, via Tempo's official Accounts SDK `accounts`): pay,
  confirm delivery and dispute. `node e2e/tempo-wallet.ts` creates a fresh Tempo Wallet account in a throwaway
  Chrome for Testing profile (a CDP virtual authenticator stands in for Touch ID) and runs all three: 4/4
  ([log](docs/tempo-wallet-e2e-run.log)).
- **Installed wallet extensions**, each listed by name (EIP-6963; e.g. MetaMask, Rabby), adding Tempo Moderato automatically. `node e2e/metamask.ts`
  loads real MetaMask 13.49.0 (official release, SHA256 verified) into a throwaway Chrome for Testing profile,
  imports a fresh testnet-only seed generated in memory for that run (never stored or reused), and tests connect,
  add network, switch network, pay, confirm delivery and dispute: 7/7 ([log](docs/metamask-e2e-run.log)).
- **Test wallet** (testnet only): a throwaway key in the browser, one per role, auto-funded from the testnet faucet.

## Why Held

Stablecoin checkout is going mainstream but still behaves like cash for the buyer. Stripe's stablecoin payments, the
market leader, list "Dispute support: No": once sent, a payment can't be reversed, and if a merchant never delivers the
buyer has no recourse.

**Held's advantage: the chain itself holds the payment.** The buyer just sends a plain transfer from their own wallet,
and nobody (not the merchant, not Held) can move the money anywhere except back to the buyer or on to the merchant.

| | Buyer's side | Who holds the money | Buyer protection |
|---|---|---|---|
| Stripe stablecoin checkout | Redirect + connect a wallet | Stripe (custodial) | None ("Dispute support: No") |
| Circle Refund Protocol | `approve` + `pay()` on an escrow contract | Escrow contract | Yes |
| Stabledrop | Fund a smart-contract escrow | Escrow contract | Yes (1% flat) |
| Settld | Through the platform's API flow | Escrow contract | Yes (early access) |
| **Held** | **A plain transfer from their own wallet** | **Tempo's protocol (ReceivePolicyGuard)** | **Yes** |

Why this is only possible now: Tempo's receive policies (T6, June 2026) hold incoming transfers in a protocol-level guard
that only a designated recovery authority can claim, and virtual addresses (T3) give every order its own deposit address.
On other chains, protection means an escrow contract the buyer has to interact with.

The arbiter contract is the safety rule: it can only release to the merchant or refund the original payer, never anyone
else. Each merchant deploys their own, and Held verifies it byte for byte, so held funds are non-custodial by construction.

We're not the first to see this gap (Circle, Stabledrop and Settld are all working on it). Held is the lowest-friction
way to protected stablecoin checkout we know of.

## Honest limits

- **Testnet only** (Tempo Moderato). Mainnet comes after an external review of `HeldArbiter.sol`.
- **Pay from your own wallet, not an exchange.** Only the wallet that paid can confirm or dispute, and refunds go back
  to it; for an exchange withdrawal that's the exchange's wallet. Planned: a refund address the buyer registers per order.
- **The resolver** is one fixed address per merchant, chosen at setup. It can only refund the buyer or pay the merchant.
  A disputed payment waits for it (or for a merchant refund), so it should be a multisig or hardware wallet.
- Claims are all-or-nothing per payment (no partial refunds).
- Merchant setup mines a checkout address once, in the browser: seconds to about ten minutes.
- Tempo only: buyers need Tempo stablecoins.
