# Manual end-to-end test (testnet, getheld.xyz)

Rule: **each role uses a different wallet.** The resolver account must never be the merchant or the buyer.

| Role | Wallet |
|---|---|
| Resolver | Tempo Wallet resolver account `0xcFbD…81B9` (the default resolver) |
| Merchant | MetaMask, a fresh account ("Held merchant") |
| Buyer | "Test wallet in this browser", in a private/incognito window |

Everything is on testnet: test funds are free and added automatically. Note anything confusing, slow or broken.

## Part 1: Sandbox (one browser is enough)
- [ ] getheld.xyz → **Try the sandbox** → **Open the Sandbox Shop**: dashboard opens with no flicker
- [ ] Create an order ("Test 1", $1) → **Buyer page →**
- [ ] **Test wallet in this browser** → pay → status "Held: protected"
- [ ] Dashboard → **Try to pay yourself early** → refused
- [ ] Buyer page → **I got it: release payment** → "Paid to merchant" + feedback prompt
- [ ] Second order → pay → **Open a dispute** with a note
- [ ] Footer **Resolver** → **Refund the buyer** → buyer page shows "Refunded"

## Part 2: Your own shop (normal window + private window)
**A. Merchant setup** (normal window, MetaMask)
- [ ] getheld.xyz/#/merchant → connect MetaMask "Held merchant" (approve adding Tempo testnet if asked)
- [ ] **Sign in with this wallet** (free, moves no money)
- [ ] Shop name; window **5 minutes**; **Resolver** shows `0xcFbD…81B9`; read the fee line
- [ ] **Start setup** (a few minutes; keep the tab open), approve **3 transactions** → dashboard

**B. Happy path (order A)**
- [ ] Create order A ($1), copy the buyer link
- [ ] Private window: open link → Test wallet in this browser → Pay → "Held: protected"
- [ ] Dashboard: order A Held, "Held for buyers" $1
- [ ] Buyer: **I got it: release payment** → "Paid to merchant"; merchant balance +$1

**C. Dispute decided by you (order B)**
- [ ] Create order B ($1), pay in the private window
- [ ] Buyer: **Open a dispute** + note → "Disputed"
- [ ] Dashboard: order B Disputed with the note (optionally reply)
- [ ] Normal window: getheld.xyz/#/resolve → connect **Tempo Wallet resolver account** → sign in
- [ ] Order B listed with notes → **Refund the buyer** → approve
- [ ] Buyer page "Refunded"; buyer gets the full $1 back

**D. Must be refused / edge cases**
- [ ] Merchant **Try to pay yourself early** on a held order → refused
- [ ] Order C: pay, don't confirm, wait 5 minutes → "releasable" → merchant releases
- [ ] Order D: pay, merchant **Refund** → buyer gets 100% back

## Part 3: Final checks
- [ ] Lime **Feedback** button → send one message starting with **"TEST:"**
- [ ] Phone: open getheld.xyz, try the sandbox, nothing runs off the screen
- [ ] MetaMask: any red "suspicious site" warning on getheld.xyz? (held-lilac.vercel.app had one)

## Report back (in the chat)
What failed (screenshot + step), what confused you, and whether MetaMask warned you.
