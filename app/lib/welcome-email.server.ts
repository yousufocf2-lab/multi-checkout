// Branded HTML for the welcome emails (lead + signup). Table layout with inline styles so it looks right in
// Gmail, Outlook and phone mail apps. Images are served from growpefy.com/brand/email/.
import { fillName, greetName } from "./welcome";

export type EmailBrand = {
  baseUrl: string; // https://growpefy.com
  fromName: string;
  whatsapp: string | null; // digits with country code, e.g. 919000000000
  supportEmail: string;
  address: string;
};

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const G = { green: "#0B5D4B", dark: "#083A30", mint: "#2DD496", ink: "#0B1513", soft: "#4A5753", faint: "#7C8884", rule: "#E3E8E5", tint: "#EEF6F2", page: "#F2F5F3" };

/** Bulletproof button (works in Outlook too). */
function button(href: string, label: string, bg: string, color = "#ffffff") {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tr><td align="center" bgcolor="${bg}" style="border-radius:10px;background:${bg}">
<a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1;color:${color};text-decoration:none;border-radius:10px">${label}</a></td></tr></table>`;
}

const paragraphs = (text: string) =>
  esc(text).split(/\n{2,}/).filter((p) => p.trim()).map((p) =>
    `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;line-height:1.65;color:${G.soft}">${p.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, `<a href="$1" style="color:${G.green};font-weight:600">$1</a>`)}</p>`).join("");

const FEATURES = [
  { icon: "ic-prepaid.png", title: "More prepaid orders", text: "Prepaid discounts, bank offers and a fast 3-step checkout that shoppers finish." },
  { icon: "ic-rto.png", title: "Lower RTO", text: "OTP on COD, RTO Shield and smart COD rules block risky and fake orders." },
  { icon: "ic-whatsapp.png", title: "COD confirmed on WhatsApp", text: "Every COD order gets a confirm / cancel message before you ship it." },
  { icon: "ic-ads.png", title: "Real ROAS from your ads", text: "Meta and Google spend next to your real orders, in one dashboard." },
];

/** The design adds its own "Hi name," and sign-off, so drop them from older message texts. */
function cleanBody(body: string) {
  const parts = body.trim().split(/\n{2,}/);
  if (parts.length > 1 && /^(hi|hello|dear)\b[^\n]{0,40},?$/i.test(parts[0].trim())) parts.shift();
  if (parts.length > 1 && /^(team growpefy|cheers|regards|thanks)[\s\S]{0,40}$/i.test(parts.at(-1)!.trim())) parts.pop();
  return parts.join("\n\n");
}

const phoneLabel = (d: string) => (d.length === 12 && d.startsWith("91") ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`);

export function welcomeEmail(kind: "lead" | "signup", rawName: string, rawBody: string, b: EmailBrand) {
  const body = cleanBody(rawBody);
  const name = greetName(rawName);
  const hi = name === "there" ? "" : `, ${esc(name)}`;
  const img = (f: string) => `${b.baseUrl}/brand/email/${f}`;
  const wa = b.whatsapp ? `https://wa.me/${b.whatsapp}?text=${encodeURIComponent(kind === "lead" ? "Hi Growpefy, I'd like a demo of the checkout" : "Hi Growpefy, please help me set up my store")}` : null;
  const lead = kind === "lead";
  const heading = lead ? `Thanks for your interest${hi} 👋` : `Welcome to Growpefy${hi} 🎉`;
  const sub = lead
    ? "One checkout that brings more prepaid orders, cuts RTO and confirms COD orders on WhatsApp."
    : "Your account is ready. Three quick steps and your new checkout goes live.";
  const primary = lead ? { href: `${b.baseUrl}/signup`, label: "Create your free account" } : { href: `${b.baseUrl}/login`, label: "Finish your setup" };
  const preheader = lead ? "Here's how Growpefy helps your store sell more and lose less to RTO." : "Your Growpefy account is ready. Here's how to go live.";

  const steps = lead ? "" : `
<tr><td style="padding:8px 36px 4px">
  <p style="margin:0 0 12px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${G.green}">Go live in 3 steps</p>
  ${[["Business details", "PAN, GST and address. Takes 2 minutes."], ["Connect your store", "Shopify or WooCommerce, with our step-by-step guide."], ["Recharge and switch on", "Add wallet balance and your checkout is live."]].map(([t, d], i) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px"><tr>
    <td width="40" valign="top"><div style="width:30px;height:30px;border-radius:15px;background:${G.green};color:#fff;font-family:${FONT};font-size:14px;font-weight:700;line-height:30px;text-align:center">${i + 1}</div></td>
    <td valign="top" style="padding:2px 0 0"><p style="margin:0;font-family:${FONT};font-size:15px;font-weight:700;color:${G.ink}">${t}</p><p style="margin:2px 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${G.faint}">${d}</p></td>
  </tr></table>`).join("")}
