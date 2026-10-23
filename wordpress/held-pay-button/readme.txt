=== Held – Pay with Held button ===
Contributors: held
Tags: payments, stablecoin, checkout, button, buyer protection
Requires at least: 6.3
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

A "Pay with Held" button for your checkout links: stablecoin payments with buyer protection, showing the live price.

== Description ==

Held holds a buyer's stablecoin payment until they confirm delivery. A held payment can only go to the merchant or back to the buyer.

This plugin adds a "Pay with Held" button for one of your Held checkout links. It shows the link's live price, and it greys out if you turn the link off in your Held dashboard.

Held is in beta and runs on Tempo testnet: test funds only.

= Using it =

1. Make a checkout link in your Held dashboard at https://getheld.xyz and copy it.
2. In the editor, add the "Pay with Held" block and paste the link. You can also paste the link on its own line, and it turns into the button.
3. Label, theme, "buyer protected" tagline, new tab and corner radius are in the block's settings.

Classic editor or a page builder? Use the shortcode:

`[held_button link="https://getheld.xyz/#/buy/Ab3xYz"]`

Options: `label="Buy the poster"`, `theme="light"`, `tagline="false"`, `newtab="false"`, `radius="0"`, `align="center"`.

= External service =

To show the price, the button asks the site in your checkout link (getheld.xyz) for that link's public details: product name, price, and whether it's on. No visitor data is sent. When a buyer clicks, they go to Held's checkout page.

Terms: https://getheld.xyz/#/terms
Privacy: https://getheld.xyz/#/privacy

== Changelog ==

= 1.0.0 =
* First version: "Pay with Held" block and [held_button] shortcode.
