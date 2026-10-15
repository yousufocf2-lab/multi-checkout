import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { and, asc, eq } from "drizzle-orm";
import { EmptyState, Notice, RowAction, Section, SelectField, StatusBadge, SubmitButton, TextField } from "~/components/ui";
import { bankOffers, db } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const rows = await db.select().from(bankOffers).where(eq(bankOffers.storeId, store.id)).orderBy(asc(bankOffers.sort), asc(bankOffers.id));
  return json({ offers: rows });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const s = (k: string) => String(fd.get(k) ?? "").trim();
  const int = (k: string) => (s(k) === "" ? null : Math.max(0, Math.round(Number(s(k)) || 0)));
  const own = and(eq(bankOffers.id, Number(s("id"))), eq(bankOffers.storeId, store.id));

  switch (s("intent")) {
    case "add": {
      const errors: Record<string, string> = {};
      if (!s("bankName")) errors.bankName = "Enter the bank";
      if (!s("title")) errors.title = "Enter the text customers see";
      if (!int("value")) errors.value = "Enter the discount";
      if (Object.keys(errors).length) return json({ ok: null, errors }, { status: 400 });
      await db.insert(bankOffers).values({
        storeId: store.id, bankName: s("bankName"), title: s("title"), type: s("type") === "flat" ? "flat" : "percent",
        value: int("value")!, maxDiscountRupees: int("maxDiscountRupees"), minCartRupees: int("minCartRupees") ?? 0,
        payuOfferKey: s("payuOfferKey") || null, sort: int("sort") ?? 0,
      });
      return json({ ok: "Bank offer added", errors: null });
    }
    case "toggle": {
      const [o] = await db.select().from(bankOffers).where(own);
      if (o) await db.update(bankOffers).set({ active: !o.active }).where(own);
      return json({ ok: null, errors: null });
    }
    case "delete":
      await db.delete(bankOffers).where(own);
      return json({ ok: "Bank offer deleted", errors: null });
  }
  return json({ ok: null, errors: null });
}

export default function Offers() {
  const { offers } = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const errors = (res?.errors ?? {}) as Record<string, string>;
  return (
    <div className="max-w-5xl space-y-5">
      {res?.ok && <Notice tone="success">{res.ok}</Notice>}
      <Notice>
        Create the offer in your PayU dashboard under Offers first (that's where the bank and card rules live), then paste its offer key here.
        PayU checks the customer's card and applies the discount. Only mention a bank's name or logo if you have an arrangement with that bank.
      </Notice>
      <Section title="Add bank offer">
        <Form method="post" className="space-y-4" key={offers.length}>
          <div className="grid gap-4 sm:grid-cols-4">
            <TextField label="Bank" name="bankName" placeholder="Kotak" error={errors.bankName} />
            <TextField label="Text shown at checkout" name="title" placeholder="10% instant discount on Kotak credit cards" error={errors.title} wrap="sm:col-span-3" />
            <SelectField label="Type" name="type" defaultValue="percent"><option value="percent">Percentage</option><option value="flat">Fixed amount (₹)</option></SelectField>
            <TextField label="Discount" name="value" type="number" min={1} error={errors.value} />
            <TextField label="Maximum discount (₹)" name="maxDiscountRupees" type="number" min={0} placeholder="No limit" />
            <TextField label="Minimum cart (₹)" name="minCartRupees" type="number" min={0} placeholder="0" />
            <TextField label="PayU offer key" name="payuOfferKey" placeholder="offer@1234" wrap="sm:col-span-3" hint="Without this the offer is shown but not applied" />
            <TextField label="Display order" name="sort" type="number" placeholder="0" />
          </div>
          <SubmitButton intent="add" busyText="Adding">Add bank offer</SubmitButton>
        </Form>
      </Section>
      {offers.length === 0 ? (
        <EmptyState title="No bank offers yet">Bank offers appear at checkout under the online payment option.</EmptyState>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="table min-w-[680px]">
            <thead><tr><th>Bank</th><th>Offer</th><th>PayU key</th><th>Status</th><th /></tr></thead>
            <tbody>
              {offers.map((o) => (
                <tr key={o.id}>
                  <td className="font-medium">{o.bankName}</td>
                  <td>{o.title}<p className="num text-xs text-ink-faint">{o.type === "percent" ? `${o.value}%` : `₹${o.value}`}{o.maxDiscountRupees != null && `, up to ₹${o.maxDiscountRupees}`}{o.minCartRupees > 0 && `, min ₹${o.minCartRupees}`}</p></td>
                  <td className="text-xs">{o.payuOfferKey ?? <span className="text-warn">Missing, won't apply</span>}</td>
                  <td><StatusBadge status={o.active ? "live" : "off"} label={o.active ? "Live" : "Paused"} /></td>
                  <td><div className="flex justify-end"><RowAction intent="toggle" id={o.id} label={o.active ? "Pause" : "Resume"} /><RowAction intent="delete" id={o.id} label="Delete" danger confirm="Delete this offer?" /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
