// New owners: create a Growpefy Store (own website + checkout) in one step. No Shopify or WordPress needed.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { useState } from "react";
import { Notice, SubmitButton } from "~/components/ui";
import type { BusinessType } from "~/db/schema";
import { requireViewer } from "~/lib/auth.server";
import { BUSINESS_PACKS } from "~/lib/business-types";
import { createOwnStore } from "~/lib/connect.server";
import { eq } from "drizzle-orm";
import { db, users } from "~/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  if (viewer.role !== "owner") throw redirect("/dashboard");
  const brand = viewer.name ?? "";
  const [u] = await db.select({ signup: users.signup }).from(users).where(eq(users.id, viewer.userId)).limit(1);
  const want = u?.signup?.industry ?? "store";
  return json({ brand, want, packs: Object.values(BUSINESS_PACKS).map((p) => ({ id: p.id, name: p.name, examples: p.examples, ready: p.ready })) });
}

export async function action({ request }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  if (viewer.role !== "owner") throw redirect("/dashboard");
  if (viewer.member) return json({ error: "Ask the account owner to create the store." }, { status: 403 });
  const fd = await request.formData();
  const type = String(fd.get("type") ?? "store") as BusinessType;
  if (!BUSINESS_PACKS[type]?.ready) return json({ error: "That type is coming soon. Pick Online store for now." }, { status: 400 });
  try {
    const id = await createOwnStore({ ownerId: viewer.userId, name: String(fd.get("name") ?? ""), businessType: type });
    return redirect(`/dashboard/stores/${id}/catalog?welcome=1`);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Couldn't create the store" }, { status: 400 });
  }
}

export default function CreateStore() {
  const { brand, packs, want } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const wantReady = packs.find((p) => p.id === want)?.ready;
  const [picked, setPicked] = useState<string>(wantReady ? want : "store");
  return (
    <Form method="post" className="mx-auto max-w-3xl space-y-6 py-4">
      <div className="text-center">
        <h1 className="text-[28px] font-semibold tracking-tight">Create your store</h1>
        <p className="mt-1 text-sm text-ink-soft">Your website, checkout, COD and payments in one place. You can change everything later.</p>
      </div>
      {a?.error && <Notice tone="error">{a.error}</Notice>}
      {!wantReady && <Notice>{packs.find((p) => p.id === want)?.name} stores are coming soon. We'll tell you the day they're ready; you can start with an online store now.</Notice>}
      <label className="block text-sm font-medium">Brand name
        <input name="name" required defaultValue={brand} placeholder="Your brand" className="input mt-1.5 w-full text-base" autoFocus />
      </label>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">What do you sell?</legend>
        <input type="hidden" name="type" value={picked} />
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="What do you sell?">
          {packs.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={picked === p.id} disabled={!p.ready} onClick={() => setPicked(p.id)}
              className={`rounded-xl border-2 p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-55 ${picked === p.id ? "border-pine bg-pine-tint/40" : "border-rule hover:border-rule-strong"}`}>
              <span className="flex items-center justify-between gap-2 font-semibold">{p.name}{!p.ready && <span className="rounded-full bg-paper-sunk px-2 py-0.5 text-[11px] font-medium text-ink-soft">Soon</span>}</span>
              <span className="mt-1 block text-xs text-ink-soft">{p.examples}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <SubmitButton className="btn-primary w-full" busyText="Creating your store">Create store</SubmitButton>
    </Form>
  );
}
