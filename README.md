# Held

Buyer protection for stablecoin payments on Tempo.

The buyer pays with a plain transfer from any wallet. The chain holds the money until delivery, and a limited
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

## Layout

```
contracts/HeldArbiter.sol   the arbiter (recovery authority)
scripts/setup-merchant.mjs  one-time merchant setup: salt mining, virtual master, arbiter deploy, receive policy
server/                     indexer (TransferBlocked + arbiter events -> order states) and JSON API
web/                        React app: merchant dashboard (#/) and buyer pay / confirm / dispute page (#/pay/:id)
deployment.json             current testnet deployment (public info)
docs/                       testnet run logs, demo script
```

## Run it

```bash
npm install && npm run compile
npm run setup                       # one-time, ~3 min (salt mining); creates .state/merchant.json (testnet keys)
(cd web && npm install && npm run build)
npm run server                      # http://localhost:8787
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
| `npm run test:indexer` | API + indexer: order states for release, dispute, wrong token, underpayment | 12/12 ([log](docs/day3-indexer-run.log)) |

### Wallets (browser end-to-end)

The buyer page supports three wallets. Buyers always sign release and dispute from their own wallet:
- **Tempo Wallet** (wallet.tempo.xyz passkey account, via Tempo's official Accounts SDK `accounts`): pay,
  confirm delivery and dispute. `node e2e/tempo-wallet.mjs` creates a fresh Tempo Wallet account in a throwaway
  Chrome for Testing profile (a CDP virtual authenticator stands in for Touch ID) and runs all three: 4/4
  ([log](docs/tempo-wallet-e2e-run.log)).
- **Browser wallet** (MetaMask or any injected EVM wallet): adds Tempo Moderato automatically.
- **Demo wallet**: a throwaway key in the browser, auto-funded from the testnet faucet.

## Current testnet deployment

See `deployment.json`. Arbiter: [`0x853dec…cb2c`](https://explore.testnet.tempo.xyz/address/0x853dec037c6e742ad1478e849377c4b80f68cb2c),
window 300 s (short for the demo).

## Honest limits

- Testnet only. The resolver is a single fixed address. Claims are all-or-nothing per payment (no partial refunds).
- The demo server holds the merchant's and resolver's own testnet keys so the dashboard buttons can act for those roles.
  The contract limits what those keys can do. Buyers always sign from their own wallet.
