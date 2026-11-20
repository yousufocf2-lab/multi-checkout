// Splits a hostname into its DNS "Name / Host" part and the registered domain, knowing two-part endings like
// .co.in. Shared by server and browser.

const TWO_PART = new Set([
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "edu.in", "ac.in", "res.in", "gov.in",
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "ac.uk",
  "com.au", "net.au", "org.au", "co.nz", "co.za", "com.sg", "com.my", "co.id", "com.br", "com.mx",
  "co.jp", "co.kr", "com.cn", "com.hk", "com.tw", "com.tr", "com.pk", "com.bd", "com.np", "com.lk",
  "co.ae", "com.sa", "com.eg", "com.ng", "co.ke", "com.ph", "com.vn", "co.th", "in.th",
]);

/** "www.brand.co.in" -> { registered: "brand.co.in", host: "www" }; "brand.co.in" -> host "@". */
export function domainParts(domain: string) {
  const labels = domain.trim().toLowerCase().replace(/\.$/, "").split(".");
  const keep = labels.length >= 3 && TWO_PART.has(labels.slice(-2).join(".")) ? 3 : 2;
  const registered = labels.slice(-keep).join(".");
  const sub = labels.slice(0, -keep).join(".");
  return { registered, host: sub || "@", isApex: !sub };
}
