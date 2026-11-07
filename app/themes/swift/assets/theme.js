(function () {
  var body = document.body;
  var root = body.getAttribute("data-root") || "";
  var KEY = "gp_cart_" + body.getAttribute("data-shop");

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function save(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} paintCount(); if (window.__gpDrawerPaint) window.__gpDrawerPaint(); }
  function money(p) { var r = p / 100; return "₹" + r.toLocaleString("en-IN", { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(msg) { var t = document.getElementById("toast"); if (!t) return; t.textContent = msg; t.classList.add("is-on"); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("is-on"); }, 2200); }
  function paintCount() {
    var n = load().reduce(function (s, l) { return s + l.qty; }, 0);
    document.querySelectorAll("[data-cart-count]").forEach(function (el) { el.textContent = n; el.hidden = n === 0; });
  }
  function px() { if (window.fbq) try { window.fbq.apply(null, arguments); } catch (e) {} }
  function cid(id) { id = String(id); return id.indexOf("gp:") === 0 ? id : "gp:" + id; } // same ids as the Meta catalog and checkout
  function add(line) {
    px("track", "AddToCart", { content_ids: [cid(line.variantId)], content_type: "product", value: line.price * line.qty / 100, currency: "INR", contents: [{ id: cid(line.variantId), quantity: line.qty }] });
    var c = load(); var found = c.find(function (l) { return l.variantId === line.variantId; });
    if (found) found.qty = Math.min(20, found.qty + line.qty); else c.push(line);
    save(c);
  }
  paintCount();

  // ---------- checkout (shared by cart page and "Buy now") ----------
  function startCheckout(lines, done) {
    return fetch(root + "/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: lines.map(function (l) { return { variantId: l.variantId, qty: l.qty }; }) }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.url) { location.href = d.url; return; } done(d.error || "Couldn't open checkout. Please try again."); })
      .catch(function () { done("No internet. Please try again."); });
  }

  // ---------- fly to cart ----------
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function cartTarget() {
    var list = document.querySelectorAll(".header__cart");
    for (var i = 0; i < list.length; i++) { var r = list[i].getBoundingClientRect(); if (r.width && r.bottom > 0) return list[i]; }
    return null;
  }
  function bump(cart) {
    if (!cart) return;
    cart.classList.remove("is-bump"); void cart.offsetWidth; cart.classList.add("is-bump");
    var n = cart.querySelector("[data-cart-count]");
    if (n) { n.classList.remove("is-pop"); void n.offsetWidth; n.classList.add("is-pop"); }
  }
  function flyToCart(src, image) {
    var cart = cartTarget();
    if (!cart || reduce) { bump(cart); return; }
    var from = src && src.getBoundingClientRect();
    if (!from || !from.width) { bump(cart); return; }
    var size = Math.min(from.width, from.height, 220);
    var x = from.left + from.width / 2 - size / 2, y = from.top + from.height / 2 - size / 2;
    var to = cart.getBoundingClientRect();
    var el;
    if (image) { el = document.createElement("img"); el.src = image; el.alt = ""; }
    else { el = document.createElement("div"); el.style.background = "var(--brand)"; }
    el.className = "fly-cart";
    el.style.cssText += ";left:" + x + "px;top:" + y + "px;width:" + size + "px;height:" + size + "px";
    document.body.appendChild(el);
    var dx = to.left + to.width / 2 - (x + size / 2), dy = to.top + to.height / 2 - (y + size / 2);
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      el.style.transform = "translate(" + dx + "px," + dy + "px) scale(" + (18 / size) + ")";
      el.style.opacity = "0.35"; el.style.borderRadius = "50%";
    }); });
    var finished = false;
    function end() { if (finished) return; finished = true; el.remove(); bump(cart); }
    el.addEventListener("transitionend", end); setTimeout(end, 800);
  }
  function afterAdd(src, image, label) {
    var mode = body.getAttribute("data-after-add");
    if (mode === "cart") { if (drawer) { openDrawer(); } else location.href = root + "/cart"; return; }
    flyToCart(src, image);
    if (mode === "drawer" && drawer) { setTimeout(openDrawer, reduce ? 0 : 650); return; }
    toast(label || "Added to cart");
  }

  // ---------- side cart ----------
  var drawer = document.querySelector("[data-drawer]");
  var onCartPage = !!document.querySelector("[data-cart-items]");
  if (onCartPage && drawer) { drawer.remove(); drawer = null; }
  var lastFocus = null;
  var ICON_RM = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  function paintDrawer() {
    if (!drawer) return;
    var c = load(), n = c.reduce(function (s, l) { return s + l.qty; }, 0);
    drawer.querySelector("[data-drawer-n]").textContent = n || "";
    drawer.querySelector("[data-lines-empty]").hidden = c.length > 0;
    drawer.querySelector("[data-lines-summary]").hidden = c.length === 0;
    drawer.querySelector("[data-lines]").innerHTML = c.map(function (l, i) {
      return '<div class="dl"><a href="' + esc(l.url) + '"><img class="dl__img" src="' + esc(l.image || "") + '" alt=""></a>' +
        '<div><a class="dl__title" href="' + esc(l.url) + '">' + esc(l.title) + '</a>' +
        '<p class="dl__meta">' + (l.variantTitle ? esc(l.variantTitle) + " · " : "") + money(l.price) + "</p>" +
        '<div class="dl__ctl"><div class="dl__qty"><button type="button" data-i="' + i + '" data-d="-1" aria-label="Decrease quantity">−</button><span>' + l.qty + '</span><button type="button" data-i="' + i + '" data-d="1" aria-label="Increase quantity">+</button></div>' +
        '<button type="button" class="dl__rm" data-rm="' + i + '" aria-label="Remove ' + esc(l.title) + '">' + ICON_RM + "</button></div></div>" +
        '<div class="dl__price">' + money(l.price * l.qty) + "</div></div>";
    }).join("");
    drawer.querySelector("[data-lines-subtotal]").textContent = money(c.reduce(function (s, l) { return s + l.price * l.qty; }, 0));
  }
  function openDrawer() {
    if (!drawer) return;
    lastFocus = document.activeElement;
    paintDrawer();
    var err = drawer.querySelector("[data-lines-error]"); if (err) err.hidden = true;
    drawer.hidden = false;
    document.documentElement.classList.add("drawer-open");
    requestAnimationFrame(function () { requestAnimationFrame(function () { drawer.classList.add("is-on"); drawer.querySelector(".drawer__x").focus(); }); });
  }
  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    drawer.classList.remove("is-on");
    document.documentElement.classList.remove("drawer-open");
    setTimeout(function () { if (!drawer.classList.contains("is-on")) drawer.hidden = true; }, 300);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  if (drawer) {
    window.__gpDrawerPaint = function () { if (!drawer.hidden) paintDrawer(); };
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest(".header__cart, a[href$='/cart']");
      if (a && !a.closest("[data-drawer]")) { e.preventDefault(); openDrawer(); }
    });
    drawer.addEventListener("click", function (e) {
      if (e.target.closest("[data-drawer-close]")) { closeDrawer(); return; }
      var b = e.target.closest("button[data-i],button[data-rm]"); if (!b) return;
      var c = load();
      if (b.hasAttribute("data-rm")) c.splice(+b.getAttribute("data-rm"), 1);
      else { var l = c[+b.getAttribute("data-i")]; if (!l) return; l.qty = Math.max(0, Math.min(20, l.qty + +b.getAttribute("data-d"))); if (!l.qty) c.splice(+b.getAttribute("data-i"), 1); }
      save(c);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
    var dBtn = drawer.querySelector("[data-lines-checkout]");
    dBtn.addEventListener("click", function () {
      var c = load(); if (!c.length) return;
      dBtn.disabled = true; dBtn.textContent = "Opening secure checkout…";
      startCheckout(c, function (err) { dBtn.disabled = false; dBtn.textContent = "Checkout"; var n = drawer.querySelector("[data-lines-error]"); n.hidden = false; n.textContent = err; });
    });
    window.addEventListener("pageshow", function (e) { if (e.persisted) { dBtn.disabled = false; dBtn.textContent = "Checkout"; } });
    window.addEventListener("storage", function (e) { if (e.key === KEY) { paintCount(); window.__gpDrawerPaint(); } });
  }

  // ---------- quick add on product cards ----------
  function lineOf(product, v, qty) {
    return { variantId: v.id, itemId: product.id, title: product.title, variantTitle: v.title === "Default" ? "" : v.title, price: v.price, image: v.image || product.image, url: product.url, qty: qty || 1 };
  }
  function pickSheet(product, src) {
    var vals = product.options.map(function (o, i) { var v = product.variants.find(function (x) { return x.available; }) || product.variants[0]; return v.option_values[i]; });
    var sheet = document.createElement("div");
    sheet.className = "qa-sheet";
    sheet.innerHTML = '<div class="qa-sheet__box" role="dialog" aria-modal="true" aria-label="Choose options">' +
      '<div class="qa-sheet__head">' + (product.image ? '<img src="' + esc(product.image) + '" alt="">' : "") + '<div><p class="qa-sheet__title">' + esc(product.title) + '</p><p class="qa-sheet__price" data-p></p></div><button type="button" class="qa-sheet__close" data-x aria-label="Close">×</button></div>' +
      product.options.map(function (o, i) {
        return '<fieldset class="opt"><legend>' + esc(o.name) + '</legend><div class="opt__values">' + o.values.map(function (val) {
          return '<label class="pill"><input type="radio" name="qo' + i + '" value="' + esc(val) + '"' + (val === vals[i] ? " checked" : "") + '><span>' + esc(val) + "</span></label>";
        }).join("") + "</div></fieldset>";
      }).join("") +
      '<button type="button" class="btn btn--primary btn--block" data-go>Add to cart</button></div>';
    document.body.appendChild(sheet);
    var go = sheet.querySelector("[data-go]");
    function cur() { return product.variants.find(function (v) { return v.option_values.every(function (x, i) { return x === vals[i]; }); }); }
    function paintSheet() {
      var v = cur();
      sheet.querySelector("[data-p]").textContent = v ? money(v.price) : "";
      go.disabled = !v || !v.available; go.textContent = !v ? "Not available" : v.available ? "Add to cart" : "Sold out";
    }
    function close() { sheet.classList.remove("is-on"); document.removeEventListener("keydown", onKey); setTimeout(function () { sheet.remove(); }, 200); }
    function onKey(e) { if (e.key === "Escape") close(); }
    sheet.addEventListener("change", function (e) { var m = /^qo(\d+)$/.exec(e.target.name || ""); if (m) { vals[+m[1]] = e.target.value; paintSheet(); } });
    sheet.addEventListener("click", function (e) { if (e.target === sheet || e.target.closest("[data-x]")) close(); });
    document.addEventListener("keydown", onKey);
    go.addEventListener("click", function () {
      var v = cur(); if (!v || !v.available) return;
      add(lineOf(product, v)); close(); afterAdd(src, v.image || product.image);
    });
    paintSheet();
    requestAnimationFrame(function () { sheet.classList.add("is-on"); go.focus(); });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-quick-add]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    var card = b.closest("[data-card]"); if (!card) return;
    var product; try { product = JSON.parse(card.getAttribute("data-product")); } catch (err) { return; }
    var src = card.querySelector(".card__media img, .card__media video") || card.querySelector(".card__media");
    var avail = product.variants.filter(function (v) { return v.available; });
    if (!avail.length) { toast("Sold out"); return; }
    if (product.variants.length > 1) { pickSheet(product, src); return; }
    add(lineOf(product, avail[0]));
    b.classList.remove("is-done"); void b.offsetWidth; b.classList.add("is-done");
    afterAdd(src, avail[0].image || product.image);
  });

  // Product videos in grids: play silently on loop while on screen, pause when scrolled away (saves data)
  var vids = document.querySelectorAll("video[data-inview-play]");
  if (vids.length) {
    vids.forEach(function (v) { v.muted = true; v.setAttribute("muted", ""); });
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { var p = e.target.play(); if (p && p.catch) p.catch(function () {}); } else e.target.pause(); });
      }, { threshold: 0.35 });
      vids.forEach(function (v) { io.observe(v); });
    } else vids.forEach(function (v) { v.autoplay = true; v.play && v.play().catch(function () {}); });
  }

  // ---------- product page ----------
  var pj = document.getElementById("product-json");
  var form = document.querySelector("[data-product-form]");
  if (pj && form) {
    var product = JSON.parse(pj.textContent);
    var main = document.getElementById("pdp-main");
    var current = null;
    function chosen() {
      var vals = product.options.map(function (o, i) { var r = form.querySelector('input[name="option' + i + '"]:checked') || form.querySelector('select[name="option' + i + '"]'); return r ? r.value : null; });
      return product.variants.find(function (v) { return v.option_values.every(function (x, i) { return x === vals[i]; }); }) || product.variants[0];
    }
    function paint() {
      current = chosen();
      var priceBox = document.querySelector("[data-price]");
      if (priceBox) priceBox.innerHTML = '<p class="price"><span class="price__now">' + money(current.price) + "</span>" + (current.compare_at_price > current.price ? ' <s class="price__was">' + money(current.compare_at_price) + "</s>" : "") + "</p>";
      var save = document.querySelector("[data-save]");
      if (save) { if (current.compare_at_price > current.price) { save.hidden = false; save.textContent = "You save " + money(current.compare_at_price - current.price) + " (" + Math.round((1 - current.price / current.compare_at_price) * 100) + "%)"; } else save.hidden = true; }
      var sp = document.querySelector("[data-sticky-price]"); if (sp) sp.textContent = money(current.price);
      var out = !current.available;
      form.querySelectorAll("[data-buy],[data-add]").forEach(function (b) { b.disabled = out; });
      var so = form.querySelector("[data-soldout]"); if (so) so.hidden = !out;
      if (current.image && main) { main.src = current.image; if (slides) slides.scrollTo({ left: 0 }); }
    }
    form.addEventListener("change", paint);
    setTimeout(function () { var v = chosen(); px("track", "ViewContent", { content_ids: [cid(v.id)], content_type: "product", content_name: product.title, value: v.price / 100, currency: "INR" }); }, 0);
    form.querySelectorAll("[data-qty]").forEach(function (b) {
      b.addEventListener("click", function () { var i = form.querySelector('input[name="qty"]'); i.value = Math.max(1, Math.min(20, (parseInt(i.value, 10) || 1) + parseInt(b.getAttribute("data-qty"), 10))); });
    });
    function lineFor() {
      var q = Math.max(1, Math.min(20, parseInt(form.querySelector('input[name="qty"]').value, 10) || 1));
      return { variantId: current.id, itemId: product.id, title: product.title, variantTitle: current.title === "Default" ? "" : current.title, price: current.price, image: current.image || product.image, url: product.url, qty: q };
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!current || !current.available) return;
      var now = e.submitter && e.submitter.value === "now";
      var line = lineFor();
      if (now) {
        // Buy now: only this product goes to checkout; the saved cart is left as it is
        var b = e.submitter, label = b.textContent;
        b.disabled = true; b.textContent = "Opening secure checkout…";
        startCheckout([line], function (err) { b.disabled = false; b.textContent = label; toast(err); });
        return;
      }
      add(line);
      afterAdd(main || form, line.image);
    });
    var sticky = document.querySelector("[data-sticky]");
    var buyBtn = form.querySelector("[data-buy]");
    if (sticky && buyBtn && "IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { sticky.classList.toggle("is-on", !es[0].isIntersecting); }).observe(buyBtn);
      sticky.querySelector("[data-sticky-buy]").addEventListener("click", function () { buyBtn.click(); });
    }
    var slides = document.querySelector("[data-slides]");
    var copy = document.querySelector("[data-copy-link]");
    if (copy) copy.addEventListener("click", function (e) { e.preventDefault(); var u = location.origin + product.url; if (navigator.clipboard) navigator.clipboard.writeText(u).then(function () { toast("Link copied"); }); });
    var thumbs = document.querySelectorAll(".pdp__thumb");
    function mark(i) { thumbs.forEach(function (x, j) { if (j === i) x.setAttribute("aria-current", "true"); else x.removeAttribute("aria-current"); }); }
    thumbs.forEach(function (t, i) {
      if (i === 0) t.setAttribute("aria-current", "true");
      t.addEventListener("click", function () {
        var el = document.getElementById(t.getAttribute("data-to"));
        if (el && slides) slides.scrollTo({ left: el.offsetLeft - slides.offsetLeft, behavior: "smooth" });
        mark(i);
      });
    });
    if (slides) slides.addEventListener("scroll", function () {
      var i = Math.round(slides.scrollLeft / slides.clientWidth); mark(i);
      slides.querySelectorAll("video").forEach(function (v) { var r = v.getBoundingClientRect(), s = slides.getBoundingClientRect(); if (Math.abs(r.left - s.left) < 10) { v.play && v.play().catch(function () {}); } else v.pause && v.pause(); });
    }, { passive: true });
    paint();
  }

  // ---------- cart page ----------
  var itemsBox = document.querySelector("[data-cart-items]");
  if (itemsBox) {
    function render() {
      var c = load();
      document.querySelector("[data-cart-empty]").hidden = c.length > 0;
      document.querySelector("[data-cart-summary]").hidden = c.length === 0;
      itemsBox.innerHTML = c.map(function (l, i) {
        return '<div class="line"><a href="' + esc(l.url) + '"><img src="' + esc(l.image || "") + '" alt=""></a>' +
          '<div><p class="line__title">' + esc(l.title) + "</p>" + (l.variantTitle ? '<p class="line__variant">' + esc(l.variantTitle) + "</p>" : "") +
          '<div class="qty" style="margin-top:8px"><button type="button" data-i="' + i + '" data-d="-1" aria-label="Less">−</button><input value="' + l.qty + '" readonly aria-label="Quantity"><button type="button" data-i="' + i + '" data-d="1" aria-label="More">+</button></div></div>' +
          '<div class="line__right"><b>' + money(l.price * l.qty) + '</b><button type="button" class="line__remove" data-rm="' + i + '">Remove</button></div></div>';
      }).join("");
      document.querySelector("[data-cart-subtotal]").textContent = money(c.reduce(function (s, l) { return s + l.price * l.qty; }, 0));
    }
    itemsBox.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var c = load();
      if (b.hasAttribute("data-rm")) c.splice(+b.getAttribute("data-rm"), 1);
      else { var l = c[+b.getAttribute("data-i")]; l.qty = Math.max(0, Math.min(20, l.qty + +b.getAttribute("data-d"))); if (!l.qty) c.splice(+b.getAttribute("data-i"), 1); }
      save(c); render();
    });
    var btn = document.querySelector("[data-checkout]");
    var note = document.querySelector("[data-checkout-note]");
    function checkout() {
      var c = load(); if (!c.length) return;
      btn.disabled = true; btn.textContent = "Opening secure checkout…";
      startCheckout(c, function (err) { btn.disabled = false; btn.textContent = "Checkout"; note.hidden = false; note.textContent = err; });
    }
    btn.addEventListener("click", checkout);
    render();
    if (/[?&]go=1/.test(location.search) && load().length) checkout();
  }
})();
