/* Feast: restaurant menu, add-ons, cart and checkout. No libraries. */
(function () {
  var body = document.body;
  var SHOP = body.getAttribute("data-shop");
  var ROOT = body.getAttribute("data-root") || "";
  var OPEN = body.getAttribute("data-open") === "1";
  var KEY = "gp_cart_" + SHOP, RKEY = "gp_rest_" + SHOP;
  var REST = {};
  try { REST = JSON.parse(document.getElementById("fs-rest").textContent || "{}"); } catch (e) {}
  var modes = REST.modes || { delivery: true };

  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function money(p) { return "₹" + (Math.round(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(t) { var el = $("#toast"); if (!el) return; el.textContent = t; el.classList.add("is-on"); clearTimeout(toast.t); toast.t = setTimeout(function () { el.classList.remove("is-on"); }, 2200); }
  function px(ev, data) { try { if (window.fbq) window.fbq("track", ev, data); } catch (e) {} }

  /* ---------- cart ---------- */
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]").filter(function (l) { return l && l.variantId && l.qty > 0; }); } catch (e) { return []; } }
  function save(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} paint(); try { document.dispatchEvent(new Event("gp:cart")); } catch (e) {} }
  function lineKey(variantId, addons) { return variantId + "|" + (addons || ""); }
  function addLine(line) {
    var c = load(), k = lineKey(line.variantId, line.addons);
    var f = c.find(function (l) { return lineKey(l.variantId, l.addons) === k; });
    if (f) f.qty = Math.min(20, f.qty + line.qty); else c.push(line);
    save(c);
    px("AddToCart", { content_ids: [String(line.variantId)], content_type: "product", value: line.price * line.qty / 100, currency: "INR" });
  }
  function setQty(k, q) { var c = load(); c.forEach(function (l) { if (lineKey(l.variantId, l.addons) === k) l.qty = Math.max(0, Math.min(20, q)); }); save(c.filter(function (l) { return l.qty > 0; })); }
  function totals() { return load().reduce(function (a, l) { a.q += l.qty; a.v += l.price * l.qty; return a; }, { q: 0, v: 0 }); }

  /* ---------- how the food reaches the customer ---------- */
  function rest() { try { return JSON.parse(localStorage.getItem(RKEY) || "{}"); } catch (e) { return {}; } }
  function setRest(p) { var r = Object.assign(rest(), p); try { localStorage.setItem(RKEY, JSON.stringify(r)); } catch (e) {} return r; }
  // Table QR: /?table=5 → dine-in at table 5
  (function () {
    var t = new URLSearchParams(location.search).get("table");
    if (t && modes.dine_in) { setRest({ mode: "dine_in", table: t.slice(0, 20) }); toast("Ordering for table " + t.slice(0, 20)); }
  })();
  function mode() {
    var r = rest(), m = r.mode;
    if (m === "dine_in" && (!modes.dine_in || !r.table)) m = null;
    if (m && !modes[m]) m = null;
    return m || (modes.delivery ? "delivery" : modes.takeaway ? "takeaway" : modes.dine_in && r.table ? "dine_in" : "delivery");
  }

  /* ---------- paint counts, bar and menu steppers ---------- */
  function paint() {
    var t = totals();
    $$("[data-cart-count]").forEach(function (el) { el.textContent = t.q; el.hidden = !t.q; });
    var bar = $("[data-cartbar]");
    if (bar) {
      bar.hidden = !t.q;
      $("[data-cartbar-n]", bar).textContent = t.q;
      $("[data-cartbar-items]", bar).textContent = t.q === 1 ? "item" : "items";
      $("[data-cartbar-sum]", bar).textContent = money(t.v);
      body.classList.toggle("has-bar", t.q > 0);
    }
    var c = load();
    $$("[data-dish]").forEach(function (card) {
      var j = dishJson(card); if (!j) return;
      var btn = $("[data-add]", card), st = $("[data-stepper]", card); if (!btn || !st) return;
      var simple = btn.getAttribute("data-simple") === "true";
      var q = c.filter(function (l) { return l.itemId === j.id; }).reduce(function (n, l) { return n + l.qty; }, 0);
      if (simple && q > 0) { btn.hidden = true; st.hidden = false; $("[data-step-n]", st).textContent = q; }
      else { btn.hidden = false; st.hidden = true; btn.innerHTML = q > 0 ? "ADD<i>" + q + "</i>" : "ADD<i>+</i>"; }
    });
    if (sheetOpen("cart")) renderCart();
  }
  function dishJson(card) { if (card.__j) return card.__j; try { card.__j = JSON.parse($("[data-dish-json]", card).textContent); } catch (e) { card.__j = null; } return card.__j; }

  /* ---------- sheets ---------- */
  var lastFocus = null;
  function sheetOpen(n) { var s = $('[data-sheet="' + n + '"]'); return s && !s.hidden; }
  function openSheet(n) {
    var s = $('[data-sheet="' + n + '"]'); if (!s) return;
    lastFocus = document.activeElement; s.hidden = false;
    requestAnimationFrame(function () { s.classList.add("is-on"); var f = $("button, input", $(".sheet__panel", s)); if (f) f.focus({ preventScroll: true }); });
    body.classList.add("lock");
  }
  function closeSheet(n) {
    var s = $('[data-sheet="' + n + '"]'); if (!s || s.hidden) return;
    s.classList.remove("is-on"); setTimeout(function () { s.hidden = true; }, 220);
    if (!$$(".sheet.is-on").length) body.classList.remove("lock");
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  $$("[data-sheet]").forEach(function (s) { $$("[data-close]", s).forEach(function (b) { b.addEventListener("click", function () { closeSheet(s.getAttribute("data-sheet")); }); }); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") { closeSheet("dish"); closeSheet("cart"); } });

  /* ---------- dish options: size + add-ons ---------- */
  var cur = null;
  function openDish(j) {
    var avail = j.variants.filter(function (v) { return v.available; });
    if (!avail.length) { toast("Sold out right now"); return; }
    cur = { j: j, v: avail[0], picks: {}, qty: 1 };
    var s = $('[data-sheet="dish"]');
    $("[data-dish-title]", s).textContent = j.title;
    $("[data-dish-diet]", s).innerHTML = j.diet ? '<span class="veg veg--' + esc(j.diet) + '"><i></i></span>' + (j.diet === "veg" ? "Veg" : j.diet === "egg" ? "Contains egg" : "Non-veg") : "";
    var h = "";
    if (j.variants.length > 1) {
      h += '<fieldset class="grp"><legend>' + esc((j.options[0] && j.options[0].name) || "Choose one") + ' <small>Required</small></legend>';
      j.variants.forEach(function (v, i) {
        h += '<label class="opt' + (v.available ? "" : " is-off") + '"><input type="radio" name="v" value="' + v.id + '"' + (v === cur.v ? " checked" : "") + (v.available ? "" : " disabled") + '><span>' + esc(v.title) + "</span><b>" + money(v.price) + "</b></label>";
      });
      h += "</fieldset>";
    }
    (j.addons || []).forEach(function (g, gi) {
      var radio = g.max === 1 && g.min === 1;
      h += '<fieldset class="grp" data-g="' + gi + '"><legend>' + esc(g.name) + " <small>" + (g.min > 0 ? (g.min === 1 && g.max === 1 ? "Required · pick 1" : "Required · pick " + g.min + (g.max > g.min ? "–" + g.max : "")) : "Optional" + (g.max < g.options.length ? " · up to " + g.max : "")) + "</small></legend>";
      g.options.forEach(function (o, oi) {
        h += '<label class="opt"><input type="' + (radio ? "radio" : "checkbox") + '" name="g' + gi + '" value="' + oi + '"><span>' + esc(o.name) + "</span><b>" + (o.price ? "+ " + money(o.price * 100) : "Free") + "</b></label>";
      });
      h += "</fieldset>";
    });
    if (!h) h = '<p class="muted">Add this dish to your order.</p>';
    $("[data-dish-body]", s).innerHTML = h;
    $("[data-dish-err]", s).hidden = true;
    $$('input[name="v"]', s).forEach(function (r) { r.addEventListener("change", function () { cur.v = j.variants.find(function (v) { return String(v.id) === r.value; }); price(); }); });
    $$("[data-g]", s).forEach(function (fs) {
      var gi = +fs.getAttribute("data-g"), g = j.addons[gi];
      $$("input", fs).forEach(function (inp) {
        inp.addEventListener("change", function () {
          var on = $$("input:checked", fs).map(function (x) { return +x.value; });
          if (on.length > g.max) { inp.checked = false; toast("Choose up to " + g.max); on = on.filter(function (x) { return x !== +inp.value; }); }
          cur.picks[gi] = on; price();
        });
      });
    });
    $("[data-dish-qty] b", s).textContent = "1";
    price();
    openSheet("dish");
  }
  function addonPaise() { var n = 0; (cur.j.addons || []).forEach(function (g, gi) { (cur.picks[gi] || []).forEach(function (oi) { n += (g.options[oi].price || 0) * 100; }); }); return n; }
  function price() {
    var each = cur.v.price + addonPaise(), s = $('[data-sheet="dish"]');
    $("[data-dish-price]", s).textContent = money(cur.v.price);
    $("[data-dish-add]", s).textContent = "Add item · " + money(each * cur.qty);
  }
  $$("[data-dish-qty] [data-q]").forEach(function (b) {
    b.addEventListener("click", function () { if (!cur) return; cur.qty = Math.max(1, Math.min(20, cur.qty + +b.getAttribute("data-q"))); $("[data-dish-qty] b").textContent = cur.qty; price(); });
  });
  var addBtn = $("[data-dish-add]");
  if (addBtn) addBtn.addEventListener("click", function () {
    var j = cur.j, err = $("[data-dish-err]");
    for (var gi = 0; gi < (j.addons || []).length; gi++) {
      var g = j.addons[gi], n = (cur.picks[gi] || []).length;
      if (n < g.min) { err.textContent = "Choose " + (g.min === 1 ? "an option" : g.min + " options") + " for " + g.name; err.hidden = false; return; }
    }
    var picks = [], names = [];
    (j.addons || []).forEach(function (g, gi) { (cur.picks[gi] || []).slice().sort().forEach(function (oi) { picks.push(gi + "." + oi); names.push(g.options[oi].name); }); });
    addLine({ variantId: cur.v.id, itemId: j.id, title: j.title, variantTitle: cur.v.title === "Default" || j.variants.length < 2 ? "" : cur.v.title, addons: picks.join(","), addonText: names.join(", "), price: cur.v.price + addonPaise(), image: j.image, url: j.url, diet: j.diet || "", qty: cur.qty });
    closeSheet("dish"); toast("Added to your order");
  });

  /* ---------- menu cards ---------- */
  document.addEventListener("click", function (e) {
    var add = e.target.closest("[data-add]");
    if (add) {
      e.preventDefault();
      if (!OPEN) { toast("We're not taking orders right now"); return; }
      var card = add.closest("[data-dish]"), j = card && dishJson(card); if (!j) return;
      var v = j.variants.filter(function (x) { return x.available; })[0];
      if (add.getAttribute("data-simple") === "true" && v) {
        addLine({ variantId: v.id, itemId: j.id, title: j.title, variantTitle: "", addons: "", addonText: "", price: v.price, image: j.image, url: j.url, diet: j.diet || "", qty: 1 });
        toast("Added to your order");
      } else openDish(j);
      return;
    }
    var step = e.target.closest("[data-step]");
    if (step) {
      var c2 = step.closest("[data-dish]"), j2 = dishJson(c2); if (!j2) return;
      var line = load().find(function (l) { return l.itemId === j2.id && !l.addons; });
      if (line) setQty(lineKey(line.variantId, line.addons), line.qty + +step.getAttribute("data-step"));
      return;
    }
    if (e.target.closest("[data-open-cart], [data-cartbar]")) { e.preventDefault(); renderCart(); openSheet("cart"); }
  });
  window.__fsOpenCart = function () { renderCart(); openSheet("cart"); };

  /* ---------- cart sheet ---------- */
  var MODE_LABEL = { delivery: "Delivery", takeaway: "Takeaway", dine_in: "Dine-in" };
  function renderCart() {
    var s = $('[data-sheet="cart"]'); if (!s) return;
    var c = load(), t = totals(), m = mode(), r = rest();
    // modes
    var mh = "";
    ["delivery", "takeaway", "dine_in"].forEach(function (k) {
      if (!modes[k]) return;
      mh += '<button type="button" role="tab" aria-selected="' + (k === m) + '" class="mode' + (k === m ? " is-on" : "") + '" data-mode="' + k + '">' + MODE_LABEL[k] + "</button>";
    });
    $("[data-modes]", s).innerHTML = mh;
    $("[data-modes]", s).hidden = (mh.match(/data-mode/g) || []).length < 2;
    // where
    var w = "";
    if (m === "delivery") {
      if (REST.needsLocation) {
        w = r.lat ? '<p class="where__ok"><b>Delivery location shared</b><button type="button" class="link" data-locate>Update</button></p>'
          : '<div class="where__ask"><p><b>Where should we deliver?</b><span>Share your location so we can check the distance and delivery charge. You\'ll enter your full address at checkout.</span></p><button type="button" class="btn btn--ghost" data-locate>Use my current location</button></div>';
      } else w = '<p class="muted">You\'ll enter your delivery address at checkout.</p>';
      if (REST.minDelivery && t.v / 100 < REST.minDelivery) w += '<p class="warn">Minimum order for delivery is ₹' + REST.minDelivery + ". Add ₹" + Math.ceil(REST.minDelivery - t.v / 100) + " more.</p>";
    } else if (m === "takeaway") {
      w = '<p class="muted">Pick up your order from the restaurant. We\'ll tell you when it\'s ready.</p>';
      if (REST.minTakeaway && t.v / 100 < REST.minTakeaway) w += '<p class="warn">Minimum order for takeaway is ₹' + REST.minTakeaway + ". Add ₹" + Math.ceil(REST.minTakeaway - t.v / 100) + " more.</p>";
    } else if (m === "dine_in") {
      w = '<p class="where__ok"><b>Table ' + esc(r.table) + "</b><span class=\"muted\">We'll bring it to your table.</span></p>";
    }
    $("[data-where]", s).innerHTML = w;
    // lines
    $("[data-lines]", s).innerHTML = c.map(function (l) {
      var k = lineKey(l.variantId, l.addons);
      return '<div class="line"><div class="line__info">' + (l.diet ? '<span class="veg veg--' + esc(l.diet) + '"><i></i></span>' : "") +
        '<div><p class="line__t">' + esc(l.title) + "</p>" + (l.variantTitle ? '<p class="line__v">' + esc(l.variantTitle) + "</p>" : "") + (l.addonText ? '<p class="line__v">+ ' + esc(l.addonText) + "</p>" : "") + "</div></div>" +
        '<div class="line__end"><div class="qty qty--sm"><button type="button" data-lq="-1" data-k="' + esc(k) + '" aria-label="Less">−</button><b>' + l.qty + '</b><button type="button" data-lq="1" data-k="' + esc(k) + '" aria-label="More">+</button></div><b class="line__p">' + money(l.price * l.qty) + "</b></div></div>";
    }).join("");
    $("[data-empty]", s).hidden = c.length > 0;
    $("[data-cart-total]", s).textContent = money(t.v);
    var btn = $("[data-checkout]", s);
    var block = !c.length || !OPEN || (m === "delivery" && REST.needsLocation && !r.lat) ||
      (m === "delivery" && REST.minDelivery && t.v / 100 < REST.minDelivery) || (m === "takeaway" && REST.minTakeaway && t.v / 100 < REST.minTakeaway);
    btn.disabled = !!block;
    var warn = $("[data-cart-warn]", s);
    warn.hidden = OPEN; warn.textContent = OPEN ? "" : "We're not taking orders right now.";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-lq]");
    if (b) { var k = b.getAttribute("data-k"), l = load().find(function (x) { return lineKey(x.variantId, x.addons) === k; }); if (l) setQty(k, l.qty + +b.getAttribute("data-lq")); return; }
    var md = e.target.closest("[data-mode]");
    if (md) {
      var k2 = md.getAttribute("data-mode");
      if (k2 === "dine_in" && !rest().table) { toast("Scan the QR code on your table to order dine-in"); return; }
      setRest({ mode: k2 }); renderCart(); return;
    }
    if (e.target.closest("[data-locate]")) {
      if (!navigator.geolocation) { toast("Your browser can't share location. Try another browser."); return; }
      toast("Finding your location…");
      navigator.geolocation.getCurrentPosition(function (p) {
        setRest({ lat: Math.round(p.coords.latitude * 1e5) / 1e5, lng: Math.round(p.coords.longitude * 1e5) / 1e5 }); toast("Location saved"); renderCart();
      }, function () { toast("Couldn't get your location. Allow location access and try again."); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
    }
  });
  var go = $("[data-checkout]");
  if (go) go.addEventListener("click", function () {
    var c = load(); if (!c.length) return;
    var r = rest(), m = mode(), err = $("[data-checkout-err]");
    go.disabled = true; var label = go.innerHTML; go.textContent = "Opening checkout…"; err.hidden = true;
    px("InitiateCheckout", { value: totals().v / 100, currency: "INR", num_items: totals().q });
    fetch(ROOT + "/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        src: (function () { try { return sessionStorage.getItem("gp_src") || ""; } catch (e) { return ""; } })(),
        lines: c.map(function (l) { return { variantId: l.variantId, qty: l.qty, addons: l.addons || "" }; }),
        rest: { mode: m, table: m === "dine_in" ? r.table : null, lat: r.lat, lng: r.lng },
      }),
    }).then(function (res) { return res.json().then(function (d) { return { ok: res.ok, d: d }; }); }).then(function (x) {
      if (x.ok && x.d.url) { location.href = x.d.url; return; }
      throw new Error((x.d && x.d.error) || "Couldn't open checkout. Please try again.");
    }).catch(function (e) { err.textContent = e.message; err.hidden = false; go.disabled = false; go.innerHTML = label; });
  });

  /* ---------- menu: tabs, search, veg only ---------- */
  var tabs = $("[data-tabs]");
  if (tabs) {
    var links = $$("[data-tab]", tabs);
    links.forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault(); var t = document.getElementById(a.getAttribute("data-tab")); if (!t) return;
        var off = ($("[data-menu-bar]") || { offsetHeight: 0 }).offsetHeight + 74;
        window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - off + 4, behavior: "smooth" });
      });
    });
    var spy = function () {
      var off = ($("[data-menu-bar]") || { offsetHeight: 0 }).offsetHeight + 90, curId = null;
      $$("[data-msec]").forEach(function (sec) { if (!sec.hidden && sec.getBoundingClientRect().top - off <= 0) curId = sec.id; });
      links.forEach(function (a) {
        var on = a.getAttribute("data-tab") === curId;
        if (on && !a.classList.contains("is-on")) { a.classList.add("is-on"); tabs.scrollTo({ left: a.offsetLeft - 16, behavior: "smooth" }); }
        if (!on) a.classList.remove("is-on");
      });
    };
    var raf = 0; addEventListener("scroll", function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(spy); }, { passive: true }); spy();
  }
  var q = $("[data-menu-search]"), veg = $("[data-veg-only]");
  function filter() {
    var term = q ? q.value.trim().toLowerCase() : "", vo = veg && veg.checked, any = false;
    $$("[data-msec]").forEach(function (sec) {
      var shown = 0;
      $$("[data-dish]", sec).forEach(function (d) {
        var ok = (!term || d.getAttribute("data-name").indexOf(term) >= 0) && (!vo || d.getAttribute("data-diet") === "veg");
        d.hidden = !ok; if (ok) shown++;
      });
      sec.hidden = !shown; if (shown) any = true;
      var tab = tabs && $('[data-tab="' + sec.id + '"]', tabs); if (tab) tab.hidden = !shown;
    });
    var none = $("[data-menu-none]"); if (none) none.hidden = any || !$$("[data-msec]").length;
    $$(".best").forEach(function (b) { b.hidden = !!(term || vo); });
  }
  if (q) q.addEventListener("input", filter);
  if (veg) { try { veg.checked = localStorage.getItem("gp_veg_" + SHOP) === "1"; } catch (e) {} veg.addEventListener("change", function () { try { localStorage.setItem("gp_veg_" + SHOP, veg.checked ? "1" : "0"); } catch (e) {} filter(); }); if (veg.checked) filter(); }

  paint();
  if (/[?&]cart=1/.test(location.search) && load().length) window.__fsOpenCart();
})();
