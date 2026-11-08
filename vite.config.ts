import { vitePlugin as remix } from "@remix-run/dev";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// Built JS/CSS always load from Growpefy's own address, even when the checkout page is shown on a
// store's domain through the Shopify App Proxy (https://<store>/apps/growpefy/...).
const appOrigin = (process.env.APP_URL || "https://growpefy.com").replace(/\/+$/, "");

export default defineConfig(({ command }) => ({
  base: command === "build" ? `${appOrigin}/` : "/",
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
        // Off on purpose: lazy discovery fetches /__manifest from the page's own domain, which doesn't exist on a
        // store's domain (App Proxy checkout). The full route list is sent with the page instead.
        v3_lazyRouteDiscovery: false,
      },
      // The checkout and thank-you pages also live under /apps/growpefy (the store's domain, via the App Proxy).
      // Same files, second address, so the page works the same on both.
      routes: (defineRoutes) =>
        defineRoutes((route) => {
          route("/apps/growpefy/c/:sessionId", "routes/c.$sessionId.tsx", { id: "proxy-checkout" });
          route("/apps/growpefy/order/:orderId", "routes/order.$orderId.tsx", { id: "proxy-order" });
          route("/apps/growpefy/api/pincode/:pin", "routes/api.pincode.$pin.ts", { id: "proxy-pincode" });
          // A store that moved off Shopify keeps /apps/growpefy links on its own domain (now served by Growpefy directly)
          route("/apps/growpefy/pay/:orderId", "routes/pay.$orderId.tsx", { id: "own-pay" });
          route("/apps/growpefy/pg/:gateway/return", "routes/pg.$gateway.return.ts", { id: "own-pg-return" });
        }),
    }),
    tsconfigPaths(),
  ],
}));
