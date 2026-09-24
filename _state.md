# Held build state
Project: /Users/emilbob/Documents/Hackathon/held (moved here from ~/held on Sep 24; the user moved it)
Repo: https://github.com/emilbob/held (public, approved)
Spec: ../research/final-direction.md (locked; the user approved it on Sep 24 with no changes)

## Day 1: Sep 23 (done)
- A contract (HeldArbiter) works as the receive-policy recovery authority for both resume (-> merchant) and reroute
  (-> payer) claims. The plain-wallet fallback is NOT needed. 29/29 testnet checks: docs/day1-testnet-run.log
- Product rules approved by the user (Sep 24): one fixed resolver set at deploy; the buyer confirms by calling release;
  the payer can self-refund a wrong-token payment.

## Day 2: Sep 24 (done)
- scripts/setup-merchant.mjs: persistent demo merchant. Idempotent: keys in .state/merchant.json (gitignored,
  testnet only), salt mined (164 s, pass 0 missed, pass 1 hit), virtual master registered, arbiter deployed,
  receive policy set. Public info in deployment.json:
    merchant 0xeDaCEd839530f85591cC7b5db6C1d79a7e6563ed, masterId 0x82bfcada,
    arbiter 0x853dec037c6e742ad1478e849377c4b80f68cb2c, window 300s (short for the demo; production would be ~7 days)
- Virtual-address payments go through HeldArbiter: 12/12 checks (docs/day2-virtual-address-run.log).
  The receipt recipient is the virtual address itself, so the order id comes straight from the receipt.

## Day 3: Sep 24 (done, ahead of plan)
- server/: indexer + API (plain node:http, JSON-file store at .state/db.json).
  Reads TransferBlocked(receiver=merchant) and arbiter Disputed/Released/Refunded, then sets order states:
  awaiting_payment -> held -> (releasable after window) -> released | disputed -> released/refunded | refunded.
  Wrong-token payments are flagged separately; underpayment is flagged.
- Held's server never signs release/refund; users' wallets call the arbiter directly.
- 12/12 end-to-end API checks: docs/day3-indexer-run.log

## Notes / gotchas
- Gas is paid in pathUSD, so balance-delta checks must re-snapshot after the account sends a tx.
- The RPC getLogs range limit is somewhere between 100k and 200k blocks (about 0.6 s/block); the indexer uses 50k chunks.
- Early-release fee: out of scope unless everything else is done.
- No agentic features in the core build (the user's decision).

## Next
- Days 9-12 work (starting early): web/ with the merchant dashboard, buyer pay page (QR/address) and buyer confirm/dispute page.
- Later: Foundry unit tests if time allows (Foundry isn't installed; solc-js is used now), demo + pitch video.
- Near submission: remind the user to change the form answer to "most of the implementation" (the coder has written all the code so far).
