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

## Tests (live on Tempo Moderato, chainId 42431)

| Script | What it checks | Result |
|---|---|---|
| `npm run spike:day1` | contract as recovery authority: all rules + negative tests | 29/29 ([log](docs/day1-testnet-run.log)) |
| `npm run test:virtual` | per-order virtual-address payments through the arbiter | 12/12 ([log](docs/day2-virtual-address-run.log)) |
| `npm run test:indexer` | API + indexer: order states for release, dispute, wrong token, underpayment | 12/12 ([log](docs/day3-indexer-run.log)) |

## Current testnet deployment

See `deployment.json`. Arbiter: [`0x853dec…cb2c`](https://explore.testnet.tempo.xyz/address/0x853dec037c6e742ad1478e849377c4b80f68cb2c),
window 300 s (short for the demo).

## Honest limits

- Testnet only. The resolver is a single fixed address. Claims are all-or-nothing per payment (no partial refunds).
- The demo server holds the merchant's and resolver's own testnet keys so the dashboard buttons can act for those roles.
  The contract limits what those keys can do. Buyers always sign from their own wallet.
