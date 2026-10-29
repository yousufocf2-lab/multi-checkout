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
function ready() { console.log(`[server] http://localhost:${port}`); }
["SIGTERM", "SIGINT"].forEach((s) => process.once(s, () => server.close(console.error)));
