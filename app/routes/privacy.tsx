import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { LegalPage, SiteLayout, siteMeta } from "~/components/site/SiteLayout";
import { siteData } from "~/lib/site.server";

export const meta: MetaFunction = () => siteMeta("Privacy Policy · Growpefy", "How Growpefy collects, uses and protects merchant and shopper data.", "/privacy");
export const loader = async ({ request }: LoaderFunctionArgs) => json(await siteData(request));
const UPDATED = "19 October 2026";

export default function Page() {
  const d = useLoaderData<typeof loader>();
  const c = d.company;
  return (
    <SiteLayout loggedIn={d.loggedIn} company={c}>
      <LegalPage title="Privacy Policy" updated={UPDATED}>
        <p>This Privacy Policy explains how <strong>{c.name}</strong> ("Growpefy", "we") collects, uses and protects personal data when you visit growpefy.com, use our merchant dashboard, or shop through a checkout powered by Growpefy.</p>
        <h2>1. Who this covers</h2>
        <ul>
          <li><strong>Merchants</strong>: businesses and their team members who create a Growpefy account.</li>
          <li><strong>Shoppers</strong>: customers who place orders on a merchant's checkout. For shopper data, the merchant is the data controller and we process it on the merchant's behalf.</li>
        </ul>
        <h2>2. Data we collect</h2>
        <ul>
          <li><strong>Merchant account data</strong>: name, email, password (stored only as a secure hash), business and billing details such as GSTIN and address, and wallet and invoice records.</li>
          <li><strong>Store connections</strong>: Shopify, payment gateway and Meta ad account credentials you provide, stored to run the Service.</li>
          <li><strong>Shopper order data</strong>: name, phone number, email, delivery address, items ordered, order value, payment method and status. We do not collect or store full card numbers, UPI PINs or bank passwords; payments are handled by the merchant's payment gateway.</li>
          <li><strong>Technical data</strong>: IP address, device and browser information, pages visited, and cookies needed for login sessions and checkout. Merchants may enable advertising pixels (such as Meta Pixel) on their checkout.</li>
        </ul>
        <h2>3. How we use data</h2>
        <ul>
          <li>To provide checkout, create orders in the merchant's Shopify store, apply offers and COD rules, and show analytics.</li>
          <li>To verify phone numbers and send order messages (OTP, WhatsApp) when the merchant enables them.</li>
          <li>To bill merchants, issue GST invoices and maintain the wallet ledger.</li>
          <li>To secure the Service, prevent fraud and abuse, and meet legal obligations.</li>
          <li>To contact merchants about their account and important changes. We do not sell personal data.</li>
        </ul>
        <h2>4. Sharing</h2>
        <p>We share data only as needed to run the Service: with the merchant whose checkout was used; with Shopify, payment gateways, messaging providers and Meta as configured by the merchant; with our hosting and infrastructure providers; and with authorities where required by law.</p>
        <h2>5. Storage and security</h2>
        <p>Data is stored with reputable cloud providers using encryption in transit, hashed passwords, access controls and automatic session timeouts. No system is perfectly secure, but we work to protect your data and will notify affected parties of a breach as required by law.</p>
        <h2>6. Retention</h2>
        <p>We keep account and order data while the account is active and for as long as needed for legal, tax and accounting purposes (generally up to 8 years for invoices). Merchants can ask us to delete store data after closing their account.</p>
        <h2>7. Your rights</h2>
        <p>You can ask to access, correct or delete your personal data, or withdraw consent, as provided under the Digital Personal Data Protection Act, 2023 and other applicable law. Shoppers should first contact the merchant they bought from; we will help merchants respond.</p>
        <h2>8. Cookies</h2>
        <p>We use essential cookies to keep you logged in, remember the selected store and run checkout. Merchants may add analytics or advertising pixels to their checkout, governed by their own privacy policy.</p>
        <h2>9. Changes</h2>
        <p>We may update this policy and will post the new version here with the date it changed.</p>
        <h2>10. Contact and grievance officer</h2>
        <p>For privacy questions or complaints, write to <a href={`mailto:${c.email}`}>{c.email}</a>{c.phone ? <> or call {c.phone}</> : null}. {c.name}{c.address ? `, ${c.address}` : ""}{c.state ? `, ${c.state}` : ""}.</p>
      </LegalPage>
    </SiteLayout>
  );
}
