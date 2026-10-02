# Manual end-to-end test (testnet, getheld.xyz)

Rule: **each role uses a different wallet.** The resolver account must never be the merchant or the buyer.

| Role | Wallet |
|---|---|
| Resolver | Tempo Wallet resolver account `0xcFbD…81B9` (the default resolver) |
| Merchant | MetaMask, a fresh account ("Held merchant") |
| Buyer | "Test wallet in this browser", in a private/incognito window |

Everything is on testnet: test funds are free and added automatically. Note anything confusing, slow or broken.

## Part 1: Sandbox (one browser is enough)
Exact button names, checked on the live site Oct 2.
- [ ] getheld.xyz → **Try it** (navbar) → **Open the Sandbox Shop** → dashboard opens with no flicker
- [ ] **New order**: Item "Test 1", Amount 1 → **Create order** → on that order, **Buyer page →**
- [ ] **Test wallet in this browser** → "Adding free test funds to this wallet…" for a few seconds → **Pay $1.00 in pathUSD**
- [ ] Status becomes **Held: protected** ("Payment held: you're protected")
- [ ] Dashboard: on that order, **Try to pay yourself early** → refused ("This wallet is not allowed to do that")
- [ ] Buyer page: **I got it: release payment** → **Paid to merchant** + feedback prompt
- [ ] Second order → pay → **Something went wrong: open dispute** → write a note → **Send dispute** → **Disputed**
- [ ] Same buyer page: **Decide this dispute as the resolver →** (sandbox only; also on the dashboard as **Decide as the resolver →**,
      on the sandbox page as **Open the resolver console**, and in the footer as **Resolver**)
- [ ] Resolver console: the order with your note → **Refund buyer** (or **Pay merchant**)
- [ ] Buyer page shows **Refunded**

## Part 2: Your own shop (normal window + private window)
**A. Merchant setup** (normal window, MetaMask)
- [ ] getheld.xyz/#/merchant → connect MetaMask "Held merchant" (approve adding Tempo testnet if asked)
- [ ] **Sign in with this wallet** (free, moves no money)
- [ ] Shop name; window **5 minutes**; **Resolver** shows `0xcFbD…81B9`; read the fee line
- [ ] **Start setup** (a few minutes; keep the tab open), approve **3 transactions** → dashboard

**B. Happy path (order A)**
- [ ] Create order A ($1), copy the buyer link
- [ ] Private window: open link → **Test wallet in this browser** → wait for funds → **Pay $1.00…** → "Held: protected"
- [ ] Dashboard: order A Held, "Held for buyers" $1
- [ ] Buyer: **I got it: release payment** → "Paid to merchant"; merchant balance +$1

**C. Dispute decided by you (order B)**
- [ ] Create order B ($1), pay in the private window
- [ ] Buyer: **Something went wrong: open dispute** + note → **Send dispute** → "Disputed"
- [ ] Dashboard: order B Disputed with the note (optionally reply)
- [ ] Normal window: getheld.xyz/#/resolve → connect **Tempo Wallet resolver account** → sign in
- [ ] Order B listed with notes → **Refund buyer** → approve
- [ ] Buyer page "Refunded"; buyer gets the full $1 back

**D. Must be refused / edge cases**
- [ ] Merchant **Try to pay yourself early** on a held order → refused
- [ ] Order C: pay, don't confirm, wait 5 minutes → "releasable" → merchant releases
- [ ] Order D: pay, merchant **Refund buyer** → buyer gets 100% back

## Part 3: Final checks
- [ ] Lime **Feedback** button → send one message starting with **"TEST:"**
- [ ] Phone: open getheld.xyz, try the sandbox, nothing runs off the screen
- [ ] MetaMask: any red "suspicious site" warning on getheld.xyz? (held-lilac.vercel.app had one)

## Report back (in the chat)
What failed (screenshot + step), what confused you, and whether MetaMask warned you.
