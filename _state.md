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

## Sep 26: final regression + verification
- forge 33/33: all tests pass (run from repo root with ~/.foundry/bin/forge test)
- Local server running on :8787, window=300, creates orders (verified #1046)
- Live site held-lilac.vercel.app verified: order #1044 created, both flows (release #1067, refund #1068) confirmed live
- Web build clean; all e2e scripts passing
- Colosseum about text finalized (research/colosseum-about.md, 491 chars); submission answers drafted (research/submission-answers.md)

## Sep 26 (researcher + coder): error-messaging fix + final regression
- fix: distinguish contract reverts from server-auth errors in dashboard result messages (commit 95d2dc0).
  Contract reverts show "🔒 blocked by the contract (NotOriginator)"; server-auth errors show "🔒 Merchant and resolver actions need the demo admin token." without the "blocked by the contract" prefix.
- Both flows verified on LIVE Vercel deployment:
  - Flow 1 (release): order #1067 -> pay -> Held: protected -> "I got it: release payment" -> Paid to merchant / Delivery confirmed ✓
  - Flow 2 (refund): order #1068 -> pay -> Held: protected -> "Something went wrong: open dispute" -> Disputed -> dashboard "Refund buyer" -> Refunded to buyer / $20.00 returned ✓
- Local regression: Flow 1 (release) on #1069 confirmed working on localhost:8787 ✓
- Scratch files cleaned up: demo-drive.py, check-*.mjs/cjs, verify-*.mjs, ObjectDiff*.js, etc. (kept: tempo-wallet.mjs, metamask.mjs, mm-lib.mjs, mm-probe.mjs, live-proof-demo.mjs, diagnose-demo-wallet.mjs, screenshot-*.mjs, run-metamask.sh, demo-script.md)
- web/dist rebuilt + deployed to Vercel production (95d2dc0) ✓

## Next
- Demo video + pitch video (user paused this). Design is complete.
- Near submission: remind the user to change the form answer.

## Sep 30: JavaScript -> TypeScript (done, deployed)
- Whole repo is TypeScript (strict). web/ builds with `tsc && vite build`; server/, api/, scripts/ and e2e/ run
  natively under Node's type stripping (`node file.ts`, Node 26) and on Vercel. `npm run typecheck` checks everything.
- shared/api.ts: one set of data types for the server and web. e2e/mm-lib -> e2e/lib.ts (shared test helpers).
- Removed server/store.mjs (unused). File names in the dated entries above are the old .mjs/.js names.
- Verified: typecheck; local TS server returns identical orders to the old JS server (13/13); Vercel preview + prod
  serve the API from Redis; compile/export-abi output byte-identical. MetaMask e2e is 5/7 but the old JS build
  failed the same way (Tempo RPC "Request is being rate limited"); rerun when the testnet is calm.

## Sep 30: UI fine-tuning + full testnet regression (all pass)
- UI: new transparent logo (#D5F94F) and matching accent; phone layout (no overflow 320-1440px); buyer step bar
  (Pay > Held until delivery > Paid to merchant / Refunded, red "Disputed"); Copy address feedback; dashboard
  result list capped at 4; a rate-limited RPC now shows "Tempo's testnet is busy... Nothing was sent" (no 🔒).
- FIX (would have broken the live demo): order addresses depended only on the order number, and the local
  server, live site and previews all share one merchant and number from #1042. A new order inherited on-chain
  payments made to another environment's order with the same number (seen: local #1059/#1060 showed Sep 26 live
  payments). Now each order DB has a random 16-bit tagPrefix (userTag = prefix<<32 | id) and payments match orders
  by address. Old DBs get a prefix on their next order; existing orders keep their addresses.
- RPC: Tempo's public RPC rate-limits in bursts ("Request exceeds defined limit" / "Request is being rate
  limited"). Clients back off longer (5 retries); day1/day3 expected-revert checks no longer pass on an RPC error
  (they did before: a false pass); the MetaMask e2e retries like a user when the page says the testnet is busy.
- Regression, all on Moderato against the TS server: forge 33/33, day1 29/29, day2 12/12, day3 12/12,
  MetaMask 7/7, Tempo Wallet 4/4, UI flows 1-5 in the browser (release + both merchant cheats blocked;
  dispute -> resolver refund; wrong token flagged + returned; stranger dispute blocked; window expiry -> release).
  Logs in docs/*-run.log.

## Sep 30: merchant/resolver actions without pasting a token (option A)
- POST /api/orders returns a per-order key once (server stores sha256 only, never listed). The dashboard saves it
  (localStorage held.orderKeys) and sends it as x-held-order-key; that order's merchant/resolver buttons then work
  in the browser that created it. Other orders show a note instead of buttons. The owner token (x-held-admin,
  HELD_ADMIN_TOKEN) still unlocks everything; demo reset is owner-only. Orders from before this have no key.
- Verified (test server with a non-default owner token + a real testnet payment): 13/13 auth checks, plus the UI.
- Live findings (Sep 30): Tempo Wallet 4/4 on held-lilac with no warnings; MetaMask 7/7 but MetaMask/Blockaid flags
  held-lilac.vercel.app as malicious (connect + every tx). Not on MetaMask's public blocklist. Report a false
  positive to Blockaid; record the demo with Tempo Wallet.
- .state/admin-token no longer holds the token (the live site rejects it). The real one is HELD_ADMIN_TOKEN in
  Vercel. Don't run scripts/vercel-env.ts until that file is fixed: it would push the file's contents as the token.
- Live after deploy (Sep 30, no owner token, a judge's view): flow 1 cheats blocked + release (#1058), flow 2
  dispute + resolver refund (#1059), flow 5 window expiry + release (#1060), orders without a key show the note.
  A tab left open across a deploy keeps the old bundle until reloaded.

## Sep 30: demo -> real dApp (testnet)
- Direction (user, Sep 30): real dApp, fully tested on testnet, then mainnet. Solo builder. Merchants: any, self-serve.
- Server holds NO keys: merchant/resolver keys, admin token, order keys and /api/admin are gone. Every release, refund,
  dispute and resolution is signed in that party's own wallet.
- Merchants: #/merchant -> connect -> sign in (signInMessage, verified with pub.verifyMessage; Tempo passkeys supported)
  -> one-time setup from their wallet (web/src/setup.ts: browser mining, registerMaster, deploy own HeldArbiter, receive
  policy) -> POST /api/merchants, which verifies on-chain (server/merchants.ts): genuine bytecode (simulated deploy
  compared byte for byte), merchant/token/window, master owner, receive policy -> dashboard.
- Resolver console #/resolve (disputes for merchants who chose that resolver). network.json defaultResolver is still the
  old testnet resolver address: REPLACE with the user's own resolver wallet before real use.
- Storage: fresh .state/db-v2.json and Redis key held:v2:db (demo data untouched). Orders start at #1001.
- ox 0.14.45 bug: browser mining workers can miss 'start' (handler set after WASM loads) -> search never finishes.
  Fixed by a build-time patch in web/vite.config.ts (fails the build if ox changes) + a stall watchdog in setup.ts.
  Mining time varies a lot (seconds to ~10 min); memoryless, so restarts lose nothing.
- Tests (testnet): forge 33/33; npm run test:e2e 24/24 (new merchant setup, sign-in, fake + 1-byte-tampered arbiter
  refused, orders, release, merchant refund, dispute -> resolver); Tempo Wallet 4/4; MetaMask 7/7 (e2e orders come from
  a reusable test merchant, scripts/test-merchant.ts, key in .state/test-merchant.json); UI flows checked in Chrome.
- Removed: scripts/day3-indexer-e2e.ts (old API), scripts/vercel-env.ts (pushed server keys), server/arbiter-abi.json.
- To do before/after deploy: Vercel env MERCHANT_KEY / RESOLVER_KEY / HELD_ADMIN_TOKEN are unused now (delete them).

## Sep 30 (evening): sandbox, checkout links, live regression
- Sandbox (#/sandbox, testnet only): shared "Sandbox Shop" (merchant 0x170f…E892, arbiter 0xf7d2…7291, sandbox resolver
  0x3E33…38bD, 5-min window) with PUBLIC testnet keys in network.json (scripts/sandbox-setup.ts restores it). Server
  refuses re-registering the sandbox address with another arbiter.
- Checkout links (#/buy/:id) + copy-paste "Pay with Held" button (plain HTML, no script). npm run test:links (APP=… for live).
- Wallet: disconnect / account-switch events drop stale connections. Buyer page: "Back to your orders" in the
  merchant's own browser.
- Demo: docs/demo-script.md (3-min shot list on live, sandbox) + docs/demo/tote-co.html (button for live link hdlPKHJW).
  Submission answers refreshed (research/submission-answers.md, colosseum-about.md).
- Live regression: forge 33/33; Tempo Wallet 4/4 and MetaMask 7/7 against live (MetaMask/Blockaid still flags the
  domain); demo path on live in Chrome (#1010 released, #1011 disputed -> sandbox resolver refund); links 14/14 locally.
  Links on live pending the deploy of "turned-off check before the double-open guard" (Vercel sets x-forwarded-for).
- Open for the user: Blockaid false-positive report; record demo; paste submission answers; 3–5 merchant conversations.

## Sep 30 (late): dispute notes, previews, accessibility, UI polish (all live)
- Dispute notes: buyer's reason signed by the paying wallet (noteMessage), merchant replies with its session, resolver
  console signs in (per-role sessions: held.session / held.session.resolver) to read them; never on public pages.
  test:e2e 32/32 (8 note checks), Tempo Wallet 4/4, MetaMask 7/7; checked by eye on live.
- Link previews: OG/Twitter tags + web/public/og.png (e2e/og-image.ts renders it).
- Accessibility: axe zero violations on every page (h1 per page, labelled fields, underlined inline links, role=status).
- UI polish: footer one row; landing widths aligned + balanced headline; dashboard arbiter/resolver tiles, "Orders"
  filters (Needs action / Awaiting payment / Settled / All), aligned order columns, turned-off links folded; resolver
  empty state. Copy: "from their/your own wallet" everywhere (no "any wallet").
- Pushed through f0e7f74. Next session: more UI polish on request; user-side: Blockaid report, record demo
  (docs/demo-script.md), submission form (opens Oct 6, deadline Oct 12), merchant conversations.

## Oct 1: contract v2, network switch, Postgres (all live on testnet)
- HeldArbiter v2 (VERSION 2): up to 3 accepted stablecoins as immutables (covered by the byte-for-byte check); tokens
  the shop doesn't accept can only be refunded. forge 42 + invariants (30k random actions), fuzz 20k, mutation-checked.
- HELD_NETWORK=testnet|mainnet -> network.<name>.json (server, scripts, vite define). Mainnet: chain 4217, USDC.e
  0x20C0…8b50, USDT0 0x20C0…EB73, pathUSD (verified on-chain), maxOrder $250 (testnet $1,000). Mainnet RPC rpc.tempo.xyz.
- Fee tokens: arbiter calls default to pathUSD on Tempo; Tempo Wallet + page keys now name the fee token (the accepted
  stablecoin held most); MetaMask gets a pathUSD pre-check message. e2e: buyer with 0 pathUSD confirms delivery.
- Buyer page: choose stablecoin; Pay disabled until enough; "Adding free test funds…" during testnet top-up.
- Sandbox shop moved to v2 arbiter 0x79a9…3b94 (held v1 payments #1016/#1018 refunded first).
- Storage: Supabase project `held` (us-east-1, free plan, id anayotqghmejwmjbinwh), schemas held_testnet / held_mainnet.
  server/pgdb.ts: one transaction + advisory lock per write, single-statement atomic reads, counter/lastBlock can't go
  backwards. MUST use the SESSION pooler (5432): the transaction pooler (6543) returned empty reads under load, then hung.
  DATABASE_URL in .env.local and Vercel production. Live cut over Oct 1 14:20; Redis key held:v2:db frozen (rollback =
  remove DATABASE_URL on Vercel + redeploy).
- Tests: e2e 44/44 (file + Postgres), concurrency 6/6 (2 instances), Tempo Wallet 4/4 (local + live), MetaMask 7/7.
- Next: indexer hardening (paid RPC, reorgs), monitoring/alerts, mainnet dry run, resolver multisig, guarded launch.
  Supabase free plan pauses after 7 days idle (solved free: daily cron keep-alive + Upstash backup; no Pro needed for the beta). Order ids are sequential and order pages
  public: make buyer links unguessable before mainnet.

## Oct 1 (evening): ops, landing v2, submission
- Free-tier ops live: /api/cron/daily (CRON_SECRET; Supabase keep-alive + 7-day backup to Upstash, cleanup of expired
  sessions/rate limits; scripts/restore-backup.ts), /api/health + .github/workflows/uptime.yml (15 min, 'down' issues),
  indexer reads to finalized with a time budget (catch-up tested: 1M blocks in 2 runs). Free alt RPCs refuse getLogs.
- Buyer links: orders get a 96-bit key (#/pay/<key>); numeric ids only for the shop's merchant and pre-key orders.
- Terms (#/terms) and privacy (#/privacy); IPs hashed in rate limits.
- Landing v2: web/src/HeldFrame.tsx (canvas line-art, open/held/released/refunded), scroll story, film section
  (YouTube bjRJN8NoCAM, poster web/public/film-poster.jpg), guarantee, scroll cue. Motion in web/src/anim.tsx (no GSAP,
  ~2 KB). Navbar logo reloads to the landing.
- Colosseum form complete except the pitch video (user records with Superteam Balkan). Copilot v2 installed + signed in.
- Next: mainnet dry run (held-mainnet Vercel project, user's ~$3-5 USDC.e), then guarded free beta ($250 cap).

## Oct 2: beta label + roadmap
- Pre-flight for mainnet (read-only): chain 4217 live, USDC.e/USDT0/pathUSD, receive-policy + virtual-address precompiles
  and guard respond, rpc.tempo.xyz serves 50k-block getLogs, held_mainnet schema exists. No minimum order: pilot can be $0.10.
- Navbar "Beta" tag (links to the roadmap) + #/roadmap page (Now / Next / Later, no dates). Tempo link hidden on phones.
- Mainnet dry run on hold: the user wants more done before mainnet.
