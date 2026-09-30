# Held: 3-minute demo video script (live dApp, Tempo testnet)

Everything runs on the live site, **held-lilac.vercel.app**, using the **sandbox** (a shop that's already set up), so
nothing in the recording waits on mining. Every step below has been run on the live site.

## Before you record (10 minutes)

1. **Use a clean Chrome profile** (Chrome → profile icon → Add). No MetaMask in it: MetaMask currently flags the domain,
   and the demo doesn't need it. Window about 1440×900, page zoom 110% so text is readable.
2. **Tempo Wallet:** in that profile, open wallet.tempo.xyz and log in to your **buying** account
   (`emilbob03@gmail.com`, the one with test funds), not the resolver account.
3. **Open these tabs, in this order:**
   1. `held-lilac.vercel.app/#/sandbox`: click **Open the Sandbox Shop** once, so the dashboard is signed in.
   2. `docs/demo/tote-co.html` (open the file in Chrome: the merchant's own website with the "Pay with Held" button).
      Its button uses a "Held tote bag, $18" link made in advance on the Sandbox Shop; the link you create on camera
      at 0:25 is the same product, so the cut is seamless.
   3. `held-lilac.vercel.app/#/sandbox`: click **Open the resolver console** once (signs in as the sandbox resolver),
      then leave the tab on the console.
   4. The explorer page for the Sandbox Shop's arbiter:
      `explore.testnet.tempo.xyz/address/0xf7d20fc2785d42bbfc08c2910903b27248ef7291`
4. **Timing:** the sandbox protection window is **5 minutes**. Open the dispute (1:50) within 5 minutes of that order's
   payment. Recording straight through is fine.
5. The buyer pages will show **"← Back to your orders"** at the top, because the recording browser is also signed in
   as the Sandbox Shop merchant. Real buyers never see it. Leave it (it's handy for switching back) or crop it out.
6. If a button says **"Tempo's testnet is busy"**, wait a few seconds and click again; cut the pause in editing.
   Transaction waits (1–3 s) can be cut too.

## Shot list

| Time | Screen | Do | Say (voiceover) |
|---|---|---|---|
| 0:00 | Title card, or Held landing page | — | "Stripe's stablecoin checkout lists 'Dispute support: No'. Once a buyer pays, the money's gone, even if the order never arrives. Held adds buyer protection, and the buyer just hits send." |
| 0:15 | Tab 1: Sandbox Shop dashboard | Point at the summary row | "This is a merchant on Held. The shop has its own arbiter contract, deployed from the merchant's own wallet. Held's server holds no keys." |
| 0:25 | Tab 1: **Checkout links** | Type "Held tote bag", "18" → **Create link**. Point at the button preview | "The merchant makes a checkout link, one product at a fixed price, and gets a 'Pay with Held' button for their own website." |
| 0:40 | Tab 2: Tote Co. site | Point at the button, then click it | "Here it is on the merchant's site. It's plain HTML: it works on Shopify, WordPress, anywhere." |
| 0:50 | Held buyer page (new tab) | Point at the price, the step bar and "Protected by Held" | "The buyer gets their own order at the merchant's price, with its own payment address." |
| 1:00 | Buyer page | **Tempo Wallet** → passkey prompt (Touch ID) → **Pay $18.00** | "They pay from their own wallet: Tempo Wallet, a passkey, no extension. It's a plain transfer: no approvals, no escrow contract to deal with." |
| 1:15 | Buyer page | Point at **Held: protected** and the countdown | "The payment is held by Tempo itself, not by the merchant, and not by us." |
| 1:22 | Tab 1: dashboard | Point at "Held for buyers $18.00", then **Try to pay yourself early** | "Can the merchant grab it early? No: the contract refuses." (🔒 *This wallet is not allowed to do that.*) |
| 1:35 | Buyer page | **I got it: release payment** | "The buyer got the bag and confirms. The merchant is paid instantly." (**Paid to merchant**, steps all ✓) |
| 1:45 | Tab 2 → button again → buyer page (new tab) | **Tempo Wallet** (passkey again) → **Pay $18.00**: a second order | "Now a second buyer, and this time something goes wrong." |
| 1:55 | Buyer page | **Something went wrong: open dispute** | "They open a dispute within the protection window." (middle step turns red: **Disputed**) |
| 2:05 | Tab 3: resolver console | Point at the dispute and the two buttons | "The dispute goes to the resolver the merchant chose. The contract gives them exactly two options: refund the buyer or pay the merchant. Nothing else, so even a stolen resolver key can't take the money." |
| 2:20 | Resolver console | **Refund buyer**, then back to the buyer page | "Refunded, straight back to the wallet that paid." (**Refunded. $18.00 was returned**) |
| 2:30 | Tab 4: explorer | Scroll the arbiter's transactions | "Everything you saw is on-chain, on Tempo testnet: held, released, disputed, refunded." |
| 2:40 | Held landing page | Point at **Try the sandbox (2 min)** | "It's only possible on Tempo: receive policies let the chain itself hold a plain payment. Merchants set up in minutes, buyers just hit send, and nobody but the buyer or the merchant can ever get the money. Try it yourself at held-lilac.vercel.app." |
| 2:55 | End card | — | "Held: buyer protection for stablecoin payments." |

## Optional extras (if you have time, or for a longer cut)

- **Merchant setup** (record separately, speed up 4×): `#/merchant` → connect a wallet → sign in → **Set up your shop**
  → the four steps tick off. Say: "Setup is one time, from the merchant's own wallet. Held then verifies their contract
  byte for byte before listing them."
- **Wrong token:** on a buyer page, **Test: pay with the wrong token** → "held, not lost" → **Get it back**.
- **Stranger can't dispute:** a different wallet on the same buyer page sees "Only the wallet that paid can confirm or
  dispute."
- **Window over:** a paid order left alone for 5 minutes shows **Window over: releasable**, and the merchant can release it.

## Don't say
- "First" stablecoin buyer protection (Stabledrop, Settld and Circle exist; say "lowest-friction").
- "Pay from any wallet **or exchange**" (exchange payments aren't protected yet; say "from their own wallet").
- Anything about mainnet being live (testnet only).

For questions after the demo: `../research/advantage.md`.
