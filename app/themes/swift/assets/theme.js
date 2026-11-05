(function () {
  var body = document.body;
  var root = body.getAttribute("data-root") || "";
  var KEY = "gp_cart_" + body.getAttribute("data-shop");

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function save(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} paintCount(); }
  function money(p) { var r = p / 100; return "₹" + r.toLocaleString("en-IN", { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(msg) { var t = document.getElementById("toast"); if (!t) return; t.textContent = msg; t.classList.add("is-on"); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("is-on"); }, 2200); }
  function paintCount() {
    var n = load().reduce(function (s, l) { return s + l.qty; }, 0);
    document.querySelectorAll("[data-cart-count]").forEach(function (el) { el.textContent = n; el.hidden = n === 0; });
  }
  function add(line) {
    var c = load(); var found = c.find(function (l) { return l.variantId === line.variantId; });
    if (found) found.qty = Math.min(20, found.qty + line.qty); else c.push(line);
    save(c);
  }
  paintCount();

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
      var vals = product.options.map(function (o, i) { var r = form.querySelector('input[name="option' + i + '"]:checked'); return r ? r.value : null; });
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
      add(lineFor());
      if (now) location.href = root + "/cart?go=1"; else toast("Added to cart");
    });
    var sticky = document.querySelector("[data-sticky]");
    var buyBtn = form.querySelector("[data-buy]");
    if (sticky && buyBtn && "IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { sticky.classList.toggle("is-on", !es[0].isIntersecting); }).observe(buyBtn);
      sticky.querySelector("[data-sticky-buy]").addEventListener("click", function () { buyBtn.click(); });
    }
    var slides = document.querySelector("[data-slides]");
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
      fetch(root + "/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: c.map(function (l) { return { variantId: l.variantId, qty: l.qty }; }) }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.url) { location.href = d.url; return; }
          btn.disabled = false; btn.textContent = "Checkout"; note.hidden = false; note.textContent = d.error || "Couldn't open checkout. Please try again.";
        })
        .catch(function () { btn.disabled = false; btn.textContent = "Checkout"; note.hidden = false; note.textContent = "No internet. Please try again."; });
    }
    btn.addEventListener("click", checkout);
    render();
    if (/[?&]go=1/.test(location.search) && load().length) checkout();
  }
})();
