# Growpefy

One checkout for many Shopify stores. Remix + Postgres on Railway, mobile-first, in English.

## Logins
- **Super admin**: email `admin` (or `ADMIN_EMAIL`) + `ADMIN_PASSWORD`. Sees every store and the Store owners page.
- **Store owners**: sign up at `/signup` (turn off with `ALLOW_SIGNUP=false`) or get an account from the super admin.
  Owners only see and manage their own stores.

## Features
- Overview dashboard (all stores or one): revenue, orders, prepaid vs COD, AOV, checkout conversion,
  ad spend, ROAS, cost per order, top products, recent orders. Today by default; any range or All time.
- Store-wide online/COD discount plus product-specific discounts.
- Coupons for all products or selected products.
- "You may also like" products at checkout (chosen products or newest).
- COD rules: a phone that has paid online can only pay online afterwards; after a COD order the same phone
  waits 6 hours (configurable up to 1 year) before COD again. Online payment is always open.


Ek checkout, multiple Shopify stores. Remix + Postgres (Railway), mobile-first.

- Prepaid aur COD pe alag discount (store-wise %, default 70% / 10%)
- Coupons: % ya flat, min cart, max cap, prepaid/COD-only, stack ya replace, usage limit, start/end (IST)
- Bank offers: PayU Offer Engine ke `offer_key` se — PayU card check karke discount lagata hai
- Koi order/quantity limit ya COD blocking nahi
- Prices hamesha Shopify se server pe dobara padhe jaate hain (browser se aaya price use nahi hota)
- PayU reverse-hash + amount verify, duplicate callback safe
- Shopify order fail ho toh admin → Orders → "Retry push"

## Railway pe deploy

1. GitHub pe repo push karo.
2. Railway project → **+ New → Database → PostgreSQL**.
3. **+ New → GitHub repo** → ye repo. Service ke Variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `APP_URL` = `https://<service-domain>` (Settings → Networking → Generate domain, ya custom domain)
   - `ADMIN_PASSWORD` = strong password
   - `SESSION_SECRET` = lamba random string
   - `ADMIN_EMAIL` (optional, default `admin`) and `ALLOW_SIGNUP` (optional, `false` to stop self sign-up)
4. Deploy. Har start pe migrations apne aap chalte hain.
5. `https://<APP_URL>/login` kholo (purana `/admin` link bhi yahin aata hai).

## Store connect karna

1. **Shopify app** banao — Partner Dashboard (partners.shopify.com) → Apps → Create app (manually):
   - **App URL**: `https://APP_URL/shopify/install`
   - **Allowed redirection URL**: `https://APP_URL/shopify/callback`
   - Distribution: **Custom distribution** → apne store ka `xyz.myshopify.com` daalo
   - Scopes: `app/lib/scopes.ts` wali poori list (Install tab mein copy button bhi hai)
   - Client ID + Client secret copy karo
2. Admin → **Connect store** → details + Client ID/secret bharo → **Install** tab → **Connect with Shopify**
   (ya Partner wala install link kholo) → permission approve karo → **Test connection**.
   Purana `shpat_` token ho toh woh bhi seedha chalega.
3. Install tab ka script `theme.liquid` mein `</body>` se pehle paste karo:
   ```html
   <script src="https://APP_URL/embed.js?store=SLUG" defer></script>
   ```
   Cart "Checkout" aur "Buy it now" button apne aap yahan aayenge.
   Custom button: `data-cx-checkout` attribute, ya `Growpefy.go()` / `Growpefy.buyNow(variantId, qty)` (purana `MultiCheckout.*` bhi chalta hai).
4. PayU key/salt daalo → Install tab → **Test PayU**. Mode **Test** rakh ke ek prepaid + ek COD test order karo.

## Shipping
Store → Shipping tab. Rates by order value, state or pincode prefix, and payment method. A state/pincode rate
beats an all-India rate; among matches the cheapest wins; no match = free. Every Shopify order gets a shipping line.

## PayU webhooks
Webhook URL: `https://<checkout domain>/payu/webhook` — add it in PayU for payment success, failure and refund.
Every webhook is re-checked with PayU's verify / refund APIs before an order changes, so a closed browser
still ends in a confirmed order. Stuck "awaiting payment" orders are also re-checked when the order page
reloads, and from Orders → Details → "Check payment with PayU".

## Orders, abandoned checkouts, compare
- Dashboard → Orders: every store's orders (Paid / COD tags, refunds) and an Abandoned checkouts tab
  with WhatsApp / call / recovery link.
- Dashboard → Compare stores: up to 4 stores side by side.

## Facebook / Meta (har store ka alag)

1. Business Settings → **Users → System users** → system user banao (Admin).
2. **Assign assets**: ad account (Manage/View performance) aur pixel/dataset (Manage) do.
3. **Generate token** → permissions: `ads_read`, `ads_management`, `business_management` → token copy karo.
4. Admin → store **Settings → Facebook / Meta**: Ad account ID (sirf digits), token, Pixel ID → Save.
5. **Install** tab → **Test Facebook**.

Isse milta hai:
- **Facebook Ads** page: spend, cost per purchase (Meta), real cost per order (checkout ke actual orders se), ROAS,
  CTR/CPC/CPM, day-wise aur campaign-wise data, prepaid balance, lifetime spend, recharges/billing.
- Checkout pe **InitiateCheckout** + **Purchase** pixel, aur server-side **Conversions API** Purchase
  (same `event_id` = order id, toh double count nahi hota). COD pe Purchase bhejna setting se on/off.

Recharge history Meta API pe har account ke liye available nahi hoti — na mile toh page pe note dikhega.

## Bank offers

PayU dashboard → Offers mein offer banao (bank/BIN rules wahin set hote hain), uski key admin → Bank offers mein daalo.
Bina key ke offer sirf checkout pe dikhega, apply nahi hoga. Bank ka logo / "partnership" wording tabhi jab actual tie-up ho.

## Local dev

```bash
cp .env.example .env   # values bharo
npm install
npm run build && npm start   # ya: npm run dev
```
Schema badlo → `npm run db:generate` → naya SQL `drizzle/` mein commit karo.

## Notes

- Shopify/PayU secrets DB mein plain text hain — DB ko public mat karo (Railway private networking use karo).
- `orderCreate` + client-credentials grant Shopify API `2025-07` ke hisaab se likhe hain; pehla real test order zaroor check karo.
- PayU `net_amount_debit` se bank discount nikalta hai — test mode mein ek offer wala payment karke verify karo.
