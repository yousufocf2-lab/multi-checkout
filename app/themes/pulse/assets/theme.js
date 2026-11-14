(function () {
  var body = document.body;
  var root = body.getAttribute("data-root") || "";
  var KEY = "gp_cart_" + body.getAttribute("data-shop");
  var FREE = parseInt(body.getAttribute("data-free-ship") || "0", 10) || 0;
  var desk = window.matchMedia ? matchMedia("(min-width:990px)") : { matches: true };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { return []; } }
  function save(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} paintCount(); if (window.__gpDrawerPaint) window.__gpDrawerPaint(); try { document.dispatchEvent(new Event("gp:cart")); } catch (e) {} }
  function money(p) { var r = p / 100; return "₹" + r.toLocaleString("en-IN", { minimumFractionDigits: r % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(msg) { var t = document.getElementById("toast"); if (!t) return; t.textContent = msg; t.classList.add("is-on"); clearTimeout(t._h); t._h = setTimeout(function () { t.classList.remove("is-on"); }, 2200); }
  function paintCount() {
    var n = load().reduce(function (s, l) { return s + l.qty; }, 0);
    document.querySelectorAll("[data-cart-count]").forEach(function (el) { el.textContent = n; el.hidden = n === 0; });
  }
  function px() { if (window.fbq) try { window.fbq.apply(null, arguments); } catch (e) {} }
  function cid(id) { id = String(id); return id.indexOf("gp:") === 0 ? id : "gp:" + id; } // same ids as the Meta catalog and checkout
  function ids(id, alt) { return alt ? [cid(id), alt] : [cid(id)]; } // plus the old Shopify catalog id when there is one
  function add(line) {
    px("track", "AddToCart", { content_ids: ids(line.variantId, line.metaAlt), content_type: "product", value: line.price * line.qty / 100, currency: "INR", contents: [{ id: cid(line.variantId), quantity: line.qty }] });
    var c = load(); var found = c.find(function (l) { return l.variantId === line.variantId; });
    if (found) found.qty = Math.min(20, found.qty + line.qty); else c.push(line);
    save(c);
  }
  paintCount();

  // ---------- checkout (cart page, side cart and "Buy now") ----------
  function startCheckout(lines, done) {
    return fetch(root + "/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ src: (function () { try { return sessionStorage.getItem("gp_src") || ""; } catch (e) { return ""; } })(), lines: lines.map(function (l) { return { variantId: l.variantId, qty: l.qty }; }) }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d.url) { location.href = d.url; return; } done(d.error || "Couldn't open checkout. Please try again."); })
      .catch(function () { done("No internet. Please try again."); });
  }

  // ---------- fly to cart ----------
  function cartTarget() {
    var list = document.querySelectorAll(".header__cart");
    for (var i = 0; i < list.length; i++) { var r = list[i].getBoundingClientRect(); if (r.width && r.bottom > 0 && r.top < innerHeight) return list[i]; }
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
    if (mode === "cart") { if (drawer) openDrawer(); else location.href = root + "/cart"; return; }
    flyToCart(src, image);
    if (mode === "drawer" && drawer) { setTimeout(openDrawer, reduce ? 0 : 650); return; }
    toast(label || "Added to cart");
  }

  // ---------- side cart ----------
  var drawer = document.querySelector("[data-drawer]");
  var onCartPage = !!document.querySelector("[data-cart-items]");
  if (onCartPage && drawer) { drawer.remove(); drawer = null; }
  var lastFocus = null;
  var ICON_RM = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  function paintFree(total) {
    var bar = drawer && drawer.querySelector("[data-free-bar]");
    if (!bar) return;
    if (!FREE || !total) { bar.hidden = true; return; }
    bar.hidden = false;
    var left = FREE - total;
    bar.querySelector("[data-free-text]").innerHTML = left > 0 ? "Add <b>" + money(left) + "</b> more for free delivery" : "<b>You’ve unlocked free delivery</b> 🎉";
    bar.querySelector("[data-free-fill]").style.width = Math.min(100, Math.round(total / FREE * 100)) + "%";
  }
  function paintDrawer() {
    if (!drawer) return;
    var c = load(), n = c.reduce(function (s, l) { return s + l.qty; }, 0);
    var total = c.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    var saved = c.reduce(function (s, l) { return s + (l.compare > l.price ? (l.compare - l.price) * l.qty : 0); }, 0);
    drawer.querySelector("[data-drawer-n]").textContent = n || "";
    drawer.querySelector("[data-lines-empty]").hidden = c.length > 0;
    drawer.querySelector("[data-lines-summary]").hidden = c.length === 0;
    drawer.querySelector("[data-lines]").innerHTML = c.map(function (l, i) {
      return '<div class="dl"><a href="' + esc(l.url) + '"><img class="dl__img" src="' + esc(l.image || "") + '" alt=""></a>' +
        '<div><a class="dl__title" href="' + esc(l.url) + '">' + esc(l.title) + '</a>' +
        '<p class="dl__meta">' + (l.variantTitle ? esc(l.variantTitle) + " · " : "") + money(l.price) + (l.compare > l.price ? ' <s>' + money(l.compare) + "</s>" : "") + "</p>" +
        '<div class="dl__ctl"><div class="dl__qty"><button type="button" data-i="' + i + '" data-d="-1" aria-label="Decrease quantity">−</button><span>' + l.qty + '</span><button type="button" data-i="' + i + '" data-d="1" aria-label="Increase quantity">+</button></div>' +
        '<button type="button" class="dl__rm" data-rm="' + i + '" aria-label="Remove ' + esc(l.title) + '">' + ICON_RM + "</button></div></div>" +
        '<div class="dl__price">' + money(l.price * l.qty) + "</div></div>";
    }).join("");
    drawer.querySelector("[data-lines-subtotal]").textContent = money(total);
    var sv = drawer.querySelector("[data-lines-save]");
    if (sv) { sv.hidden = !saved; sv.textContent = saved ? "You’re saving " + money(saved) + " on this order" : ""; }
    paintFree(total);
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
    return { variantId: v.id, itemId: product.id, title: product.title, variantTitle: v.title === "Default" ? "" : v.title, price: v.price, compare: v.compare_at_price || 0, image: v.image || product.image, url: product.url, qty: qty || 1, metaAlt: v.meta_alt || null };
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
      '<button type="button" class="btn btn--block" data-go>Add to cart</button></div>';
    document.body.appendChild(sheet);
    var go = sheet.querySelector("[data-go]");
    function cur() { return product.variants.find(function (v) { return v.option_values.every(function (x, i) { return x === vals[i]; }); }); }
    function paintSheet() {
      var v = cur();
      sheet.querySelector("[data-p]").textContent = v ? money(v.price) : "";
      go.disabled = !v || !v.available; go.textContent = !v ? "Not available" : v.available ? "Add to cart" : "Sold out";
    }
    function close() { sheet.classList.remove("is-on"); document.removeEventListener("keydown", onKey); setTimeout(function () { sheet.remove(); }, 250); }
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
    var src = card.querySelector(".pc__img") || card.querySelector(".pc__media");
    var avail = product.variants.filter(function (v) { return v.available; });
    if (!avail.length) { toast("Sold out"); return; }
    if (product.variants.length > 1) { pickSheet(product, src); return; }
    add(lineOf(product, avail[0]));
    b.classList.remove("is-done"); void b.offsetWidth; b.classList.add("is-done");
    afterAdd(src, avail[0].image || product.image);
  });

  // ---------- videos: play silently while on screen ----------
  var vids = document.querySelectorAll("video[data-inview-play]");
  if (vids.length) {
    vids.forEach(function (v) { v.muted = true; v.setAttribute("muted", ""); });
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { if (e.target.preload === "none") e.target.preload = "metadata"; var p = e.target.play(); if (p && p.catch) p.catch(function () {}); } else e.target.pause(); });
      }, { threshold: 0.35 });
      vids.forEach(function (v) { io.observe(v); });
    } else vids.forEach(function (v) { v.autoplay = true; v.play && v.play().catch(function () {}); });
  }

  // ---------- sliders: arrows, dots, autoplay, centred mode ----------
  document.querySelectorAll("[data-slider]").forEach(function (sl) {
    var track = sl.querySelector("[data-track]"); if (!track) return;
    var slides = Array.prototype.slice.call(track.querySelectorAll("[data-slide]"));
    var prev = sl.querySelector("[data-prev]"), next = sl.querySelector("[data-next]"), dotsBox = sl.querySelector("[data-dots]");
    var center = sl.hasAttribute("data-center");
    var auto = parseInt(sl.getAttribute("data-autoplay") || "0", 10);
    if (!slides.length) return;
    function index() {
      var mid = track.scrollLeft + (center ? track.clientWidth / 2 : 4), best = 0, d = Infinity;
      slides.forEach(function (s, i) { var x = center ? s.offsetLeft + s.offsetWidth / 2 : s.offsetLeft - track.offsetLeft - parseFloat(getComputedStyle(track).paddingLeft || 0); var dd = Math.abs((center ? x : x) - (center ? mid : track.scrollLeft)); if (dd < d) { d = dd; best = i; } });
      return best;
    }
    function go(i) {
      i = Math.max(0, Math.min(slides.length - 1, i));
      var s = slides[i];
      var left = center ? s.offsetLeft + s.offsetWidth / 2 - track.clientWidth / 2 : s.offsetLeft - slides[0].offsetLeft;
      track.scrollTo({ left: left, behavior: reduce ? "auto" : "smooth" });
    }
    var dots = [];
    if (dotsBox) {
      // one dot per "page" for card rows, one per slide for banners
      var perView = Math.max(1, Math.round(track.clientWidth / (slides[0].offsetWidth || track.clientWidth)));
      var pages = center ? slides.length : Math.max(1, Math.ceil(slides.length / perView));
      if (pages > 1) for (var p = 0; p < pages; p++) { (function (p) { var b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-label", "Go to " + (p + 1)); b.addEventListener("click", function () { go(center ? p : p * perView); }); dotsBox.appendChild(b); dots.push(b); })(p); }
      dotsBox._per = center ? 1 : perView;
    }
    function paint() {
      var i = index();
      if (center) slides.forEach(function (s, j) { s.classList.toggle("is-active", j === i); });
      dots.forEach(function (d, j) { d.classList.toggle("is-on", j === Math.min(dots.length - 1, Math.round(i / (dotsBox._per || 1)))); });
      var num = sl.querySelector("[data-num]"); if (num) num.textContent = (i < 9 ? "0" : "") + (i + 1);
      var max = track.scrollWidth - track.clientWidth - 4;
      if (prev) prev.classList.toggle("is-off", track.scrollLeft <= 4 && !center);
      if (next) next.classList.toggle("is-off", track.scrollLeft >= max && !auto);
    }
    var step = function (dir) {
      if (center || slides[0].offsetWidth >= track.clientWidth * 0.9) { var i = index() + dir; if (i >= slides.length) i = 0; if (i < 0) i = slides.length - 1; go(i); return; }
      var max = track.scrollWidth - track.clientWidth;
      var to = track.scrollLeft + dir * track.clientWidth * 0.9;
      if (dir > 0 && track.scrollLeft >= max - 4) to = 0;
      track.scrollTo({ left: to, behavior: reduce ? "auto" : "smooth" });
    };
    if (prev) prev.addEventListener("click", function () { step(-1); });
    if (next) next.addEventListener("click", function () { step(1); });
    var raf; track.addEventListener("scroll", function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); }, { passive: true });
    if (center) setTimeout(function () { go(Math.floor(slides.length / 2) ? 1 : 0); }, 50);
    paint();
    if (auto > 0 && slides.length > 1 && !reduce) {
      var timer, hover = false;
      var run = function () { clearInterval(timer); timer = setInterval(function () { if (!hover && document.visibilityState === "visible") step(1); }, auto * 1000); };
      sl.addEventListener("mouseenter", function () { hover = true; }); sl.addEventListener("mouseleave", function () { hover = false; });
      track.addEventListener("touchstart", function () { run(); }, { passive: true });
      run();
    }
  });

  // Mouse drag to scroll rows on computers
  document.querySelectorAll("[data-drag-scroll],[data-track]").forEach(function (el) {
    var down = false, x0 = 0, s0 = 0, moved = false;
    el.addEventListener("mousedown", function (e) { if (e.button !== 0) return; down = true; moved = false; x0 = e.pageX; s0 = el.scrollLeft; el.style.scrollSnapType = "none"; });
    window.addEventListener("mousemove", function (e) { if (!down) return; var dx = e.pageX - x0; if (Math.abs(dx) > 5) moved = true; el.scrollLeft = s0 - dx; });
    window.addEventListener("mouseup", function () { if (!down) return; down = false; el.style.scrollSnapType = ""; });
    el.addEventListener("click", function (e) { if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; } }, true);
    el.addEventListener("dragstart", function (e) { e.preventDefault(); });
  });

  // ---------- countdown ----------
  document.querySelectorAll("[data-countdown]").forEach(function (box) {
    var raw = box.getAttribute("data-countdown") || "", end;
    if (raw) { end = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw + (raw.length <= 16 ? ":00" : "") + "+05:30").getTime(); }
    function nextMidnight() { var n = new Date(); var ist = new Date(n.getTime() + (330 + n.getTimezoneOffset()) * 60000); ist.setHours(24, 0, 0, 0); return ist.getTime() - (330 + n.getTimezoneOffset()) * 60000; }
    if (!end || isNaN(end) || end < Date.now()) end = nextMidnight();
    var D = box.querySelector("[data-d]"), H = box.querySelector("[data-h]"), M = box.querySelector("[data-m]"), S = box.querySelector("[data-s]");
    function two(n) { return n < 10 ? "0" + n : String(n); }
    function tick() {
      var s = Math.max(0, Math.floor((end - Date.now()) / 1000));
      if (s === 0) end = nextMidnight();
      var d = Math.floor(s / 86400);
      if (D && D.hasAttribute("data-auto")) { D.hidden = d === 0; D.textContent = d ? d + "d " : ""; }
      else if (D) { D.textContent = two(d); if (d === 0) D.parentNode.setAttribute("data-zero", ""); else D.parentNode.removeAttribute("data-zero"); }
      if (H) H.textContent = two(Math.floor(s % 86400 / 3600));
      if (M) M.textContent = two(Math.floor(s % 3600 / 60));
      if (S) S.textContent = two(s % 60);
    }
    tick(); setInterval(tick, 1000);
  });

  // ---------- read more ----------
  document.querySelectorAll("[data-clamp-btn]").forEach(function (b) {
    var t = b.previousElementSibling; if (!t || !t.hasAttribute("data-clamp")) return;
    if (t.scrollHeight <= t.clientHeight + 2) { b.hidden = true; return; }
    b.addEventListener("click", function () { var on = t.classList.toggle("is-open"); b.classList.toggle("is-open", on); b.setAttribute("aria-label", on ? "Read less" : "Read more"); });
  });

  // ---------- sticky offsets: the header's height for sticky tabs, gallery and filters ----------
  function setSticky() {
    var hd = document.querySelector(".hd--sticky");
    document.documentElement.style.setProperty("--hd-sticky", (hd ? hd.offsetHeight : 0) + "px");
  }
  setSticky(); addEventListener("resize", setSticky);

  // ---------- footer columns fold on phones ----------
  if (!desk.matches) document.querySelectorAll(".ft__col").forEach(function (d, i) { if (i > 0) d.removeAttribute("open"); });

  // ---------- newsletter ----------
  document.querySelectorAll("[data-subscribe]").forEach(function (f) {
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var msg = f.querySelector("[data-subscribe-msg]"), btn = f.querySelector("button"), email = f.querySelector("input[name=email]").value.trim();
      if (!email) return;
      btn.disabled = true;
      fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ s: body.getAttribute("data-shop"), email: email, p: location.pathname }) })
        .then(function (r) { return r.json(); })
        .then(function (d) { msg.hidden = false; msg.textContent = d.error || "You’re in! Watch your inbox for launches and offers."; if (!d.error) { f.reset(); px("track", "Lead"); } })
        .catch(function () { msg.hidden = false; msg.textContent = "No internet. Please try again."; })
        .then(function () { btn.disabled = false; });
    });
  });

  // ---------- shoppable videos ----------
  document.querySelectorAll("[data-shv]").forEach(function (sec) {
    var modal = sec.querySelector("[data-shv-modal]"), bodyBox = sec.querySelector("[data-shv-body]");
    if (!modal) return;
    document.body.appendChild(modal);
    function close() { modal.hidden = true; bodyBox.innerHTML = ""; document.documentElement.classList.remove("no-scroll"); }
    sec.addEventListener("click", function (e) {
      var b = e.target.closest("[data-shv-open]"); if (!b) return;
      var tpl = b.closest(".shv__it").querySelector("[data-shv-data]"); if (!tpl) return;
      bodyBox.innerHTML = tpl.innerHTML; modal.hidden = false; document.documentElement.classList.add("no-scroll");
      var v = bodyBox.querySelector("video"); if (v) { v.muted = false; var p = v.play(); if (p && p.catch) p.catch(function () { v.muted = true; v.play(); }); }
    });
    modal.addEventListener("click", function (e) { if (e.target.closest("[data-shv-close]")) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) close(); });
  });

  // ---------- floating video ----------
  var bub = document.querySelector("[data-vbub]");
  if (bub) {
    try { if (sessionStorage.getItem("gp_vbub_off")) bub.classList.add("is-gone"); } catch (e) {}
    bub.querySelector("[data-vbub-x]").addEventListener("click", function () { bub.classList.add("is-gone"); try { sessionStorage.setItem("gp_vbub_off", "1"); } catch (e) {} });
    bub.querySelector("[data-vbub-open]").addEventListener("click", function () {
      var src = bub.querySelector("video");
      var m = document.createElement("div"); m.className = "shv__modal";
      m.innerHTML = '<div class="shv__shade"></div><div class="shv__box" style="width:min(420px,100%)"><button type="button" class="shv__x" aria-label="Close">×</button><video src="' + esc(src.currentSrc || src.src) + '" playsinline controls autoplay loop style="width:100%;max-height:86vh;background:#000"></video></div>';
      document.body.appendChild(m);
      m.addEventListener("click", function (e) { if (e.target.classList.contains("shv__shade") || e.target.closest(".shv__x")) m.remove(); });
    });
  }

  // ---------- product page ----------
  var pj = document.getElementById("product-json");
  var form = document.querySelector("[data-product-form]");
  if (pj && form) {
    var product = JSON.parse(pj.textContent);
    var slides = document.querySelector("[data-pdp-slides]");
    var thumbs = document.querySelectorAll("[data-thumbs] .pdp__th");
    var dots = document.querySelectorAll("[data-pdp-dots] i");
    var main = document.getElementById("pdp-main");
    var mainSrc = main && main.src;
    var current = null;
    function chosen() {
      var vals = product.options.map(function (o, i) { var r = form.querySelector('input[name="option' + i + '"]:checked'); return r ? r.value : null; });
      return product.variants.find(function (v) { return v.option_values.every(function (x, i) { return x === vals[i]; }); }) || product.variants[0];
    }
    function goSlide(i) { if (!slides) return; var s = slides.children[i]; if (s) slides.scrollTo({ left: s.offsetLeft - slides.offsetLeft, behavior: reduce ? "auto" : "smooth" }); }
    function mark(i) { thumbs.forEach(function (t, j) { t.classList.toggle("is-on", j === i); }); dots.forEach(function (d, j) { d.classList.toggle("is-on", j === i); }); var t = thumbs[i]; if (t && t.parentNode.scrollHeight > t.parentNode.clientHeight) t.scrollIntoView({ block: "nearest" }); }
    thumbs.forEach(function (t, i) { t.addEventListener("click", function () { goSlide(i); mark(i); }); t.addEventListener("mouseenter", function () { if (desk.matches) { goSlide(i); mark(i); } }); });
    if (slides) slides.addEventListener("scroll", function () {
      var i = Math.round(slides.scrollLeft / slides.clientWidth); mark(i);
      slides.querySelectorAll("video").forEach(function (v) { var r = v.getBoundingClientRect(), s = slides.getBoundingClientRect(); if (Math.abs(r.left - s.left) < 10) { v.play && v.play().catch(function () {}); } else v.pause && v.pause(); });
    }, { passive: true });
    function paint() {
      current = chosen();
      product.options.forEach(function (o, i) { var l = form.querySelector('[data-opt-label="' + i + '"]'); if (l && current) l.textContent = current.option_values[i]; });
      var box = document.querySelector("[data-price]");
      if (box) box.innerHTML = '<p class="pdp__price"><b>' + money(current.price) + "</b>" + (current.compare_at_price > current.price ? "<s>" + money(current.compare_at_price) + "</s><em>" + Math.round((1 - current.price / current.compare_at_price) * 100) + "% off</em>" : "") + "</p>";
      var sp = document.querySelector("[data-sticky-price]"); if (sp) sp.textContent = money(current.price);
      var out = !current.available;
      form.querySelectorAll("[data-buy],[data-add]").forEach(function (b) { b.disabled = out; });
      var so = form.querySelector("[data-soldout]"); if (so) so.hidden = !out;
      if (main) { main.src = current.image || mainSrc; if (current.image) { goSlide(0); mark(0); } }
    }
    (function preselect() {
      // ?variant= from ads, the Meta catalog and old Shopify links: Growpefy id, gp:<id> or Shopify's variant number
      var want = new URLSearchParams(location.search).get("variant");
      if (!want) return;
      want = String(want).replace(/^gp:/, "");
      var v = product.variants.find(function (x) { return String(x.id) === want || (x.source && String(x.source) === want); });
      if (!v) return;
      v.option_values.forEach(function (val, i) { form.querySelectorAll('input[name="option' + i + '"]').forEach(function (r) { r.checked = r.value === val; }); });
    })();
    form.addEventListener("change", function (e) { if (/^option\d+$/.test(e.target.name || "")) paint(); });
    setTimeout(function () { var v = chosen(); px("track", "ViewContent", { content_ids: ids(v.id, v.meta_alt), content_type: "product", content_name: product.title, value: v.price / 100, currency: "INR" }); }, 0);
    function lineFor() { return lineOf(product, current, 1); }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!current || !current.available) return;
      var now = e.submitter && e.submitter.value === "now";
      var line = lineFor();
      if (now) {
        // Buy now: only this product goes to checkout; the saved cart is left as it is
        var b = e.submitter, label = b.textContent;
        b.disabled = true; b.textContent = "Opening checkout…";
        startCheckout([line], function (err) { b.disabled = false; b.textContent = label; toast(err); });
        return;
      }
      add(line);
      afterAdd(main || form, line.image);
    });
    var sticky = document.querySelector("[data-sticky]");
    var buyBtn = form.querySelector("[data-buy]");
    if (sticky && buyBtn && "IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { sticky.classList.toggle("is-on", !es[0].isIntersecting && es[0].boundingClientRect.top < 0); }).observe(buyBtn);
      sticky.querySelector("[data-sticky-buy]").addEventListener("click", function () { buyBtn.click(); });
    }
    // Pincode: city from the pincode, an expected delivery date and COD
    var pin = document.querySelector("[data-pin]");
    if (pin) {
      var input = pin.querySelector("[data-pin-input]"), outp = pin.querySelector("[data-pin-out]"), days = parseInt(pin.getAttribute("data-days") || "5", 10);
      try { var saved = localStorage.getItem("gp_pin"); if (saved) input.value = saved; } catch (e) {}
      var check = function () {
        var v = (input.value || "").replace(/\D/g, "");
        outp.hidden = false; outp.classList.remove("is-bad");
        if (!/^[1-9]\d{5}$/.test(v)) { outp.classList.add("is-bad"); outp.textContent = "Please enter a valid 6-digit pincode."; return; }
        outp.textContent = "Checking…";
        try { localStorage.setItem("gp_pin", v); } catch (e) {}
        var d = new Date(Date.now() + days * 86400000);
        var when = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
        fetch("/api/pincode/" + v).then(function (r) { return r.json(); }).catch(function () { return {}; }).then(function (r) {
          var place = r && r.city ? " to <b>" + esc(r.city) + "</b>" : "";
          outp.innerHTML = "Delivery" + place + " by <b>" + when + "</b> · Cash on delivery available";
        });
      };
      pin.querySelector("[data-pin-go]").addEventListener("click", check);
      input.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); check(); } });
    }
    paint();
  }

  // Coupon copy
  document.addEventListener("click", function (e) {
    var c = e.target.closest && e.target.closest("[data-copy]"); if (!c) return;
    var code = c.getAttribute("data-copy");
    if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { toast("Code " + code + " copied. Use it at checkout."); }, function () { toast(code); }); else toast(code);
  });

  // Product page tabs follow the scroll
  var tabs = document.querySelector("[data-pdx-tabs]");
  if (tabs && "IntersectionObserver" in window) {
    var links = Array.prototype.slice.call(tabs.querySelectorAll("a"));
    var targets = links.map(function (a) { return document.querySelector(a.getAttribute("href")); });
    var vis = {};
    var tio = new IntersectionObserver(function (es) {
      es.forEach(function (e) { vis[e.target.id] = e.isIntersecting; });
      var on = -1; targets.forEach(function (t, i) { if (t && vis[t.id] && on < 0) on = i; });
      if (on >= 0) links.forEach(function (a, i) { a.classList.toggle("is-on", i === on); });
    }, { rootMargin: "-140px 0px -45% 0px" });
    targets.forEach(function (t) { if (t) tio.observe(t); });
    links.forEach(function (a, i) {
      if (!targets[i]) a.hidden = true;
      a.addEventListener("click", function (e) { var t = targets[i]; if (!t) return; e.preventDefault(); var off = tabs.offsetHeight + (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--hd-sticky"), 10) || 0) + 6; scrollTo({ top: t.getBoundingClientRect().top + scrollY - off, behavior: reduce ? "auto" : "smooth" }); });
    });
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
