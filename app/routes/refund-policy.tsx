import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { LegalPage, SiteLayout, siteMeta } from "~/components/site/SiteLayout";
import { siteData } from "~/lib/site.server";

export const meta: MetaFunction = () => siteMeta("Refund & Cancellation Policy · Growpefy", "Growpefy wallet recharges, cancellations and refunds.", "/refund-policy");
export const loader = async ({ request }: LoaderFunctionArgs) => json(await siteData(request));
const UPDATED = "19 October 2026";

export default function Page() {
  const d = useLoaderData<typeof loader>();
  const c = d.company;
  return (
    <SiteLayout loggedIn={d.loggedIn} company={c}>
      <LegalPage title="Refund & Cancellation Policy" updated={UPDATED}>
        <p>This policy applies to payments made to <strong>{c.name}</strong> for Growpefy services, which are paid through a prepaid wallet.</p>
        <h2>1. Wallet recharges</h2>
        <ul>
          <li>Wallet recharges are prepaid credits for using Growpefy services such as order fees, OTP and WhatsApp messages.</li>
          <li><strong>Wallet balance is non-refundable and non-transferable</strong> and cannot be exchanged for cash or moved to another account.</li>
          <li>GST charged on a recharge is shown on the tax invoice issued for that recharge.</li>
        </ul>
        <h2>2. When we do refund</h2>
        <ul>
          <li><strong>Failed or duplicate payments</strong>: if money was debited but the recharge failed, or you were charged twice for the same recharge, the amount is refunded to the original payment method within 5 to 7 working days of confirmation.</li>
          <li><strong>Charged in error</strong>: if a fee was deducted from your wallet because of a technical error on our side, we will credit it back to your wallet.</li>
          <li><strong>Service closure by us</strong>: if we discontinue the Service, any unused wallet balance will be refunded.</li>
        </ul>
        <h2>3. Cancellation</h2>
        <p>There is no lock-in or monthly plan. You can stop using Growpefy at any time by removing our script from your store theme and writing to us to close your account. Unused wallet balance is not refunded on cancellation, except as stated above. Fees already deducted for orders and messages are final.</p>
        <h2>4. Orders placed by your customers</h2>
        <p>Refunds, returns and cancellations of orders placed by shoppers on your store are handled by you, the merchant, through your Shopify store and payment gateway. Growpefy does not issue refunds to shoppers. Where enabled, the order fee may be reversed to your wallet when an order is fully refunded.</p>
        <h2>5. How to raise a request</h2>
        <p>Email <a href={`mailto:${c.email}`}>{c.email}</a> with your registered email, store name, transaction ID and payment date within 30 days of the payment. We respond within 2 working days.</p>
      </LegalPage>
    </SiteLayout>
  );
}
