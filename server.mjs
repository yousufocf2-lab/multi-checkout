// Production server (replaces remix-serve). Same as remix-serve, plus:
//  1. Shopify App Proxy checkout: Shopify sends https://<store>/apps/growpefy/<path> to
//     https://growpefy.com/proxy/<path>. Checkout pages (c, order, api) are rewritten to /apps/growpefy/<path>,
//     so the server and the customer's browser see the same route.
//  2. Built JS/CSS load from growpefy.com on the store's domain too, so they're sent with CORS headers.
import { createRequestHandler } from "@remix-run/express";
import { installGlobals } from "@remix-run/node";
import compression from "compression";
import express from "express";
import morgan from "morgan";
import path from "node:path";
import url from "node:url";

installGlobals();

const here = path.dirname(url.fileURLToPath(import.meta.url));
const build = await import(url.pathToFileURL(path.join(here, "build/server/index.js")).href);

// Paths under /proxy/ that the checkout uses (everything else under /proxy/ keeps its own route: pay, pg, payu, ping)
const PROXIED = /^\/proxy\/(c|order|api\/pincode)(\/|$)/;

const app = express();
app.disable("x-powered-by");
app.use(compression());

// Query params Shopify adds to every App Proxy request. The checkout pages don't use them; dropping them keeps
// the page's own links and forms clean (Shopify adds fresh ones on the next request anyway).
const SHOPIFY_PARAMS = ["shop", "path_prefix", "timestamp", "signature", "logged_in_customer_id"];

// The website lives on growpefy.com. People (and Google) sometimes reach it through Railway's own address or
// www.: send page visits there with a permanent redirect. Only GET/HEAD, so webhooks, payment returns and the
// health check keep working on any address.
// Store domains come in through Cloudflare (Worker "growpefy-domains"): the shopper's domain is in X-GP-Host and the
// request carries our shared key. Only then do we treat it as that host; anyone else's X-GP-* headers are dropped.
const PROXY_KEY = process.env.CF_PROXY_KEY || "";
app.use((req, _res, next) => {
  const key = req.headers["x-gp-key"];
  const host = String(req.headers["x-gp-host"] || "").toLowerCase();
  if (PROXY_KEY && key && key === PROXY_KEY && /^[a-z0-9.-]{3,253}$/.test(host)) {
    req.headers.host = host;
    req.headers["x-forwarded-host"] = host;
    req.headers["x-forwarded-proto"] = "https";
    const ip = String(req.headers["x-gp-ip"] || "");
    if (/^[\d.:a-fA-F]{3,45}$/.test(ip)) req.headers["x-forwarded-for"] = ip;
  }
  delete req.headers["x-gp-key"]; delete req.headers["x-gp-host"]; delete req.headers["x-gp-ip"];
  next();
});

const CANONICAL = (process.env.APP_URL || "https://growpefy.com").replace(/\/+$/, "");
const canonicalHost = new URL(CANONICAL).host;
const isOtherHost = (h) => h.endsWith(".up.railway.app") || h === `www.${canonicalHost}`;
app.use((req, res, next) => {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase();
  if ((req.method === "GET" || req.method === "HEAD") && host && host !== canonicalHost && isOtherHost(host) && req.path !== "/healthz") {
    return res.redirect(301, CANONICAL + req.originalUrl);
  }
  next();
});

// A store's own website domain (www.brand.com): storefront paths go to the /sfhost routes, /admin to the dashboard.
// Every other path (checkout /c, /pay, /order, /media, /api, /dashboard, /login, assets) works as on growpefy.com.
const checkoutRootHost = String(process.env.CHECKOUT_DOMAIN || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/:].*$/, "");
const STOREFRONT_PATH = /^\/($|products?\/|category\/|collections\/|pages\/|cart\/?$|checkout\/?$|search\/?$|search\/suggest\/?$)/; // /account is a normal page on every host
/** Shopify-style paths -> ours. Null when the path needs no change. */
function legacyPath(p) {
  let m;
  const loc = p.match(/^\/[a-z]{2}(?:-[a-z]{2})?(\/(?:products|collections|pages|policies|cart|search|account)(?:\/.*)?)$/i);
  if (loc) p = loc[1];
  if ((m = p.match(/^\/collections\/[^/]+\/products\/([^/.]+)/))) return `/product/${m[1]}`;
  if ((m = p.match(/^\/products\/([^/.]+)\.(?:js|json|oembed|xml|atom)$/))) return `/product/${m[1]}`;
  if ((m = p.match(/^\/policies\/([^/]+)\/?$/))) return `/pages/${m[1]}`;
  if (/^\/(?:collections\/?|collections\/(?:vendors|types))\/?$/.test(p)) return "/products/all"; // /search is the store's own search page
  if ((m = p.match(/^\/collections\/([^/]+)\/?$/))) return m[1] === "all" ? "/products/all" : `/category/${m[1]}`;
  if (/^\/account\/(?:login|register)\/?$/.test(p)) return "/account";
  return loc ? p : null;
}

app.use((req, res, next) => {
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  const ours = !host || host === canonicalHost || isOtherHost(host) || host === "localhost" || host === "127.0.0.1"
    || (checkoutRootHost && (host === checkoutRootHost || host.endsWith("." + checkoutRootHost)));
  if (!ours) {
    if (req.path === "/admin" || req.path.startsWith("/admin/")) return res.redirect(302, "/dashboard");
    // Links from an old Shopify site (ads, Google, bookmarks): send them to the same thing here, query kept (utm, fbclid, variant)
    if (req.method === "GET" || req.method === "HEAD") {
      const moved = legacyPath(req.path);
      if (moved && moved !== req.path) return res.redirect(301, moved + (req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : ""));
    }
    if (STOREFRONT_PATH.test(req.path) || req.path === "/favicon.ico") {
      const rest = req.url === "/" ? "" : req.url.replace(/\/$/, "") ;
      req.url = req.originalUrl = "/sfhost" + (rest.startsWith("/?") ? rest.slice(1) : rest);
    }
  }
  next();
});

app.use((req, _res, next) => {
  if (PROXIED.test(req.url)) {
    const u = new URL(req.url, "http://x");
    SHOPIFY_PARAMS.forEach((k) => u.searchParams.delete(k));
    // Remix reads originalUrl, express.static reads url: rewrite both
    req.url = req.originalUrl = "/apps/growpefy" + u.pathname.slice("/proxy".length) + u.search;
  }
  next();
});

// Built files (hashed names): cache for a year, readable from any store's domain
app.use("/assets", express.static(path.join(here, "build/client/assets"), {
  immutable: true,
  maxAge: "1y",
  setHeaders: (res) => res.setHeader("Access-Control-Allow-Origin", "*"),
}));
app.use(express.static(path.join(here, "build/client"), {
  maxAge: "1h",
  setHeaders: (res) => res.setHeader("Access-Control-Allow-Origin", "*"),
}));
app.use(morgan("tiny"));
app.all("*", createRequestHandler({ build, mode: process.env.NODE_ENV }));

const port = Number(process.env.PORT) || 3000;
const server = process.env.HOST ? app.listen(port, process.env.HOST, ready) : app.listen(port, ready);
function ready() {
  console.log(`[server] http://localhost:${port}`);
  // Wake the background jobs (payment recheck) right away instead of waiting for the first visitor
  setTimeout(() => { fetch(`http://127.0.0.1:${port}/healthz`).catch(() => {}); }, 3000).unref?.();
}
["SIGTERM", "SIGINT"].forEach((s) => process.once(s, () => server.close(console.error)));
