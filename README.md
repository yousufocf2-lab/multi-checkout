# Multi-store Checkout

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
4. Deploy. Har start pe migrations apne aap chalte hain.
5. `https://<APP_URL>/admin` kholo.

## Store connect karna

1. **Shopify app** banao (store ke admin / Dev Dashboard mein). Scopes: `read_products`, `write_orders`
   (inventory adjust ke liye `write_inventory` bhi de do).
   - Admin API token (`shpat_…`) mile toh wo daalo, **ya** Client ID + Secret daalo (client-credentials token).
2. Admin → **Connect store** → details bharo → **Install** tab → **Test connection**.
3. Install tab ka script `theme.liquid` mein `</body>` se pehle paste karo:
   ```html
   <script src="https://APP_URL/embed.js?store=SLUG" defer></script>
   ```
   Cart "Checkout" aur "Buy it now" button apne aap yahan aayenge.
   Custom button: `data-cx-checkout` attribute, ya `MultiCheckout.go()` / `MultiCheckout.buyNow(variantId, qty)`.
4. PayU key/salt daalo, mode **Test** rakh ke ek prepaid + ek COD test order karo.

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
