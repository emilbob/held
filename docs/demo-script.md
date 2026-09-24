# Held: 3-minute demo script (live product, Tempo Moderato testnet)

Setup before recording: `npm run setup` (already done; the merchant lives in .state/), `cd web && npm run build`,
`npm run server`, then open http://localhost:8787 (merchant) and the buyer page in a second window.
Protection window is 300 s so the "window closes" moment fits in the video. Create order #4 before you start
recording so its window has already closed by the end.

Every step below was run through the real UI on Sep 24 (see _state.md, "UI verification").

| Time | Screen | Action | What the viewer sees |
|---|---|---|---|
| 0:00 | Title | "Stripe says stablecoin payments have no disputes. Held adds buyer protection on Tempo, and the buyer just hits send." | |
| 0:15 | Dashboard | Create order "Hand-bound notebook", $20 | Order gets its own pay-to address; no tx, no cost |
| 0:25 | Buyer page | Show QR/address, then press "Pay $20.00" | A plain token transfer. Badge -> **Held: protected**, countdown starts |
| 0:45 | Dashboard | "Held for buyers $20"; merchant balance unchanged | Money is not with the merchant |
| 0:55 | Dashboard | Click **"Release to myself early"** and **"Take funds from the guard directly"** | Both 🔒 blocked (`NotAllowed`, `UnauthorizedClaimer`) |
| 1:10 | Buyer page | "I got it: release payment" | Badge -> **Paid to merchant**; merchant balance +$20 |
| 1:25 | Dashboard | Create order "Logo design", $15; buyer pays | Held |
| 1:35 | Buyer page | "Something went wrong: open dispute" | Badge -> **Disputed** |
| 1:45 | Buyer page (other wallet) | "Try to dispute from this wallet" | 🔒 "Only the wallet that paid can do this." |
| 1:55 | Dashboard | Resolver panel: "the only two options the contract allows" → **Refund buyer** | Badge -> **Refunded to buyer** |
| 2:10 | Buyer page | "Demo: pay with the wrong token" | ⚠ "held, not lost" → **Get it back** → returned |
| 2:30 | Dashboard | Order #4 (paid earlier) shows **Window over: releasable** → Release | Paid to merchant; anyone can trigger this |
| 2:40 | Explorer | Open the arbiter contract + a release tx | Onchain proof |
| 2:50 | Close | "Buyer protection without custody. The chain holds the money; the contract can only pay the merchant or refund the buyer." | |

Tip: keep the explorer tabs pre-opened. The recording can cut the 1–2 s wait for transaction confirmation.
