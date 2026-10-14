import type { LoaderFunctionArgs } from "@remix-run/node";
import { env } from "~/lib/env.server";

/**
 * Storefront script. Add to theme.liquid before </body>:
 *   <script src="https://YOUR_APP/embed.js?store=STORE_SLUG" defer></script>
 * It redirects Shopify's checkout + Buy-now buttons to this checkout.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const slug = (new URL(request.url).searchParams.get("store") ?? "").replace(/[^a-z0-9-]/gi, "");
  const js = `(function(){
  var APP=${JSON.stringify(env.appUrl)}, STORE=${JSON.stringify(slug)};
  if(!STORE||window.__CX_LOADED)return; window.__CX_LOADED=true;
  var root=(window.Shopify&&Shopify.routes&&Shopify.routes.root)||"/";

  // Clear the cart after a successful order (?cx_clear=1)
  try{var u=new URL(location.href); if(u.searchParams.get("cx_clear")==="1"){
    fetch(root+"cart/clear.js",{method:"POST"}).finally(function(){u.searchParams.delete("cx_clear");history.replaceState(null,"",u.toString());});
  }}catch(e){}

  function ck(n){var m=document.cookie.match(new RegExp("(?:^|; )"+n+"=([^;]*)"));return m?decodeURIComponent(m[1]):null;}
  function fbcFromUrl(){try{var id=new URL(location.href).searchParams.get("fbclid");return id?"fb.1."+Date.now()+"."+id:null}catch(e){return null}}
  var busy=false;
  function overlay(on){var id="cx-overlay",el=document.getElementById(id);
    if(!on){if(el)el.remove();return;}
    if(el)return; el=document.createElement("div"); el.id=id;
    el.style.cssText="position:fixed;inset:0;z-index:2147483647;background:rgba(255,255,255,.85);display:flex;align-items:center;justify-content:center;font:600 15px system-ui,sans-serif;color:#111";
    el.innerHTML='<div style="text-align:center"><div style="width:36px;height:36px;margin:0 auto 12px;border:3px solid #ddd;border-top-color:#111;border-radius:50%;animation:cxspin .8s linear infinite"></div>Secure checkout khul raha hai…</div><style>@keyframes cxspin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(el);}

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
      if(String(e&&e.message)!=="empty")alert("Checkout abhi khul nahi paya, dobara try karein.");});
  }

  function buyNow(variantId,qty){go([{variantId:String(variantId),quantity:Math.max(1,parseInt(qty||1,10))}]);}

  function isCheckoutEl(el){
    if(!el||!el.closest)return null;
    return el.closest('[name="checkout"],a[href$="/checkout"],a[href*="/checkout?"],button[onclick*="checkout"],.cart__checkout-button,.cart__checkout,#checkout,[data-cx-checkout]');
  }

  document.addEventListener("click",function(e){
    var t=e.target;
    var buy=t&&t.closest&&t.closest(".shopify-payment-button__button,.shopify-payment-button button,[data-cx-buy-now]");
    if(buy){
      var f=buy.closest("form")||document.querySelector('form[action*="/cart/add"]');
      var id=f&&(f.querySelector('[name="id"]')||{}).value;
      var q=f&&(f.querySelector('[name="quantity"]')||{}).value;
      if(id){e.preventDefault();e.stopImmediatePropagation();buyNow(id,q);return;}
    }
    if(isCheckoutEl(t)){e.preventDefault();e.stopImmediatePropagation();go();}
  },true);

  document.addEventListener("submit",function(e){
    var f=e.target, s=e.submitter;
    if((s&&s.name==="checkout")||(f&&f.action&&/\\/checkout(\\?|$)/.test(f.action))){
      e.preventDefault();e.stopImmediatePropagation();go();
    }
  },true);

  window.MultiCheckout={go:go,buyNow:buyNow};
})();`;
  return new Response(js, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