</td></tr>`;

  const feature = (f: (typeof FEATURES)[number]) => `
<td width="50%" valign="top" style="padding:8px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${G.rule};border-radius:14px"><tr><td style="padding:18px">
    <img src="${img(f.icon)}" width="44" height="44" alt="" style="display:block;border:0;border-radius:12px">
    <p style="margin:12px 0 4px;font-family:${FONT};font-size:15px;font-weight:700;color:${G.ink}">${f.title}</p>
    <p style="margin:0;font-family:${FONT};font-size:13px;line-height:1.55;color:${G.faint}">${f.text}</p>
  </td></tr></table>
</td>`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>Growpefy</title>
<style>
  @media (max-width:620px){
    .wrap{width:100%!important} .px{padding-left:22px!important;padding-right:22px!important} .h1{font-size:24px!important}
    .stack > td{display:block!important;width:auto!important;padding-left:0!important;padding-right:0!important}
    .btns > td{display:block!important;padding:0 0 10px!important}
    .feat{padding-left:16px!important;padding-right:16px!important}
  }
</style></head>
<body style="margin:0;padding:0;background:${G.page}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${preheader}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${G.page}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${G.rule}">

  <!-- header -->
  <tr><td class="px" style="padding:22px 36px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td><a href="${b.baseUrl}" target="_blank"><img src="${img("logo.png")}" height="34" alt="Growpefy" style="display:block;border:0;height:34px;width:auto"></a></td>
      <td align="right" style="font-family:${FONT};font-size:12px;color:${G.faint}"><a href="${b.baseUrl}" style="color:${G.faint};text-decoration:none">growpefy.com</a></td>
    </tr></table>
  </td></tr>

  <!-- hero -->
  <tr><td bgcolor="${G.green}" style="background:${G.green};background-image:linear-gradient(135deg,${G.dark} 0%,${G.green} 60%,#0F7A61 100%)">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr><td class="px" style="padding:34px 36px 8px">
        <h1 class="h1" style="margin:0 0 10px;font-family:${FONT};font-size:28px;line-height:1.25;font-weight:800;color:#ffffff">${heading}</h1>
        <p style="margin:0 0 22px;font-family:${FONT};font-size:16px;line-height:1.6;color:#CFE6DE">${sub}</p>
        ${button(primary.href, primary.label, "#ffffff", G.green)}
      </td></tr>
      <tr><td style="padding:24px 0 0"><img src="${img("hero.jpg")}" width="600" alt="Growpefy checkout on a phone: prepaid offers, WhatsApp COD confirmation and RTO Shield" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>
    </table>
  </td></tr>

  <!-- message -->
  <tr><td class="px" style="padding:30px 36px 10px">
    <p style="margin:0 0 14px;font-family:${FONT};font-size:16px;font-weight:700;color:${G.ink}">Hi ${esc(name)},</p>
    ${paragraphs(fillName(body, name))}
  </td></tr>
  ${steps}

  <!-- features -->
  <tr><td class="feat" style="padding:14px 28px 6px;background:${G.tint}">
    <p class="px" style="margin:18px 8px 6px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${G.green}">What Growpefy does for your store</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr class="stack">${feature(FEATURES[0])}${feature(FEATURES[1])}</tr>
      <tr class="stack">${feature(FEATURES[2])}${feature(FEATURES[3])}</tr>
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0 20px"><tr>
      <td align="center" style="font-family:${FONT};font-size:12px;color:${G.faint};padding:6px 0">Works with</td></tr><tr>
      <td align="center">
        <img src="${`${b.baseUrl}/brand/platforms/shopify.png`}" height="26" alt="Shopify" style="height:26px;width:auto;border:0;vertical-align:middle;margin:0 10px">
        <img src="${`${b.baseUrl}/brand/platforms/woocommerce.png`}" height="22" alt="WooCommerce" style="height:22px;width:auto;border:0;vertical-align:middle;margin:0 10px">
        <img src="${`${b.baseUrl}/brand/ads/meta.png`}" height="20" alt="Meta" style="height:20px;width:auto;border:0;vertical-align:middle;margin:0 10px">
        <img src="${`${b.baseUrl}/brand/ads/google-ads.png`}" height="22" alt="Google Ads" style="height:22px;width:auto;border:0;vertical-align:middle;margin:0 10px">
      </td></tr></table>
  </td></tr>

  <!-- help -->
  <tr><td class="px" style="padding:28px 36px 30px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${G.rule};border-radius:14px"><tr><td style="padding:22px 22px 20px">
      <p style="margin:0 0 4px;font-family:${FONT};font-size:17px;font-weight:800;color:${G.ink}">${lead ? "Want a quick demo?" : "Want us to set it up with you?"}</p>
      <p style="margin:0 0 16px;font-family:${FONT};font-size:14px;line-height:1.6;color:${G.soft}">${lead ? "We'll show you the checkout on your own products in 15 minutes." : "Our team can connect your store and switch on the checkout with you on a call."} Message us on WhatsApp or just reply to this email.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr class="btns">
        ${wa ? `<td style="padding:0 10px 0 0">${button(wa, "Chat on WhatsApp", "#25D366")}</td>` : ""}
        <td>${button(primary.href, lead ? "Create free account" : "Open dashboard", G.green)}</td>
      </tr></table>
    </td></tr></table>
    <p style="margin:24px 0 0;font-family:${FONT};font-size:15px;line-height:1.5;color:${G.soft}">Cheers,<br><b style="color:${G.ink}">${esc(b.fromName)}</b><br><span style="font-size:13px;color:${G.faint}">Growpefy · D2C checkout and growth</span></p>
  </td></tr>

  <!-- footer -->
  <tr><td bgcolor="${G.dark}" class="px" style="background:${G.dark};padding:26px 36px">
    <p style="margin:0 0 10px;font-family:${FONT};font-size:13px;line-height:1.6">
      <a href="${b.baseUrl}" style="color:#ffffff;text-decoration:none;font-weight:700">Website</a><span style="color:#5E8B7F">&nbsp;·&nbsp;</span>
      <a href="${b.baseUrl}/pricing" style="color:#ffffff;text-decoration:none;font-weight:700">Pricing</a><span style="color:#5E8B7F">&nbsp;·&nbsp;</span>
      <a href="${b.baseUrl}/contact" style="color:#ffffff;text-decoration:none;font-weight:700">Contact</a>
    </p>
    <p style="margin:0 0 10px;font-family:${FONT};font-size:12px;line-height:1.7;color:#A9C9BE">
      <a href="mailto:${esc(b.supportEmail)}" style="color:#A9C9BE">${esc(b.supportEmail)}</a>${b.whatsapp ? ` · WhatsApp ${phoneLabel(b.whatsapp)}` : ""}${b.address ? `<br>${esc(b.address)}` : ""}
    </p>
    <p style="margin:0;font-family:${FONT};font-size:11px;line-height:1.6;color:#7FA79A">You're getting this email because you ${lead ? "asked Growpefy to contact you" : "created a Growpefy account"}. © ${new Date().getFullYear()} Growpefy.</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `Hi ${name},`, "", fillName(body, name), "",
    lead ? `Create your free account: ${b.baseUrl}/signup` : `Finish your setup: ${b.baseUrl}/login`,
    wa ? `Chat with us on WhatsApp: ${wa}` : "",
    "", "What Growpefy does for your store:", ...FEATURES.map((f) => `- ${f.title}: ${f.text}`),
    "", `Cheers,`, b.fromName, "", `Growpefy · ${b.baseUrl} · ${b.supportEmail}`,
  ].filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");

  return { html, text };
}
