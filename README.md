# Held

Buyer protection for stablecoin payments on Tempo.

The buyer pays with a plain transfer from any wallet. The chain holds the money until delivery, and a limited
arbiter contract can only release it to the merchant or refund the buyer.

Built for the Colosseum Crypto World's Fair, Tempo track.

## How it works

1. The merchant's checkout address has a Tempo receive policy (TIP-1028) that holds every incoming transfer
   in the protocol's `ReceivePolicyGuard`. The policy's recovery authority is the `HeldArbiter` contract.
2. Each order gets its own virtual address (TIP-1022), so payments match orders. *(in progress)*
3. `HeldArbiter` is the only party that can claim held funds, and it can only send them to two places:
   - **release** → the merchant (a "resume" claim)
   - **refund** → the original payer (a "reroute" claim)

| Action | Who can call it |
|---|---|
| `release` | the buyer (confirming delivery) at any time; **anyone** after the protection window; only the resolver if disputed |
| `dispute` | only the original payer, only inside the window, only once |
| `refund` | the merchant (voluntary); the resolver if disputed; the payer themselves if they sent a token the merchant doesn't accept |

Every payment gets exactly one decision. No party can send held funds anywhere else, including the merchant, the resolver and Held.

## Status

**Day 1 (done):** a contract works as the recovery authority on Tempo Moderato testnet, for both resume and reroute
claims. `scripts/day1-contract-authority.mjs` deploys `HeldArbiter` and runs 29 checks, including negative tests.
All 29 pass. Log: [`docs/day1-testnet-run.log`](docs/day1-testnet-run.log).

## Run it

```bash
npm install
npm run compile      # solc-js -> out/HeldArbiter.json
npm run spike:day1   # deploys a fresh arbiter on Tempo Moderato (chainId 42431) and runs all checks (~2 min)
```

Uses fresh random keys and testnet faucet funds only.
