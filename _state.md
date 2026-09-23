# Held build state

## Day 1: Sep 23, 2026 (done)
- CRITICAL PATH CONFIRMED: a contract (HeldArbiter) can be the receive-policy recovery authority and call
  ReceivePolicyGuard.claim for resume (-> merchant) and reroute (-> originator). The plain-wallet fallback is NOT needed.
- 29/29 testnet checks pass (docs/day1-testnet-run.log, arbiter 0xd1357183fa23f295cf193a8f56c0abc1bfd94905).
  Covered: buyer confirms -> release; dispute -> resolver refund; merchant voluntary refund; wrong token self-refund;
  permissionless release after window; and the negative tests (stranger/merchant can't dispute, no release before window,
  no double decision, humans can't call guard.claim directly, no dispute after window).
- Tooling: solc-js 0.8.28 (Foundry isn't installed). Tests are live testnet scripts, not Foundry unit tests.

## Design choices made (within spec, flag if wrong)
- Resolver = a single address set at deploy (Held/merchant-chosen). It can only decide disputed payments, and only to merchant or payer.
- Buyer "confirm delivery" = buyer calls release (allowed any time).
- Wrong-token payments: payer can refund themselves any time; the merchant can refund too.
- One arbiter deployment per merchant (merchant, resolver, accepted token, window are immutable).

## Notes
- Gas is paid in pathUSD, so balance-delta checks must re-snapshot after the account sends a tx.
- Early-release fee (optional in spec): not implemented.

## Next (Days 2-8)
- Virtual per-order addresses wired to the arbiter (mine the salt once, store it). The arbiter's NotForMerchant check
  already resolves virtual recipients via the address registry, but this is untested with a real virtual address.
- Backend indexer: TransferBlocked -> orders (userTag = order id), plus arbiter events -> order state.
