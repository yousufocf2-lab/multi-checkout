// Growpefy Store → Collections (categories): groups of products shown as pages on the website.
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import { useEffect, useRef, useState } from "react";
import { Icon } from "~/components/Icons";
import { Notice } from "~/components/ui";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { packOf } from "~/lib/business-types";
import { catalogAllowed, createCategory, deleteCategory, listCategories, renameCategory } from "~/lib/catalog.server";
import { storePath } from "~/lib/store-code";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  return json({ store: { id: store.id, slug: store.slug }, pack: packOf(store.businessType), categories: await listCategories(store.id) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const fd = await request.formData();
  try {
    switch (fd.get("intent")) {
      case "add": await createCategory(store.id, String(fd.get("title") ?? "")); return json({ ok: "Collection added.", error: null });
      case "rename": await renameCategory(store.id, Number(fd.get("id")), String(fd.get("title") ?? "")); return json({ ok: "Renamed.", error: null });
      case "delete": await deleteCategory(store.id, Number(fd.get("id"))); return json({ ok: "Collection deleted. Its products are not touched.", error: null });
    }
  } catch (e) {
    return json({ ok: null, error: e instanceof Error ? e.message : "Something went wrong" }, { status: 400 });
  }
  return json({ ok: null, error: null });
}

export default function Collections() {
  const { store, pack, categories } = useLoaderData<typeof loader>();
  const a = useActionData<typeof action>();
  const busy = useNavigation().state !== "idle";
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const addRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (a?.ok) { setAdding(false); setEditing(null); } }, [a]);
  useEffect(() => { if (adding) addRef.current?.focus(); }, [adding]);
  const shown = categories.filter((c) => c.title.toLowerCase().includes(q.trim().toLowerCase()));
  const word = pack.categories;

  return (
    <div className="space-y-4">
      <div className="flex min-h-[32px] items-center gap-2">
        <Icon name="layers" className="h-4 w-4" strokeWidth={1.9} />
        <h1 className="flex-1 text-[15px] font-semibold">{word === "Categories" ? "Collections" : word}</h1>
        <button type="button" className="btn-primary" onClick={() => setAdding(true)}>Add {word === "Categories" ? "collection" : word.replace(/s$/, "").toLowerCase()}</button>
      </div>
      {a?.ok && <Notice tone="success">{a.ok}</Notice>}
      {a?.error && <Notice tone="error">{a.error}</Notice>}

      <section className="panel overflow-hidden">
        <div className="flex items-center gap-2 border-b border-rule px-2 py-1.5">
          <label className="flex h-8 flex-1 items-center gap-2 rounded-lg px-2 text-ink-faint shadow-[inset_0_0_0_1px_rgb(var(--rule))] focus-within:shadow-[inset_0_0_0_2px_#005bd3]">
            <Icon name="search" className="h-4 w-4" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search collections" className="min-w-0 flex-1 border-0 bg-transparent text-[13px] text-ink outline-none" aria-label="Search collections" />
          </label>
        </div>
        {adding && (
          <Form method="post" className="flex items-center gap-2 border-b border-rule bg-paper px-3 py-2">
            <input type="hidden" name="intent" value="add" />
            <input ref={addRef} name="title" required placeholder="e.g. Smart watches, New arrivals, Under ₹999" className="input flex-1" aria-label="Collection name" />
            <button className="btn-primary" disabled={busy}>Save</button>
            <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>Cancel</button>
          </Form>
        )}
        {categories.length === 0 && !adding ? (
          <div className="px-6 py-14 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-paper-sunk"><Icon name="layers" className="h-7 w-7 text-ink-soft" strokeWidth={1.4} /></span>
            <p className="mt-4 font-semibold">Group your {pack.items.toLowerCase()} into collections</p>
            <p className="mt-0.5 text-[12.5px] text-ink-soft">Each collection gets its own page on your website, like /category/smart-watches.</p>
            <button type="button" className="btn-primary mt-4" onClick={() => setAdding(true)}>Add collection</button>
          </div>
        ) : (
          <table className="table">
            <thead><tr><th>Title</th><th className="w-28 text-right">{pack.items}</th><th className="w-40" /></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td>
                    {editing === c.id ? (
                      <Form method="post" className="flex items-center gap-2">
                        <input type="hidden" name="intent" value="rename" /><input type="hidden" name="id" value={c.id} />
                        <input name="title" defaultValue={c.title} autoFocus className="input h-8 flex-1" aria-label="New name" />
                        <button className="btn-primary h-8">Save</button>
                        <button type="button" className="btn-secondary h-8" onClick={() => setEditing(null)}>Cancel</button>
                      </Form>
                    ) : (
                      <span className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-paper-sunk text-[13px] font-semibold text-ink-soft">{c.title.slice(0, 1).toUpperCase()}</span>
                        <span><span className="block font-semibold">{c.title}</span><span className="text-[11.5px] text-ink-faint">/category/{c.handle}</span></span>
                      </span>
                    )}
                  </td>
                  <td className="num text-right">
                    <Link to={`${storePath(store.id)}/catalog?cat=${c.id}`} className="hover:underline">{c.items}</Link>
                  </td>
                  <td className="text-right">
                    {editing !== c.id && (
                      <span className="inline-flex gap-1">
                        <a href={`/s/${store.slug}/category/${c.handle}`} target="_blank" rel="noreferrer" className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label={`View ${c.title}`}><Icon name="eye" className="h-4 w-4" /></a>
                        <button type="button" onClick={() => setEditing(c.id)} className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label={`Rename ${c.title}`}><Icon name="design" className="h-4 w-4" /></button>
                        <Form method="post" onSubmit={(e) => { if (!confirm(`Delete “${c.title}”? Its ${pack.items.toLowerCase()} stay.`)) e.preventDefault(); }}>
                          <input type="hidden" name="intent" value="delete" /><input type="hidden" name="id" value={c.id} />
                          <button className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-soft hover:bg-[#fee9e8] hover:text-[#8e1f0b]" aria-label={`Delete ${c.title}`}><Icon name="trash" className="h-4 w-4" /></button>
                        </Form>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <p className="text-center text-[12.5px] text-ink-soft">Add {pack.items.toLowerCase()} to a collection from the {pack.item} page.</p>
    </div>
  );
}
