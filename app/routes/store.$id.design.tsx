import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useActionData, useLoaderData } from "@remix-run/react";
import { eq } from "drizzle-orm";
import { useEffect, useState } from "react";
import { Notice, SubmitButton } from "~/components/ui";
import { db, stores } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import {
  BLOCK_LABELS, DEFAULT_THEME, FONTS, FONT_SCALE, UPSELL_PLACEMENTS, type BlockKey,
  buttonText, resolveTheme, themeFromForm, themeVars, type CheckoutTheme,
} from "~/lib/theme";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const s = await requireStore(await requireViewer(request), params.id);
  return json({ store: { name: s.name, logoUrl: s.logoUrl, primaryColor: s.primaryColor, supportPhone: s.supportPhone, prepaidPct: s.prepaidDiscountPct, codPct: s.codDiscountPct }, theme: resolveTheme(s.theme) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  if (fd.get("intent") === "reset") {
    await db.update(stores).set({ theme: {} }).where(eq(stores.id, store.id));
    return json({ ok: "Design reset to the default look" });
  }
  const color = String(fd.get("primaryColor") ?? "").trim();
  const logo = String(fd.get("logoUrl") ?? "").trim();
  await db.update(stores).set({
    theme: themeFromForm(fd),
    primaryColor: /^#[0-9a-f]{6}$/i.test(color) ? color : store.primaryColor,
    logoUrl: /^https?:\/\/\S+$/.test(logo) ? logo : logo ? store.logoUrl : null,
  }).where(eq(stores.id, store.id));
  return json({ ok: "Checkout design saved. New checkouts use it right away." });
}

const PRESETS: { name: string; brand: string; t: Partial<CheckoutTheme> }[] = [
  { name: "Classic", brand: "#0B5D4B", t: {} },
  { name: "Midnight", brand: "#7C5CFF", t: { bgColor: "#0F1115", surfaceColor: "#181B22", textColor: "#F2F4F8", borderColor: "#2A2F3A", headerBg: "#0F1115", headerText: "#F2F4F8", announcementBg: "#7C5CFF", buttonColor: "#7C5CFF", radius: "round", font: "poppins" } },
  { name: "Warm", brand: "#C2410C", t: { bgColor: "#FBF6EF", surfaceColor: "#FFFFFF", textColor: "#2B1D12", borderColor: "#EADFCF", headerBg: "#FBF6EF", headerText: "#2B1D12", announcementBg: "#2B1D12", font: "dmsans" } },
  { name: "Bold", brand: "#E11D48", t: { bgColor: "#FFFFFF", surfaceColor: "#FFFFFF", textColor: "#111111", borderColor: "#E5E5E5", headerBg: "#111111", headerText: "#FFFFFF", announcementBg: "#E11D48", buttonColor: "#111111", radius: "sharp", font: "inter" } },
  { name: "Ocean", brand: "#0369A1", t: { bgColor: "#EEF6FB", surfaceColor: "#FFFFFF", textColor: "#0B2536", borderColor: "#D5E5EF", headerBg: "#FFFFFF", headerText: "#0B2536", announcementBg: "#0369A1", radius: "round", font: "inter" } },
];

export default function Design() {
  const d = useLoaderData<typeof loader>();
  const res = useActionData<typeof action>();
  const [t, setT] = useState<CheckoutTheme>(d.theme);
  const [brand, setBrand] = useState(d.store.primaryColor);
  const [logo, setLogo] = useState(d.store.logoUrl ?? "");
  useEffect(() => { setT(d.theme); setBrand(d.store.primaryColor); setLogo(d.store.logoUrl ?? ""); }, [d]);
  const set = <K extends keyof CheckoutTheme>(k: K, v: CheckoutTheme[K]) => setT((p) => ({ ...p, [k]: v }));
  const move = (from: number, to: number) => setT((p) => {
    if (to < 0 || to >= p.blocks.length) return p;
    const b: BlockKey[] = [...p.blocks];
    const [x] = b.splice(from, 1);
    b.splice(to, 0, x);
    return { ...p, blocks: b };
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
      <Form method="post" className="min-w-0 space-y-5" id="design-form">
        {res?.ok && <Notice tone="success">{res.ok}</Notice>}

        <Panel title="Quick start" description="Pick a style, then fine-tune anything below.">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const th = { ...DEFAULT_THEME, ...p.t };
              return (
                <button key={p.name} type="button" onClick={() => { setT({ ...t, ...DEFAULT_THEME, ...p.t, announcement: t.announcement, prepaidButtonText: t.prepaidButtonText, codButtonText: t.codButtonText, upsellTitle: t.upsellTitle, trustText: t.trustText, blocks: t.blocks, layout: t.layout, upsellPlacement: t.upsellPlacement, showEmail: t.showEmail }); setBrand(p.brand); }}
                  className="flex items-center gap-2 rounded-lg border border-rule-strong bg-surface px-3 py-2 text-sm hover:border-ink/40">
                  <span className="flex -space-x-1" aria-hidden>
                    {[th.bgColor, th.surfaceColor, th.buttonColor || p.brand, th.textColor].map((c, i) => <span key={i} className="h-4 w-4 rounded-full border border-black/10" style={{ background: c }} />)}
                  </span>
                  {p.name}
                </button>
              );
            })}
          </div>
        </Panel>

        <Panel title="Logo and brand">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="label">Logo URL</span>
              <input name="logoUrl" value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://cdn.shopify.com/…/logo.png" className="input" />
              <span className="hint">Shopify admin → Content → Files → copy link. A transparent PNG or SVG looks best.</span></label>
            <label className="block"><span className="label">Logo size: {t.logoHeight}px</span>
              <input type="range" name="logoHeight" min={20} max={80} step={2} value={t.logoHeight} onChange={(e) => set("logoHeight", Number(e.target.value))} className="w-full accent-[rgb(var(--brand))]" /></label>
            <Choice label="Logo position" name="logoAlign" value={t.logoAlign} onChange={(v) => set("logoAlign", v as CheckoutTheme["logoAlign"])} options={[["left", "Left"], ["center", "Center"]]} />
            <ColorField label="Brand color" hint="Highlights, selected payment, badges" name="primaryColor" value={brand} onChange={setBrand} />
            <div>
              <input type="hidden" name="buttonColor" value={t.buttonColor} />
              <ColorField label="Button color" hint={t.buttonColor ? undefined : "Follows the brand color"} name="buttonColorPick" value={t.buttonColor || brand} onChange={(v) => set("buttonColor", v)} />
              {t.buttonColor && <button type="button" className="mt-1 text-xs text-pine hover:underline" onClick={() => set("buttonColor", "")}>Use brand color</button>}
            </div>
          </div>
        </Panel>

        <Panel title="Colors">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ColorField label="Page background" name="bgColor" value={t.bgColor} onChange={(v) => set("bgColor", v)} />
            <ColorField label="Card background" name="surfaceColor" value={t.surfaceColor} onChange={(v) => set("surfaceColor", v)} />
            <ColorField label="Text" name="textColor" value={t.textColor} onChange={(v) => set("textColor", v)} />
            <ColorField label="Borders" name="borderColor" value={t.borderColor} onChange={(v) => set("borderColor", v)} />
            <ColorField label="Button text" name="buttonTextColor" value={t.buttonTextColor} onChange={(v) => set("buttonTextColor", v)} />
            <ColorField label="Header background" name="headerBg" value={t.headerBg} onChange={(v) => set("headerBg", v)} />
            <ColorField label="Header text" name="headerText" value={t.headerText} onChange={(v) => set("headerText", v)} />
          </div>
        </Panel>

        <Panel title="Text and shape">
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="block"><span className="label">Font</span>
              <select name="font" value={t.font} onChange={(e) => set("font", e.target.value as CheckoutTheme["font"])} className="input">
                {Object.entries(FONTS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
              </select></label>
            <Choice label="Text size" name="fontScale" value={t.fontScale} onChange={(v) => set("fontScale", v as CheckoutTheme["fontScale"])} options={[["sm", "Small"], ["md", "Normal"], ["lg", "Large"]]} />
            <Choice label="Corners" name="radius" value={t.radius} onChange={(v) => set("radius", v as CheckoutTheme["radius"])} options={[["sharp", "Sharp"], ["soft", "Soft"], ["round", "Round"]]} />
          </div>
        </Panel>

        <Panel title="Layout">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Choice label="Checkout pages" name="layout" value={t.layout} onChange={(v) => set("layout", v as CheckoutTheme["layout"])} options={[["single", "1 page"], ["steps", "3 pages"]]} />
              <p className="hint mt-1">{t.layout === "steps"
                ? "Page 1: mobile number. Page 2: address (skipped when the customer has a saved address). Page 3: payment. Order summary, offers and “You may also like” show on every page."
                : "Everything on one page."}</p>
            </div>
            <div className="block">
              <span className="label">Section order</span>
              <input type="hidden" name="blocks" value={t.blocks.join(",")} />
              <input type="hidden" name="sectionOrder" value={t.sectionOrder} />
              <ol className="space-y-1">
                {t.blocks.map((k, i) => (
                  <li key={k} className="flex items-center gap-2 rounded-lg border border-rule bg-surface px-2.5 py-1.5 text-sm">
                    <span className="num w-4 text-xs text-ink-faint">{i + 1}</span><span className="flex-1">{BLOCK_LABELS[k]}</span>
                    <button type="button" className="px-1 text-ink-soft hover:text-ink disabled:opacity-30" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move ${BLOCK_LABELS[k]} up`}>↑</button>
                    <button type="button" className="px-1 text-ink-soft hover:text-ink disabled:opacity-30" disabled={i === t.blocks.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move ${BLOCK_LABELS[k]} down`}>↓</button>
                  </li>
                ))}
              </ol>
              <span className="hint">Or drag the sections in the live preview.</span>
            </div>
            <label className="block"><span className="label">“You may also like” position</span>
              <select name="upsellPlacement" value={t.upsellPlacement} onChange={(e) => set("upsellPlacement", e.target.value as CheckoutTheme["upsellPlacement"])} className="input">
                {UPSELL_PLACEMENTS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select></label>
            <label className="block"><span className="label">Upsell heading</span>
              <input name="upsellTitle" value={t.upsellTitle} maxLength={60} onChange={(e) => set("upsellTitle", e.target.value)} className="input" /></label>
            <div className="space-y-2.5 pt-1">
              <Check name="showEmail" label="Ask for email (optional field)" checked={t.showEmail} onChange={(v) => set("showEmail", v)} />
              <Check name="showSavingsBar" label="Show “You're saving ₹…” bar" checked={t.showSavingsBar} onChange={(v) => set("showSavingsBar", v)} />
              <Check name="showTrust" label="Show trust line under the button" checked={t.showTrust} onChange={(v) => set("showTrust", v)} />
            </div>
          </div>
        </Panel>

        <Panel title="Messages">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2"><span className="label">Announcement bar (optional)</span>
              <input name="announcement" value={t.announcement} maxLength={140} onChange={(e) => set("announcement", e.target.value)} placeholder="Free delivery on all prepaid orders 🚚" className="input" /></label>
            <ColorField label="Announcement background" name="announcementBg" value={t.announcementBg} onChange={(v) => set("announcementBg", v)} />
            <ColorField label="Announcement text" name="announcementText" value={t.announcementText} onChange={(v) => set("announcementText", v)} />
            <label className="block"><span className="label">Online pay button</span>
              <input name="prepaidButtonText" value={t.prepaidButtonText} maxLength={40} onChange={(e) => set("prepaidButtonText", e.target.value)} className="input" /><span className="hint">{"{amount}"} shows the total</span></label>
            <label className="block"><span className="label">COD button</span>
              <input name="codButtonText" value={t.codButtonText} maxLength={40} onChange={(e) => set("codButtonText", e.target.value)} className="input" /></label>
            <label className="block sm:col-span-2"><span className="label">Trust line</span>
              <input name="trustText" value={t.trustText} maxLength={140} onChange={(e) => set("trustText", e.target.value)} className="input" /></label>
          </div>
        </Panel>

        <div className="sticky bottom-16 z-10 -mx-4 flex flex-wrap items-center justify-between gap-2 border-t border-rule bg-paper/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-xl sm:border sm:px-5 lg:bottom-0">
          <SubmitButton intent="reset" className="btn-quiet" busyText="Resetting" formNoValidate onClick={(e) => { if (!window.confirm("Reset the checkout to the default design?")) e.preventDefault(); }}>Reset to default</SubmitButton>
          <SubmitButton intent="save" busyText="Saving">Save design</SubmitButton>
        </div>
      </Form>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <p className="mb-2 text-xs font-medium text-ink-soft">Live preview</p>
        <Preview t={t} brand={brand} logo={logo} name={d.store.name} prepaidPct={d.store.prepaidPct} codPct={d.store.codPct} onMove={move} />
      </div>
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-sm text-ink-soft">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ColorField({ label, hint, name, value, onChange }: { label: string; hint?: string; name: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div>
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-11 shrink-0 cursor-pointer rounded-lg border border-rule-strong bg-surface p-1" aria-label={`Pick ${label}`} />
        <input name={name} value={text} maxLength={7} className="input num py-2 uppercase"
          onChange={(e) => { setText(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value); }} aria-label={label} />
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Choice({ label, name, value, onChange, options }: { label: string; name: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div>
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={value} />
      <div className="flex rounded-lg border border-rule-strong bg-surface p-0.5" role="radiogroup" aria-label={label}>
        {options.map(([v, l]) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
            className={`flex-1 rounded-md px-2 py-1.5 text-sm ${value === v ? "bg-ink font-medium text-white" : "text-ink-soft hover:text-ink"}`}>{l}</button>
        ))}
      </div>
    </div>
  );
}

function Check({ name, label, checked, onChange }: { name: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm">
      <input type="checkbox" name={name} checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--brand))]" />{label}
    </label>
  );
}

