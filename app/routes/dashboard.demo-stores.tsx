// Super admin → Demo stores: one ready-made store per business type, with a simple username login.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { Notice, PageHeader } from "~/components/ui";
import type { BusinessType } from "~/db/schema";
import { requireSuperAdmin } from "~/lib/auth.server";
import { DEMOS, demoPassword, demoStatus, ensureDemo } from "~/lib/demo.server";
import { storePath } from "~/lib/store-code";

export async function loader({ request }: LoaderFunctionArgs) {
  await requireSuperAdmin(request);
  return json({ demos: await demoStatus(), password: demoPassword() });
}

export async function action({ request }: ActionFunctionArgs) {
  await requireSuperAdmin(request);
  const fd = await request.formData();
  const type = String(fd.get("type") ?? "") as BusinessType;
  if (!DEMOS.some((d) => d.type === type)) return json({ error: "Unknown demo.", done: null }, { status: 400 });
  try {
    await ensureDemo(type);
    return json({ error: null, done: DEMOS.find((d) => d.type === type)!.store });
  } catch (e) {
    console.error("[demo]", e);
    return json({ error: e instanceof Error ? e.message : "Couldn't set up the demo.", done: null }, { status: 500 });
  }
}

export default function DemoStores() {
  const { demos, password } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const nav = useNavigation();
  const busy = nav.state !== "idle" ? String(nav.formData?.get("type") ?? "") : "";
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Demo stores" icon="stores" description="A ready-made store for each business type. Log in with the username and password to show or test it. Reset puts back the starting products or menu." />
      {a?.error && <Notice tone="error">{a.error}</Notice>}
      {a?.done && <Notice tone="success">{a.done} is ready.</Notice>}
      <div className="mt-4 space-y-3">
        {demos.map((d) => (
          <div key={d.type} className="panel p-4">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold">{d.store}</p>
                <p className="text-[13px] text-ink-soft">{d.label}</p>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
                  <dt className="text-ink-faint">Username</dt><dd className="font-mono font-semibold">{d.username}</dd>
                  <dt className="text-ink-faint">Password</dt><dd className="font-mono font-semibold">{password}</dd>
                </dl>
                {d.storeId && (
                  <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
                    <a className="btn-secondary px-2.5 py-1" href={storePath(d.storeId)} target="_blank" rel="noreferrer">Open admin</a>
                    {d.slug && <a className="btn-secondary px-2.5 py-1" href={`/s/${d.slug}`} target="_blank" rel="noreferrer">Open website</a>}
                    {d.type === "restaurant" && d.slug && <a className="btn-secondary px-2.5 py-1" href={`/s/${d.slug}?table=T1`} target="_blank" rel="noreferrer">Table T1 (QR)</a>}
                  </div>
                )}
              </div>
              <Form method="post">
                <input type="hidden" name="type" value={d.type} />
                <button className="btn-primary px-3 py-1.5 text-[13px]" disabled={Boolean(busy)}
                  onClick={(e) => { if (d.storeId && !confirm(`Reset ${d.store}? Its products, menu and settings go back to the start. Orders stay.`)) e.preventDefault(); }}>
                  {busy === d.type ? "Working…" : d.storeId ? "Reset" : "Create"}
                </button>
              </Form>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[12.5px] text-ink-faint">Institute and other store types get their demo here as they're built (e.g. username demostudy).</p>
    </div>
  );
}
