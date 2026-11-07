// Ready-made design blocks for website pages (About us, Contact…). Plain HTML with pb-* classes,
// styled by PAGE_BLOCKS_CSS on the storefront and inside the page editor. Liquid like {{ shop.name }} works.

const IMG_PH = "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#eceef1"/><path d="M300 380l90-110 70 80 50-55 90 85z" fill="#c9ced6"/><circle cx="520" cy="230" r="34" fill="#c9ced6"/></svg>');

export type PageBlock = { id: string; name: string; hint: string; html: string };

export const PAGE_BLOCKS: PageBlock[] = [
  { id: "hero", name: "Page header", hint: "Big heading with a short line", html:
`<section class="pb-hero"><h2>About {{ shop.name }}</h2><p>Your trusted destination for quality products, delivered fast across India.</p></section>` },
  { id: "card", name: "Text card", hint: "Heading and paragraph in a soft box", html:
`<div class="pb-card"><h3>🎯 Our mission</h3><p>Write what your brand stands for and what customers can expect from you.</p></div>` },
  { id: "two", name: "Two cards", hint: "Two boxes side by side", html:
`<div class="pb-grid pb-grid--2"><div class="pb-card"><h3>🎯 Our mission</h3><p>What you want to achieve for your customers.</p></div><div class="pb-card"><h3>📖 Our story</h3><p>How and why your brand started.</p></div></div>` },
  { id: "features", name: "Features", hint: "4 small boxes with an icon", html:
`<h2 class="pb-title">Why choose {{ shop.name }}?</h2><div class="pb-grid pb-grid--4"><div class="pb-feature"><span class="pb-icon">✨</span><h4>Premium quality</h4><p>Hand-picked products we trust.</p></div><div class="pb-feature"><span class="pb-icon">🛡️</span><h4>100% genuine</h4><p>Original products with warranty.</p></div><div class="pb-feature"><span class="pb-icon">💬</span><h4>Real support</h4><p>A real person on WhatsApp.</p></div><div class="pb-feature"><span class="pb-icon">🚀</span><h4>Fast delivery</h4><p>Quick shipping across India.</p></div></div>` },
  { id: "split", name: "Image with text", hint: "Photo on one side, text on the other", html:
`<div class="pb-split"><img src="${IMG_PH}" alt=""><div><h3>Made for everyday life</h3><p>Tell the story behind your products: where they come from, how you choose them and why people love them.</p></div></div>` },
  { id: "stats", name: "Numbers", hint: "Big numbers like 10k+ customers", html:
`<div class="pb-stats"><div><b>10,000+</b><span>Happy customers</span></div><div><b>4.8★</b><span>Average rating</span></div><div><b>24 hrs</b><span>Dispatch time</span></div><div><b>500+</b><span>Pincodes served</span></div></div>` },
  { id: "faq", name: "Questions (FAQ)", hint: "Questions that open on click", html:
`<div class="pb-faq"><details><summary>Do you offer cash on delivery?</summary><p>Yes, cash on delivery is available on most pincodes.</p></details><details><summary>How long does delivery take?</summary><p>Usually 3–7 working days after dispatch.</p></details><details><summary>How do I return a product?</summary><p>Message us on WhatsApp within 7 days of delivery with your order number.</p></details></div>` },
  { id: "cta", name: "Button banner", hint: "Dark banner with a button", html:
`<div class="pb-cta"><h3>Ready to shop?</h3><p>Explore our full range of products.</p><a class="pb-btn" href="{{ routes.all }}">Shop now →</a></div>` },
  { id: "contact", name: "Contact details", hint: "Phone, email, WhatsApp and address", html:
`<div class="pb-grid pb-grid--3"><div class="pb-feature"><span class="pb-icon">📞</span><h4>Call us</h4><p><a href="tel:+919000000000">+91 90000 00000</a></p></div><div class="pb-feature"><span class="pb-icon">✉️</span><h4>Email</h4><p><a href="mailto:support@yourbrand.com">support@yourbrand.com</a></p></div><div class="pb-feature"><span class="pb-icon">💬</span><h4>WhatsApp</h4><p><a href="https://wa.me/919000000000">Chat with us</a></p></div></div>` },
  { id: "button", name: "Button", hint: "One button, centred", html:
`<p class="pb-center"><a class="pb-btn" href="{{ routes.all }}">Shop now →</a></p>` },
  { id: "divider", name: "Divider", hint: "A thin line", html: `<hr class="pb-hr">` },
  { id: "space", name: "Empty space", hint: "Gap between blocks", html: `<div class="pb-space"></div>` },
];

