=== Growpefy Checkout for WooCommerce ===
Contributors: growpefy
Tags: checkout, cod, one page checkout, india, otp
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
WC requires at least: 7.0
Stable tag: 1.0.0
License: GPLv2 or later

Fast one-page checkout for Indian WooCommerce stores: COD OTP, prepaid and partial COD offers, up to 3 payment gateways, RTO protection.

== Description ==

When a shopper opens your Checkout page, the cart is sent to Growpefy and the shopper completes the order there. The order is then created in WooCommerce with the items, discounts, shipping, payment method and stock reduced, so your usual fulfilment keeps working.

* If Growpefy can't be reached, your normal WooCommerce checkout shows, so you never lose an order.
* Test mode: only logged-in admins get the Growpefy checkout until you switch it on for everyone.
* Every request between your store and Growpefy is signed with your secret key.
* Works with HPOS (custom order tables) and the block Cart / Checkout.

== Installation ==

1. Plugins → Add New Plugin → Upload Plugin → choose growpefy-woocommerce.zip → Install Now → Activate.
2. WooCommerce → Growpefy: paste the Growpefy URL, Store ID and Secret key from your Growpefy dashboard (Store → Setup). Save.
3. In Growpefy, click Test connection. Place a test order as admin, then untick "Only for logged-in admins".

== Changelog ==

= 1.0.0 =
* First release.
