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

## Day 4: Sep 24 (done, well ahead of plan: this was the Days 9-12 work)
- web/: React + Vite. Merchant dashboard (#/) and buyer page (#/pay/:id), served by server/server.mjs from web/dist.
  - Buyer: QR (EIP-681) + address, "Use demo wallet" (throwaway key in localStorage, auto-faucet) or an injected wallet.
    Pay, confirm (release) and dispute are signed by the BUYER's wallet directly against HeldArbiter.
  - Merchant: create order, balance, held total, countdown, refund, "try to cheat" buttons (early release,
    direct guard.claim), resolver panel for disputes, wrong-token return.
- Server added: POST /api/admin/{refund,release,resolve-release,resolve-refund,try-grab} (uses the merchant/resolver
  keys, header x-held-admin, default token "demo") and POST /api/faucet (demo wallets, 1 per minute per address).
- Verified: plain EVM transactions (no Tempo-specific fields, eip1559 and legacy) to a virtual address are held,
  so MetaMask-style wallets work. The wallet_addEthereumChain path isn't browser-tested yet (no extension here).
- UI verification (real browser, testnet, Sep 24), all passed:
  1. pay -> held -> merchant "release early" 🔒 NotAllowed, "take from guard" 🔒 UnauthorizedClaimer -> buyer confirms -> paid
  2. pay -> dispute -> resolver refund -> refunded
  3. wrong token -> flagged, order still awaiting payment -> buyer "Get it back" -> returned
  4. another wallet tries to dispute -> 🔒 "Only the wallet that paid can do this."
  5. window closed -> "Window over: releasable" -> release -> paid
- docs/demo-script.md: 3-min shot list matching the verified flows.

## Day 5: Sep 24 (the user approved 3 additions via hack-researcher; all done)
1. Foundry: Tempo fork installed (foundryup -n tempo, forge 1.8.3, ~/.foundry only, no profile edits).
   test/HeldArbiter.t.sol: 33 tests (29 unit + 4 fuzz x512) on REAL Tempo precompiles in the local EVM (TIP-20,
   TIP-403 receive policy, ReceivePolicyGuard, address registry). Nothing mocked. Mutation-checked (2 mutants,
   both caught). `npm test` / `forge test`. Log: docs/forge-test-run.log
   - Lesson: vm.expectRevert + low-level .call() gives false passes; use typed calls.
   - Test tokens are created via the TIP-20 factory + mint (deal() doesn't work on TIP-20 precompile storage).
2. Tempo Wallet: "Pay with Tempo Wallet" (npm `accounts` 0.18.4, tempoWallet adapter, EIP-1193 -> viem).
   Signs pay, release and dispute. e2e/tempo-wallet.mjs: 4/4 (docs/tempo-wallet-e2e-run.log).
   - Tempo Wallet opens a NEW popup per request, so the virtual authenticator must be re-seeded with the passkey
     each time (the e2e script syncs credentials across authenticators).
   - localhost is in the SDK's trusted hosts; a hosted domain may need adding by Tempo (check at hosting time).
3. MetaMask: real MetaMask 13.49.0 (GitHub release, SHA256 verified) in a throwaway Chrome for Testing profile
   (e2e/.cft, fresh temp user-data-dir, headless). A fresh in-memory seed per run. e2e/metamask.mjs: 7/7
   (docs/metamask-e2e-run.log): onboard, connect, add network, chain 0xa5bf, pay, release, dispute.
   - MetaMask 13.x approvals are in the Chrome SIDE PANEL: puppeteer's target.page() returns null, so drive it via
     target.createCDPSession() + Runtime.evaluate. Confirm button testids: confirm-btn, confirm-footer-button.
   - Chrome for Testing from @puppeteer/browsers extracted without Frameworks/: extract the zip with `ditto -x -k`.
- Polish: a "how it works" strip on the dashboard; wallet "Switch" button; faucet top-up for any connected wallet;
  `npm run demo:reset` (moves the DB aside, orders restart at #1042); npm scripts for e2e.
- Regression after polish: MetaMask 7/7, Tempo Wallet 4/4, indexer 12/12, forge 33/33.

## Sep 25: Redis + Vercel serverless deploy (done)
- Upstash Redis (held-kv) connected to held Production: KV_REST_API_URL + KV_REST_API_TOKEN set as Vercel env vars.
- api/api/index.js reads exactly those. State stored in Redis (KEY 'held:db'); indexing on-demand under a Redis lock.
- Deployed b7e1200 to Vercel production: https://held-lilac.vercel.app (commit b7e1200).
- Verified live: order #1044 "live-redeploy-check" ($1 pathUSD) created and in awaiting_payment state. /api/config healthy.
- Design fixes from 12c65e3 confirmed live: single Header "Held", dark --surface buttons with --ink text.

## Open items / needs a decision
- ~~HOSTING~~ RESOLVED: Vercel serverless + Upstash Redis handles it (no separate node service needed). MERCHANT_KEY / RESOLVER_KEY / HELD_ADMIN_TOKEN set in Vercel env.
- Demo video + pitch video — researcher/handoff item, not in scope for coder.
- Bundle is 563 kB (viem); fine for a demo.

## Sep 26: favicon + final polish
- Added lime H mark SVG favicon (web/public/held-favicon.svg), replacing the 88KB PNG in `<link rel="icon">`. PNG kept as alternate.
- web/dist rebuilt; deployed ae44386 to Vercel production.
- Local server running with window=300s (restored from 60s demo-recording value).

## Next
- Demo video + pitch video (user paused this). Design is complete.
- Near submission: remind the user to change the form answer.

