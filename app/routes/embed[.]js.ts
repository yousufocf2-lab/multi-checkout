import type { LoaderFunctionArgs } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { db, stores } from "~/db.server";
import { storeBaseUrl } from "~/lib/urls.server";

/**
 * Storefront script. Add to theme.liquid before </body>:
 *   <script src="https://YOUR_APP/embed.js?store=STORE_SLUG" defer></script>
 * It redirects Shopify's checkout + Buy-now buttons to this checkout.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const slug = (new URL(request.url).searchParams.get("store") ?? "").replace(/[^a-z0-9-]/gi, "");
  const [store] = slug
    ? await db.select({ checkoutDomain: stores.checkoutDomain, logo: stores.logoUrl, color: stores.primaryColor, name: stores.name }).from(stores).where(eq(stores.slug, slug)).limit(1)
    : [];
  const base = storeBaseUrl(store ?? { checkoutDomain: null });
  const js = `(function(){
  var APP=${JSON.stringify(base)}, STORE=${JSON.stringify(slug)}, BRAND=${JSON.stringify({ logo: store?.logo ?? null, color: store?.color ?? "#111827", name: store?.name ?? "" })};
  if(!STORE||window.__CX_LOADED)return; window.__CX_LOADED=true;
  var root=(window.Shopify&&Shopify.routes&&Shopify.routes.root)||"/";

  // Clear the cart after a successful order (?cx_clear=1)
  try{var u=new URL(location.href); if(u.searchParams.get("cx_clear")==="1"){
    fetch(root+"cart/clear.js",{method:"POST"}).finally(function(){u.searchParams.delete("cx_clear");history.replaceState(null,"",u.toString());});
  }}catch(e){}

  function ck(n){var m=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));return m?decodeURIComponent(m[1]):null;}
  function fbcFromUrl(){try{var id=new URL(location.href).searchParams.get("fbclid");return id?"fb.1."+Date.now()+"."+id:null}catch(e){return null}}
  var busy=false;
  function esc(t){return String(t).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
  function overlay(on){var id="cx-overlay",el=document.getElementById(id);
    if(!on){if(el)el.remove();return;}
    if(el)return; el=document.createElement("div"); el.id=id; el.setAttribute("role","status");
    el.style.cssText="position:fixed;inset:0;z-index:2147483647;background:rgba(255,255,255,.96);display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1C2430;opacity:0;transition:opacity .18s ease-out";
    var head=BRAND.logo?'<img src="'+esc(BRAND.logo)+'" alt="" style="height:34px;max-width:160px;object-fit:contain;margin:0 auto 22px;display:block">':(BRAND.name?'<div style="font-weight:600;font-size:18px;margin-bottom:22px">'+esc(BRAND.name)+'</div>':'');
    el.innerHTML='<div style="text-align:center;padding:24px">'+head+'<div style="width:180px;height:4px;border-radius:4px;background:#ECEEEA;overflow:hidden;margin:0 auto"><div class="cx-bar" style="width:45%;height:100%;border-radius:4px;background:'+esc(BRAND.color)+'"></div></div><div style="margin-top:18px;font-weight:600;font-size:15px">Opening secure checkout</div><div style="margin-top:4px;font-size:13px;color:#7A8494">This takes a second</div></div><style>.cx-bar{animation:cxbar 1.1s cubic-bezier(.4,0,.2,1) infinite}@keyframes cxbar{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}@media (prefers-reduced-motion:reduce){.cx-bar{animation:none}}</style>';
    document.body.appendChild(el); requestAnimationFrame(function(){el.style.opacity="1"});}
  window.addEventListener("pageshow",function(e){if(e.persisted){busy=false;overlay(false);}});

  function go(items){
    if(busy)return; busy=true; overlay(true);
    var p=items?Promise.resolve(items):fetch(root+"cart.js",{credentials:"same-origin"}).then(function(r){return r.json()}).then(function(c){
      return (c.items||[]).map(function(i){return {variantId:String(i.variant_id),quantity:i.quantity}});});
    p.then(function(list){
      if(!list.length){throw new Error("empty")}
      return fetch(APP+"/api/session",{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify({store:STORE,items:list,fbp:ck("_fbp"),fbc:ck("_fbc")||fbcFromUrl(),url:location.href})});
    }).then(function(r){return r.json()}).then(function(d){
      if(!d.url)throw new Error(d.error||"no url"); location.href=d.url;
    }).catch(function(e){busy=false;overlay(false);
      if(String(e&&e.message)!=="empty")alert("We couldn\u2019t open checkout. Please try again.");});
  }

  function buyNow(variantId,qty){go([{variantId:String(variantId),quantity:Math.max(1,parseInt(qty||1,10))}]);}

  function isCheckoutEl(el){
    if(!el||!el.closest)return null;
    return el.closest('[name="checkout"],a[href$="/checkout"],a[href*="/checkout?"],button[onclick*="checkout"],.cart__checkout-button,.cart__checkout,#checkout,[data-cx-checkout]');
  }

  // Buy-now buttons: classic themes (.shopify-payment-button) and newer themes like Horizon,
  // where Shopify renders <shopify-buy-it-now-button> / <shopify-accelerated-checkout> web components.
  var BUY_SEL=".shopify-payment-button__button,.shopify-payment-button button,shopify-buy-it-now-button,shopify-accelerated-checkout,shopify-accelerated-checkout-cart,.shopify-payment-button,[data-cx-buy-now]";
  function findBuy(e){
    var path=(e.composedPath&&e.composedPath())||[e.target];
    for(var i=0;i<path.length;i++){var n=path[i];
      if(n&&n.nodeType===1&&n.matches&&n.matches(BUY_SEL)){
        // Light-DOM ancestor (the shadow host) so we can find the product form
        var host=n; while(host.getRootNode&&host.getRootNode()!==document&&host.getRootNode().host)host=host.getRootNode().host;
        return host.closest(BUY_SEL)||host;
      }}
    return null;
  }
  function productForm(el){
    var f=el.closest("form");
    if(f&&f.querySelector('[name="id"]'))return f;
    var fid=el.getAttribute&&el.getAttribute("form"); if(fid&&document.getElementById(fid))return document.getElementById(fid);
    var wrap=el.closest("product-form-component,product-info,.product-information,.product,section");
    f=wrap&&wrap.querySelector('form[action*="/cart/add"]');
    return f||document.querySelector('form[action*="/cart/add"]');
  }
  function onBuy(e){
    var buy=findBuy(e); if(!buy)return false;
    if(buy.closest&&buy.closest("cart-drawer,cart-drawer-component,.cart-drawer,#cart-drawer,[data-cart],form[action*='/cart']:not([action*='/cart/add'])")){
      e.preventDefault();e.stopImmediatePropagation();go();return true; // wallet buttons in the cart
    }
    var f=productForm(buy);
    var id=f&&(f.querySelector('[name="id"]')||{}).value;
    var q=f&&(f.querySelector('[name="quantity"]')||{}).value;
    if(!id){var qi=document.querySelector('input[name="quantity"]'); id=(new URL(location.href).searchParams.get("variant"))||null; q=q||(qi&&qi.value);}
    e.preventDefault();e.stopImmediatePropagation();
    if(id)buyNow(id,q); else go();
    return true;
  }

  // pointerdown too: some Shopify buttons act on press, before "click"
  document.addEventListener("click",function(e){
    if(onBuy(e))return;
    if(isCheckoutEl(e.target)){e.preventDefault();e.stopImmediatePropagation();go();}
  },true);
  ["pointerdown","mousedown","touchstart"].forEach(function(ev){
    document.addEventListener(ev,function(e){if(findBuy(e)){e.stopImmediatePropagation();}},{capture:true,passive:true});
  });

  document.addEventListener("submit",function(e){
    var f=e.target, s=e.submitter;
    if((s&&s.name==="checkout")||(f&&f.action&&/\\/checkout(\\?|$)/.test(f.action))){
      e.preventDefault();e.stopImmediatePropagation();go();
    }
  },true);

  window.Growpefy=window.MultiCheckout={go:go,buyNow:buyNow};
})();`;
  return new Response(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