/** Phone-sized mock of the checkout using the same theme variables as the real page. Sections can be dragged to reorder. */
function Preview({ t, brand, logo, name, prepaidPct, codPct, onMove }: {
  t: CheckoutTheme; brand: string; logo: string; name: string; prepaidPct: number; codPct: number; onMove: (from: number, to: number) => void;
}) {
  const font = FONTS[t.font];
  const steps = t.layout === "steps";
  const [page, setPage] = useState<1 | 2 | 3>(1);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const price = 1499;
  const online = Math.round(price * (1 - prepaidPct / 100));
  const cod = Math.round(price * (1 - codPct / 100));
  const upsellInCart = t.upsellPlacement === "cart";
  const upsellShown = t.upsellPlacement !== "hidden";
  const upsell = (bare = false) => (
    <div className={bare ? "" : "mt-3 border-t border-rule pt-3"}>
      <p className="mb-2 text-xs font-semibold">{t.upsellTitle}</p>
      <div className="flex gap-2">{[0, 1, 2].map((i) => <div key={i} className="w-20 shrink-0"><div className="aspect-square rounded-lg border border-rule bg-paper" /><p className="mt-1 h-2 w-16 rounded bg-paper-sunk" /><p className="mt-1 text-[10px] font-semibold">₹{299 + i * 100}</p></div>)}</div>
    </div>
  );
  const card = (title: string, body: React.ReactNode) => (
    <section className="rounded-xl border border-rule bg-surface p-3"><p className="mb-2.5 text-[13px] font-semibold">{title}</p>{body}</section>
  );
  const fields = (labels: string[]) => (
    <div className="grid grid-cols-2 gap-2">
      {labels.map((l, i) => <div key={l} className={i === 0 || l.startsWith("Email") || l.startsWith("House") ? "col-span-2" : ""}><p className="mb-1 text-[10px] text-ink-soft">{l}</p><div className="input h-7 py-0" /></div>)}
    </div>
  );
  const email = t.showEmail ? ["Email (optional)"] : [];
  const payment = card("Payment", (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-xl border-2 border-brand bg-brand/[0.05] p-2.5">
        <span className="flex h-4 w-4 items-center justify-center rounded-full border-2 border-brand"><span className="h-2 w-2 rounded-full bg-brand" /></span>
        <span className="flex-1 text-xs font-semibold">Pay online <span className="ml-1 rounded bg-good px-1 py-px text-[9px] text-white">{prepaidPct}% off</span></span>
        <span className="num text-xs font-semibold">₹{online.toLocaleString("en-IN")}</span>
      </div>
      <div className="flex items-center gap-2 rounded-xl border-2 border-rule p-2.5">
        <span className="h-4 w-4 rounded-full border-2 border-rule-strong" />
        <span className="flex-1 text-xs font-semibold">Cash on Delivery</span>
        <span className="num text-xs font-semibold">₹{cod.toLocaleString("en-IN")}</span>
      </div>
    </div>
  ));
  const stepCard = page === 1
    ? card("Mobile number", fields(["Mobile number", ...email]))
    : page === 2
      ? card("Delivery address", fields(["First name", "Last name", "Pincode", "City", "House number, street"]))
      : <div className="space-y-3">{card("Delivering to", <p className="text-[11px] text-ink-soft">Aman · House 5, Connaught Place, Delhi – 110001</p>)}{payment}</div>;
  const blocks: Record<BlockKey, React.ReactNode> = {
    order: card("Your order (1)", (
      <>
        <div className="flex gap-2.5">
          <div className="h-12 w-12 shrink-0 rounded-lg border border-rule bg-paper" />
          <div className="flex-1"><p className="text-xs font-medium">Your best-selling product</p><p className="text-[10px] text-ink-faint">Black / Free size</p></div>
          <p className="num text-xs font-semibold">₹{price.toLocaleString("en-IN")}</p>
        </div>
        {upsellInCart && upsell()}
      </>
    )),
    address: steps ? stepCard : card("Delivery details", fields(["Mobile number", "First name", "Last name", ...email, "Pincode", "City"])),
    offers: card("Offers", <div className="flex gap-2"><div className="input h-8 flex-1 py-0 text-[11px] leading-8 text-ink-faint">Enter coupon code</div><span className="btn-primary h-8 px-3 py-0 text-xs">Apply</span></div>),
    upsell: upsellShown && !upsellInCart ? <section className="rounded-xl border border-rule bg-surface p-3">{upsell(true)}</section> : null,
    payment: steps ? stepCard : payment,
    price: card("Price details", (
      <div className="space-y-1 text-[11px]">
        <div className="flex justify-between"><span className="text-ink-soft">Item total</span><span className="num">₹{price.toLocaleString("en-IN")}</span></div>
        <div className="flex justify-between"><span className="text-ink-soft">Online payment discount</span><span className="num text-good">−₹{(price - online).toLocaleString("en-IN")}</span></div>
        <div className="flex justify-between border-t border-rule pt-1 font-semibold"><span>To pay</span><span className="num">₹{online.toLocaleString("en-IN")}</span></div>
      </div>
    )),
  };
  // In 3 pages, Delivery details + Payment become one "current page" slot (where the first of them is)
  const firstStepSlot = t.blocks.findIndex((k) => k === "address" || k === "payment");
  const scale = FONT_SCALE[t.fontScale] / 16;
  const btn = steps && page < 3 ? "Continue" : buttonText(t.prepaidButtonText, `₹${online.toLocaleString("en-IN")}`);

  return (
    <div>
      {steps && (
        <div className="mx-auto mb-3 flex max-w-[380px] rounded-lg border border-rule-strong bg-surface p-0.5 text-xs" role="tablist" aria-label="Preview page">
          {([[1, "1 · Mobile"], [2, "2 · Address"], [3, "3 · Payment"]] as const).map(([n, l]) => (
            <button key={n} type="button" role="tab" aria-selected={page === n} onClick={() => setPage(n)}
              className={`flex-1 rounded-md px-2 py-1.5 ${page === n ? "bg-ink font-medium text-white" : "text-ink-soft hover:text-ink"}`}>{l}</button>
          ))}
        </div>
      )}
      <div className="mx-auto w-full max-w-[380px] rounded-[2.2rem] border-[10px] border-[#11161a] bg-[#11161a] shadow-lift">
        {font.google && <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${font.google}&display=swap`} />}
        <div className="cx relative h-[680px] overflow-hidden rounded-[1.6rem] bg-paper text-ink" style={themeVars(t, brand) as React.CSSProperties}>
          <div className="h-full overflow-y-auto pb-16" style={{ zoom: scale }}>
            {t.announcement && <div className="px-3 py-1.5 text-center text-[11px] font-medium" style={{ background: t.announcementBg, color: t.announcementText }}>{t.announcement}</div>}
            <header className="border-b border-rule px-3 py-2.5" style={{ background: t.headerBg, color: t.headerText }}>
              <div className={`flex items-center ${t.logoAlign === "center" ? "justify-center" : "justify-between"}`}>
                {logo ? <img src={logo} alt="" style={{ height: t.logoHeight * 0.8 }} className="w-auto max-w-[160px] object-contain" /> : <span className="font-semibold" style={{ fontSize: Math.max(13, t.logoHeight * 0.45) }}>{name}</span>}
                {t.logoAlign === "left" && <span className="text-[10px] opacity-70">🔒 Secure checkout</span>}
              </div>
            </header>
            {t.showSavingsBar && <div className="bg-brand px-3 py-1.5 text-center text-[11px] font-medium text-white">You're saving ₹{(price - online).toLocaleString("en-IN")} on this order</div>}
            <div className="space-y-3 p-3">
              {steps && (
                <div className="flex items-center gap-1.5 text-[10px] font-medium">
                  {["Mobile", "Address", "Payment"].map((l, i) => (
                    <span key={l} className={`flex flex-1 items-center gap-1 ${i + 1 <= page ? "text-ink" : "text-ink-faint"}`}>
                      <span className={`flex h-4 w-4 items-center justify-center rounded-full text-[9px] ${i + 1 < page ? "bg-brand text-white" : i + 1 === page ? "border border-brand text-brand" : "border border-rule-strong"}`}>{i + 1 < page ? "✓" : i + 1}</span>{l}
                    </span>
                  ))}
                </div>
              )}
              {t.blocks.map((k, i) => {
                if (steps && (k === "address" || k === "payment") && i !== firstStepSlot) return null;
                const body = blocks[k];
                if (!body) return null;
                const label = steps && (k === "address" || k === "payment") ? `Current page (${page === 1 ? "mobile" : page === 2 ? "address" : "payment"})` : BLOCK_LABELS[k];
                return (
                  <div key={k} draggable
                    onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = "move"; }}
                    onDragOver={(e) => { e.preventDefault(); if (over !== i) setOver(i); }}
                    onDragLeave={() => setOver((o) => (o === i ? null : o))}
                    onDrop={(e) => { e.preventDefault(); if (drag != null && drag !== i) onMove(drag, i); setDrag(null); setOver(null); }}
                    onDragEnd={() => { setDrag(null); setOver(null); }}
                    className={`group relative cursor-grab rounded-xl transition active:cursor-grabbing ${drag === i ? "opacity-40" : ""} ${over === i && drag !== i ? "ring-2 ring-brand ring-offset-2" : ""}`}>
                    <div className="pointer-events-none absolute -top-2 left-2 z-10 flex items-center gap-1 rounded-md bg-ink px-1.5 py-0.5 text-[9px] font-medium text-white opacity-0 shadow transition group-hover:opacity-100">⠿ {label}</div>
                    <div className="absolute right-1.5 top-1.5 z-10 flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
                      <button type="button" aria-label={`Move ${label} up`} disabled={i === 0} onClick={() => onMove(i, i - 1)} className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-[11px] text-white shadow disabled:opacity-30">↑</button>
                      <button type="button" aria-label={`Move ${label} down`} disabled={i === t.blocks.length - 1} onClick={() => onMove(i, i + 1)} className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-[11px] text-white shadow disabled:opacity-30">↓</button>
                    </div>
                    <div className="pointer-events-none">{body}</div>
                  </div>
                );
              })}
              {t.showTrust && <p className="px-2 text-center text-[10px] text-ink-faint">🔒 {t.trustText}</p>}
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-rule bg-surface px-3 py-2.5">
            <p className="num text-sm font-semibold">₹{online.toLocaleString("en-IN")}</p>
            <button type="button" className="btn-primary flex-1 py-2 text-xs" onClick={() => steps && setPage((p) => (p < 3 ? ((p + 1) as 2 | 3) : 1))}>{btn}</button>
          </div>
        </div>
      </div>
      <p className="mx-auto mt-3 max-w-[380px] text-center text-xs text-ink-faint">Drag any section to move it, or hover and use ↑ ↓. On computers, “Your order” and “Price details” stay on the right side.</p>
    </div>
  );
}
