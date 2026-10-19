import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { LegalPage, SiteLayout, siteMeta } from "~/components/site/SiteLayout";
import { siteData } from "~/lib/site.server";
import { rupees } from "~/lib/wallet";

export const meta: MetaFunction = () => siteMeta("Terms & Conditions · Growpefy", "The terms that apply when you use Growpefy checkout, dashboard and wallet.", "/terms");
export const loader = async ({ request }: LoaderFunctionArgs) => json(await siteData(request));
const UPDATED = "19 October 2026";

export default function Page() {
  const d = useLoaderData<typeof loader>();
  const c = d.company;
  const place = c.state || "India";
  return (
    <SiteLayout loggedIn={d.loggedIn} company={c}>
      <LegalPage title="Terms & Conditions" updated={UPDATED}>
        <p>These Terms &amp; Conditions ("Terms") govern your use of Growpefy, including the website growpefy.com, the merchant dashboard, the hosted checkout and related services (together, the "Service"), operated by <strong>{c.name}</strong> ("Growpefy", "we", "us"). By creating an account or using the Service you agree to these Terms.</p>
        <h2>1. The Service</h2>
        <p>Growpefy provides a hosted checkout and dashboard for online stores built on platforms such as Shopify, WooCommerce or custom websites. It includes checkout pages, discount and offer tools, cash-on-delivery and RTO protection tools, analytics, order syncing to your store and optional OTP and WhatsApp messaging. Payments from your customers are processed by your own payment gateway account; Growpefy does not hold or settle your customers' money.</p>
        <h2>2. Your account</h2>
        <ul>
          <li>You must be at least 18 years old and able to enter a binding contract, and you must give accurate business details.</li>
          <li>You are responsible for keeping your login details safe and for all activity under your account. Sessions end automatically after a period of inactivity.</li>
          <li>You may only connect stores, store apps, payment gateways and ad accounts that you own or are authorised to manage.</li>
        </ul>
        <h2>3. Fees and the prepaid wallet</h2>
        <ul>
          <li>Fees are charged from a prepaid wallet as shown on our <Link to="/pricing">Pricing</Link> page, including a percentage fee on orders placed through the checkout and per-message charges for OTP and WhatsApp messages you choose to use.</li>
          <li>Wallet recharges are subject to 18% GST, charged in addition to the recharge amount. A GST tax invoice is issued for each recharge. The minimum recharge is {rupees(d.minRecharge, 0)} plus GST.</li>
          <li>To keep your checkout running, the wallet may go below zero up to a limit. Beyond that limit some features (such as promotional messages and parts of the dashboard) may be paused until you recharge. Any negative balance is adjusted from your next recharge.</li>
          <li>We may change our rates with at least 15 days' notice by email or in the dashboard. Changes apply only to usage after the effective date.</li>
          <li>Wallet balance is non-refundable and non-transferable, except as described in our <Link to="/refund-policy">Refund &amp; Cancellation Policy</Link>.</li>
        </ul>
        <h2>4. Your responsibilities</h2>
        <ul>
          <li>You are the seller of record for every order. You are responsible for your products, prices, taxes, invoices to customers, shipping, returns, refunds and customer support.</li>
          <li>You must comply with applicable laws, including consumer protection, e-commerce, data protection and advertising rules, and with the terms of your store platform, your payment gateway and Meta.</li>
          <li>You must not use the Service for prohibited or illegal goods, fraud, spam, or to interfere with the security or operation of the Service.</li>
        </ul>
        <h2>5. Third-party services</h2>
        <p>The Service connects to third-party platforms such as store platforms (e.g. Shopify, WooCommerce), payment gateways, Meta and messaging providers. Their availability, fees and terms are outside our control, and we are not responsible for their acts or outages. Payment disputes, chargebacks and settlements are handled between you, your customers and your payment gateway.</p>
        <h2>6. Data</h2>
        <p>You own your store and customer data. You authorise us to process it to provide the Service, as described in our <Link to="/privacy">Privacy Policy</Link>. You are responsible for having a lawful basis and any notices needed to share your customers' data with us.</p>
        <h2>7. Availability and changes</h2>
        <p>We work to keep the Service available and secure but do not guarantee it will be uninterrupted or error-free. We may improve, change or discontinue features. We will give reasonable notice of changes that materially reduce the Service.</p>
        <h2>8. Suspension and termination</h2>
        <p>You may stop using the Service at any time by removing our script from your theme and asking us to close your account. We may suspend or close an account that breaches these Terms, creates risk or legal exposure, or remains unpaid, with notice where reasonably possible.</p>
        <h2>9. Intellectual property</h2>
        <p>The Service, the Growpefy name, logo and software belong to us or our licensors. We grant you a limited, non-exclusive, non-transferable right to use the Service during your subscription. You keep all rights to your brand, content and data.</p>
        <h2>10. Disclaimer and limitation of liability</h2>
        <p>The Service is provided "as is". To the maximum extent permitted by law, we are not liable for indirect, incidental or consequential losses, lost profits, lost sales or data loss. Our total liability for any claim relating to the Service is limited to the fees you paid us in the three months before the claim arose.</p>
        <h2>11. Indemnity</h2>
        <p>You agree to indemnify us against claims arising from your products, your store, your breach of these Terms or your violation of law or third-party rights.</p>
        <h2>12. Governing law</h2>
        <p>These Terms are governed by the laws of India. Courts at {place} shall have exclusive jurisdiction, subject to any mandatory consumer laws.</p>
        <h2>13. Contact</h2>
        <p>{c.name}{c.address ? `, ${c.address}` : ""}{c.state ? `, ${c.state}` : ""}. Email: <a href={`mailto:${c.email}`}>{c.email}</a>{c.phone ? <>, Phone: {c.phone}</> : null}.</p>
      </LegalPage>
    </SiteLayout>
  );
}