export const PAGE_TEMPLATES: { id: string; name: string; hint: string; html: string }[] = [
  { id: "about", name: "About us", hint: "Header, mission & story, features, numbers, closing note", html: [
    PAGE_BLOCKS[0].html, PAGE_BLOCKS[2].html, PAGE_BLOCKS[3].html, PAGE_BLOCKS[5].html,
    `<div class="pb-card"><h3>Our commitment to you</h3><p>We are committed to giving you the best shopping experience, quality products and helpful service. Your satisfaction is our priority, and we stand behind every product we sell.</p></div>`,
    PAGE_BLOCKS[7].html,
  ].join("\n") },
  { id: "contact", name: "Contact us", hint: "Header, contact boxes, FAQ", html: [
    `<section class="pb-hero"><h2>Contact us</h2><p>We usually reply within a few hours, Monday to Saturday.</p></section>`,
    PAGE_BLOCKS[8].html, `<h2 class="pb-title">Common questions</h2>`, PAGE_BLOCKS[6].html,
  ].join("\n") },
];

/** Shared look for the blocks. Uses the theme's colours when present, sensible defaults otherwise. */
export const PAGE_BLOCKS_CSS = `
.page-body{--pb-brand:var(--brand,#111827);--pb-ink:var(--ink,#14171a);--pb-soft:var(--soft,#5a6169);--pb-tint:var(--tint,#f5f6f7);--pb-line:var(--line,#e6e8eb);--pb-r:var(--radius,14px)}
.page-body>*:first-child{margin-top:0}
.page-body img{max-width:100%;height:auto}
.page-body .pb-hero{text-align:center;padding:28px 0 12px}
.page-body .pb-hero h2{font-size:clamp(28px,5vw,44px);margin:0 0 10px;line-height:1.15}
.page-body .pb-hero p{font-size:17px;color:var(--pb-soft);max-width:560px;margin:0 auto}
.page-body .pb-title{text-align:center;font-size:clamp(22px,3.6vw,30px);margin:40px 0 18px}
.page-body .pb-card{background:var(--pb-tint);border-radius:var(--pb-r);padding:24px 26px;margin:20px 0}
.page-body .pb-card h3{margin:0 0 8px;font-size:21px}
.page-body .pb-card p{margin:0;color:var(--pb-soft)}
.page-body .pb-grid{display:grid;gap:16px;margin:20px 0}
.page-body .pb-grid>.pb-card{margin:0}
.page-body .pb-grid--2{grid-template-columns:repeat(2,minmax(0,1fr))}
.page-body .pb-grid--3{grid-template-columns:repeat(3,minmax(0,1fr))}
.page-body .pb-grid--4{grid-template-columns:repeat(4,minmax(0,1fr))}
.page-body .pb-feature{border:1px solid var(--pb-line);border-radius:var(--pb-r);padding:20px;text-align:center}
.page-body .pb-feature h4{margin:8px 0 4px;font-size:16px}
.page-body .pb-feature p{margin:0;font-size:14px;color:var(--pb-soft)}
.page-body .pb-icon{font-size:28px;line-height:1;display:block}
.page-body .pb-split{display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:center;margin:28px 0}
.page-body .pb-split img{width:100%;border-radius:var(--pb-r);display:block;object-fit:cover}
.page-body .pb-split h3{margin:0 0 8px;font-size:24px}
.page-body .pb-split p{margin:0;color:var(--pb-soft)}
.page-body .pb-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:28px 0;text-align:center}
.page-body .pb-stats b{display:block;font-size:clamp(24px,4vw,34px);color:var(--pb-ink)}
.page-body .pb-stats span{font-size:13px;color:var(--pb-soft)}
.page-body .pb-faq{display:grid;gap:10px;margin:20px 0}
.page-body .pb-faq details{border:1px solid var(--pb-line);border-radius:12px;padding:14px 16px}
.page-body .pb-faq summary{cursor:pointer;font-weight:600}
.page-body .pb-faq details p{margin:10px 0 0;color:var(--pb-soft)}
.page-body .pb-cta{background:var(--pb-ink);color:#fff;border-radius:var(--pb-r);padding:34px 24px;text-align:center;margin:28px 0}
.page-body .pb-cta h3{margin:0 0 6px;font-size:24px;color:#fff}
.page-body .pb-cta p{margin:0 0 18px;opacity:.75}
.page-body .pb-btn{display:inline-block;background:var(--pb-brand);color:var(--btn-text,#fff)!important;text-decoration:none!important;font-weight:600;padding:12px 24px;border-radius:var(--btn-radius,10px)}
.page-body .pb-cta .pb-btn{background:#fff;color:var(--pb-ink)!important}
.page-body .pb-center{text-align:center}
.page-body .pb-hr{border:0;border-top:1px solid var(--pb-line);margin:32px 0}
.page-body .pb-space{height:40px}
@media (max-width:760px){
  .page-body .pb-grid--2,.page-body .pb-grid--3,.page-body .pb-split{grid-template-columns:1fr}
  .page-body .pb-grid--4,.page-body .pb-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
}`;
