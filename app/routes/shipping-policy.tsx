import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { LegalPage, SiteLayout, siteMeta } from "~/components/site/SiteLayout";
import { siteData } from "~/lib/site.server";

export const meta: MetaFunction = () => siteMeta("Shipping & Delivery Policy · Growpefy", "How Growpefy services are delivered.", "/shipping-policy");
export const loader = async ({ request }: LoaderFunctionArgs) => json(await siteData(request));
const UPDATED = "19 October 2026";

export default function Page() {
  const d = useLoaderData<typeof loader>();
  const c = d.company;
  return (
    <SiteLayout loggedIn={d.loggedIn} company={c}>
      <LegalPage title="Shipping & Delivery Policy" updated={UPDATED}>
        <p>Growpefy is a software service provided online by <strong>{c.name}</strong>. <strong>No physical goods are shipped</strong>.</p>
        <h2>1. Delivery of the service</h2>
        <ul>
          <li>Your Growpefy account and dashboard are available immediately after sign-up at growpefy.com.</li>
          <li>Wallet recharges are credited to your wallet instantly after successful payment, usually within a few seconds and at most within 24 hours if the payment gateway confirms the payment late. Your GST invoice is available in the dashboard as soon as the credit is added.</li>
          <li>The service is delivered across India over the internet. There are no shipping charges.</li>
        </ul>
        <h2>2. Delays</h2>
        <p>If your wallet is not credited within 24 hours of a successful payment, use "Check status" on the wallet page or write to <a href={`mailto:${c.email}`}>{c.email}</a> with your transaction ID and we will resolve it.</p>
        <h2>3. Orders placed by your customers</h2>
        <p>Shipping and delivery of products sold on your store are your responsibility as the merchant and are governed by your own store's shipping policy.</p>
      </LegalPage>
    </SiteLayout>
  );
}
