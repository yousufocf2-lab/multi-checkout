// Data deletion instructions (required by Facebook Login / Google sign-in reviews).
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { LegalPage, SiteLayout, siteMeta } from "~/components/site/SiteLayout";
import { siteData } from "~/lib/site.server";

export const meta: MetaFunction = () => siteMeta("Delete your data · Growpefy", "How to delete your Growpefy account and the data linked to it.", "/data-deletion");
export const loader = async ({ request }: LoaderFunctionArgs) => json(await siteData(request));

export default function Page() {
  const d = useLoaderData<typeof loader>();
  const c = d.company;
  return (
    <SiteLayout loggedIn={d.loggedIn} company={c}>
      <LegalPage title="Delete your data" updated="6 November 2026">
        <p>You can ask {c.name} ("Growpefy") to delete your account and the personal data linked to it at any time, including data we received when you signed in with Google or Facebook (your name and email address).</p>
        <h2>How to ask</h2>
        <ul>
          <li>Email <a href={`mailto:${c.email}`}>{c.email}</a> with the subject <strong>Delete my account</strong>, or write to us from <Link to="/contact">our contact page</Link>.</li>
          <li>Tell us the email or mobile number of your account. We may ask you to confirm it with a one-time code.</li>
        </ul>
        <h2>What happens next</h2>
        <ul>
          <li>We delete your account, login details and profile within 30 days and confirm by email.</li>
          <li>Records we must keep by law (such as tax invoices and payment records) are kept only for the required period and then deleted.</li>
          <li>If you signed in with Facebook, you can also remove Growpefy from Facebook: Settings &amp; privacy → Settings → Apps and websites → Growpefy → Remove.</li>
        </ul>
      </LegalPage>
    </SiteLayout>
  );
}
