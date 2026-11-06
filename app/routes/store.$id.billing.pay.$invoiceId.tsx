import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData } from "@remix-run/react";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { invoicePayuForm } from "~/lib/subscription-billing.server";
import { storeBilling } from "~/lib/billing.server";

export const meta: MetaFunction = () => [{ title: "Pay invoice · Growpefy" }, { name: "robots", content: "noindex" }];

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const billing = await storeBilling(store.id);
  const payment = await invoicePayuForm(Number(params.invoiceId), { id: store.id, name: store.name }, {
    name: billing.details.name || store.name, email: billing.details.email || "", phone: billing.details.phone,
  });
  return json(payment);
}

export default function PayInvoice() {
  const d = useLoaderData<typeof loader>();
  return <main className="mx-auto max-w-lg p-6"><section className="panel p-6 text-center"><h1 className="text-xl font-semibold">Continue to secure payment</h1><p className="mt-2 text-sm text-ink-soft">You are paying Growpefy invoice balance of ₹{(d.duePaise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })} through PayU.</p><Form method="post" action={d.action} className="mt-5"><input type="hidden" name="key" value={d.fields.key}/>{Object.entries(d.fields).filter(([key]) => key !== "key").map(([key, value]) => <input key={key} type="hidden" name={key} value={value}/>)}<button className="btn-primary" type="submit">Pay with PayU</button></Form></section></main>;
}
