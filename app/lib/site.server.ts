import { getViewer } from "./auth.server";
import { requireAppHost } from "./host.server";
import { mergeRates } from "./wallet";
import { getPlatform } from "./wallet.server";

/** Shared data for the public website: our business details, live rate card, and whether the visitor is logged in. */
export async function siteData(request: Request) {
  requireAppHost(request);
  const [p, viewer] = await Promise.all([getPlatform(), getViewer(request)]);
  const b = p.billing ?? {};
  return {
    loggedIn: Boolean(viewer),
    company: {
      name: b.name || "Growpefy",
      address: b.address || "",
      state: b.state || "",
      gstin: b.gstin || "",
      email: b.email || "support@growpefy.com",
      phone: b.phone || "",
    },
    rates: mergeRates(p.rates),
    verify: { google: process.env.GOOGLE_SITE_VERIFICATION || null, bing: process.env.BING_SITE_VERIFICATION || null },
    minRecharge: p.minRechargePaise,
  };
}

export type SiteData = Awaited<ReturnType<typeof siteData>>;
