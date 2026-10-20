import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useActionData, useLoaderData, useNavigation, useSearchParams } from "@remix-run/react";
import { and, count, desc, eq, ilike } from "drizzle-orm";
import { useEffect, useState } from "react";
import { BusyOverlay } from "~/components/Brand";
import { Icon } from "~/components/Icons";
import { Notice, SubmitButton } from "~/components/ui";
import { blockedCustomers, db, stores } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { BLOCK_KINDS, BLOCK_LABELS, CALL_UNLOCK_ORDERS, CSV_SOURCES, CSV_SOURCE_LABELS, extractFromCsv, normValue, showValue, type BlockKind, type CsvSource } from "~/lib/blocklist";
import { MAX_COOLDOWN_HOURS } from "~/lib/cod.server";
import { hasCourier } from "~/lib/logistics.server";
import { resolveShield } from "~/lib/rto-shield";
import { addBlocks, completedOrders, messaging, otpReady, waReady } from "~/lib/rto.server";
import { rupees } from "~/lib/wallet";
import { getWallet, ratesFor } from "~/lib/wallet.server";

const PAGE = 50;
const MAX_CSV_BYTES = 8 * 1024 * 1024;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  const url = new URL(request.url);
  const kind = BLOCK_KINDS.includes(url.searchParams.get("kind") as BlockKind) ? (url.searchParams.get("kind") as BlockKind) : null;
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase().slice(0, 80);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const where = and(eq(blockedCustomers.storeId, store.id), kind ? eq(blockedCustomers.kind, kind) : undefined, q ? ilike(blockedCustomers.value, `%${q.replace(/[%_]/g, "")}%`) : undefined);
  const [list, [{ total }], byKind, orderCount, m, w, courier] = await Promise.all([
    db.select().from(blockedCustomers).where(where).orderBy(desc(blockedCustomers.createdAt)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ total: count() }).from(blockedCustomers).where(where),
    db.select({ kind: blockedCustomers.kind, n: count() }).from(blockedCustomers).where(eq(blockedCustomers.storeId, store.id)).groupBy(blockedCustomers.kind),
    completedOrders(store.id),
    messaging(),
    getWallet(store.id),
    hasCourier(store.id),
  ]);
  const rates = await ratesFor(w);
  const h = store.codCooldownHours;
  const cooldown = h % 730 === 0 ? { value: h / 730, unit: "months" } : h % 24 === 0 ? { value: h / 24, unit: "days" } : { value: h, unit: "hours" };
  return json({
    storeId: store.id, isAdmin: viewer.role === "admin", codEnabled: store.codEnabled,
    shield: { unlocked: courier, on: courier && resolveShield(store.rtoShield).enabled },
    cod: { cooldownOn: store.codCooldownEnabled, cooldown, blockAfterPrepaid: store.codBlockAfterPrepaid },
    otp: { on: store.otpEnabled, prepaid: store.otpPrepaid, cod: store.otpCod, ready: otpReady(m), price: rates.otp },
    block: { on: store.blockEnabled, codOnly: store.blockCodOnly },
    confirm: { on: store.confirmEnabled, whatsapp: store.confirmWhatsapp, prepaid: store.confirmWaPrepaid, cod: store.confirmWaCod, ready: waReady(m), price: rates.waConfirm, orders: orderCount },
    list: list.map((r) => ({ id: r.id, kind: r.kind as BlockKind, value: r.value, label: showValue(r.kind as BlockKind, r.value), source: r.source, at: r.createdAt.toISOString() })),
    total: Number(total), page, kind, q,
    counts: Object.fromEntries(byKind.map((r) => [r.kind, Number(r.n)])) as Partial<Record<BlockKind, number>>,
  });
}

type ActionResult = { ok: string | null; error: string | null; form?: string };

export async function action({ request, params }: ActionFunctionArgs) {
  const store = await requireStore(await requireViewer(request), params.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "");
  const on = (k: string) => fd.get(k) === "on";
  const res = (ok: string | null, error: string | null = null, form = intent) => json<ActionResult>({ ok, error, form }, { status: error ? 400 : 200 });

  if (intent === "cod") {
    const value = Math.max(0, Number(fd.get("cooldownValue")) || 0);
    const unit = String(fd.get("cooldownUnit"));
    const hours = Math.round(value * (unit === "months" ? 730 : unit === "days" ? 24 : 1));
    const cooldownOn = on("cooldownOn");
    if (cooldownOn && (hours < 1 || hours > MAX_COOLDOWN_HOURS)) return res(null, "Choose a wait time between 1 hour and 12 months");
    await db.update(stores).set({ codCooldownEnabled: cooldownOn, codCooldownHours: cooldownOn ? hours : store.codCooldownHours, codBlockAfterPrepaid: on("blockAfterPrepaid") }).where(eq(stores.id, store.id));
    return res("COD rules saved");
  }
  if (intent === "otp") {
    const enabled = on("otpOn");
    const prepaid = on("otpPrepaid"), cod = on("otpCod");
    if (enabled && !prepaid && !cod) return res(null, "Tick Prepaid, COD or both");
    await db.update(stores).set({ otpEnabled: enabled, otpPrepaid: prepaid, otpCod: cod }).where(eq(stores.id, store.id));
    return res(enabled ? "OTP verification is on" : "OTP verification is off");
  }
  if (intent === "blockSettings") {
    await db.update(stores).set({ blockEnabled: on("blockOn"), blockCodOnly: on("codOnly") }).where(eq(stores.id, store.id));
    return res("Block settings saved");
  }
  if (intent === "blockAdd") {
    const kind = String(fd.get("kind")) as BlockKind;
    if (!BLOCK_KINDS.includes(kind)) return res(null, "Choose what to block");
    const raw = String(fd.get("values") ?? "");
    const items = raw.split(/[\n,;]+/).map((v) => normValue(kind, v)).filter((v): v is string => Boolean(v));
    if (!items.length) return res(null, `Enter a valid ${BLOCK_LABELS[kind].toLowerCase()}`);
    const added = await addBlocks(store.id, [...new Set(items)].map((value) => ({ kind, value })), "manual");
    return res(added ? `Blocked ${added} ${BLOCK_LABELS[kind].toLowerCase()}${added > 1 ? "s" : ""}` : "Already on the block list");
  }
  if (intent === "blockCsv") {
    const source = String(fd.get("source")) as CsvSource;
    if (!CSV_SOURCES.includes(source)) return res(null, "Choose where the file was exported from");
    const kinds = fd.getAll("kinds").map(String).filter((k): k is BlockKind => BLOCK_KINDS.includes(k as BlockKind));
    if (!kinds.length) return res(null, "Choose at least one thing to block (number, pincode…)");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return res(null, "Choose a CSV file");
    if (file.size > MAX_CSV_BYTES) return res(null, "File is too large. Split it into files under 8 MB.");
    const { values, rows } = extractFromCsv(await file.text(), source, kinds);
    const entries = kinds.flatMap((k) => [...values[k]].map((value) => ({ kind: k, value })));
    if (!entries.length) return res(null, `No ${kinds.map((k) => BLOCK_LABELS[k].toLowerCase()).join(", ")} found in ${rows} rows. Check the file type and columns (see the sample).`);
    const added = await addBlocks(store.id, entries, "csv");
    const found = kinds.map((k) => `${values[k].size} ${BLOCK_LABELS[k].toLowerCase()}`).join(", ");
    return res(`Read ${rows} rows and found ${found}. ${added} new entr${added === 1 ? "y" : "ies"} added to the block list${entries.length - added ? `, ${entries.length - added} were already blocked` : ""}.`);
  }
  if (intent === "blockDelete") {
    await db.delete(blockedCustomers).where(and(eq(blockedCustomers.storeId, store.id), eq(blockedCustomers.id, Number(fd.get("id")))));
    return res("Removed from the block list");
  }
  if (intent === "blockClear") {
    const kind = String(fd.get("kind") ?? "");
    if (String(fd.get("confirm") ?? "").trim().toUpperCase() !== "REMOVE") return res(null, "Type REMOVE to confirm");
    await db.delete(blockedCustomers).where(and(eq(blockedCustomers.storeId, store.id), BLOCK_KINDS.includes(kind as BlockKind) ? eq(blockedCustomers.kind, kind) : undefined));
    return res("Block list cleared");
  }
  if (intent === "confirm") {
    const enabled = on("confirmOn");
    const wa = on("waOn"), prepaid = on("waPrepaid"), cod = on("waCod");
    if (enabled && !wa) return res(null, "Choose WhatsApp confirmation");
    if (enabled && wa && !prepaid && !cod) return res(null, "Tick Prepaid, COD or both");
    await db.update(stores).set({ confirmEnabled: enabled, confirmWhatsapp: wa, confirmWaPrepaid: prepaid, confirmWaCod: cod }).where(eq(stores.id, store.id));
    return res(enabled ? "Order confirmation is on" : "Order confirmation is off");
  }
  return res(null, "Unknown action");
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;
type Msg = (form: string) => React.ReactNode;

export default function RtoSuite() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  const nav = useNavigation();
  const uploading = nav.state === "submitting" && nav.formData?.get("intent") === "blockCsv";
  const msg: Msg = (form) => (r?.form === form ? (r.ok ? <Notice tone="success">{r.ok}</Notice> : r.error ? <Notice tone="error">{r.error}</Notice> : null) : null);
  const blocked = Object.values(d.counts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <div className="space-y-5">
      {uploading && <BusyOverlay title="Reading your file" note="Adding customers to the block list." />}
      <Hero d={d} blocked={blocked} />
      {!d.codEnabled && <Notice tone="warning">Cash on Delivery is off for this store, so COD rules don't apply right now. Turn it on in <Link className="underline" to={`/dashboard/stores/${d.storeId}/settings`}>Store settings</Link>.</Notice>}
      <CodForm d={d} msg={msg} />
      <OtpForm d={d} msg={msg} />
      <BlockCard d={d} msg={msg} blocked={blocked} />
      <ConfirmForm d={d} msg={msg} />
    </div>
  );
}

function Hero({ d, blocked }: { d: D; blocked: number }) {
  const chips: { href: string; emoji: string; label: string; value: string; on: boolean }[] = [
    { href: "#cod", emoji: "⏳", label: "COD wait", value: d.cod.cooldownOn ? `${d.cod.cooldown.value} ${d.cod.cooldown.unit}` : "Off", on: d.cod.cooldownOn },
    { href: "#otp", emoji: "🔐", label: "OTP", value: d.otp.on ? [d.otp.prepaid && "Prepaid", d.otp.cod && "COD"].filter(Boolean).join(" + ") : "Off", on: d.otp.on },
    { href: "#block", emoji: "🚫", label: "Block list", value: d.block.on ? `${blocked} entr${blocked === 1 ? "y" : "ies"}` : "Off", on: d.block.on },
    { href: "#confirm", emoji: "💬", label: "Confirmation", value: d.confirm.on ? "WhatsApp" : "Off", on: d.confirm.on },
  ];
  return (
    <section className="panel relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-pine px-5 py-6 text-white sm:px-7">
      <div aria-hidden className="pointer-events-none absolute -left-10 -bottom-20 h-56 w-56 rounded-full bg-emerald-400/20 blur-3xl" />
      <div className="relative">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-emerald-200"><Icon name="shield" className="h-3 w-3" />RTO Suite</p>
        <h2 className="mt-3 text-lg font-semibold sm:text-xl">Fewer fake orders. Fewer doors that don't open.</h2>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-white/70 sm:text-[13px]">Four simple guards that run at checkout. Turn on only what you need.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {chips.map((c) => (
            <a key={c.href} href={c.href} className="group rounded-xl bg-white/10 px-3 py-2.5 transition hover:bg-white/15">
              <p className="flex items-center justify-between text-[11px] text-white/60">{c.label}<span className={`h-1.5 w-1.5 rounded-full ${c.on ? "bg-emerald-400" : "bg-white/25"}`} /></p>
              <p className="mt-0.5 truncate text-sm font-semibold"><span className="mr-1" aria-hidden>{c.emoji}</span>{c.value}</p>
            </a>
          ))}
          <Link to={`/dashboard/stores/${d.storeId}/${d.shield.unlocked ? "rto-shield" : "logistics"}`} className="col-span-2 rounded-xl bg-gradient-to-r from-emerald-400/30 to-sky-400/20 px-3 py-2.5 ring-1 ring-emerald-300/30 transition hover:from-emerald-400/40 sm:col-span-4 lg:col-span-1">
            <p className="flex items-center justify-between text-[11px] text-emerald-100">RTO Shield<span className={`h-1.5 w-1.5 rounded-full ${d.shield.on ? "bg-emerald-400" : "bg-white/25"}`} /></p>
            <p className="mt-0.5 truncate text-sm font-semibold">🛡️ {d.shield.unlocked ? (d.shield.on ? "On" : "Set up →") : "Connect courier →"}</p>
          </Link>
        </div>
      </div>
    </section>
  );
}

function Switch({ name, on, setOn, label }: { name: string; on: boolean; setOn: (v: boolean) => void; label: string }) {
  return (
    <label className="relative inline-flex shrink-0 cursor-pointer items-center" aria-label={label}>
      <input type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={`h-6 w-10 rounded-full transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand ${on ? "bg-brand" : "bg-rule-strong"}`} />
      <span aria-hidden className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </label>
  );
}

/** Feature header: emoji tile, title, short text, price tag, on/off switch. */
function Head({ emoji, title, text, on, setOn, name, price }: { emoji: string; title: string; text: string; on: boolean; setOn: (v: boolean) => void; name: string; price?: string }) {
  return (
    <div className="flex items-center gap-4">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl transition ${on ? "bg-pine-tint" : "bg-paper-sunk grayscale"}`} aria-hidden>{emoji}</span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {title}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${on ? "bg-emerald-50 text-good" : "bg-paper-sunk text-ink-faint"}`}>{on ? "On" : "Off"}</span>
          {price && <span className="rounded-full bg-pine-tint px-2 py-0.5 text-[10px] font-semibold text-pine">{price} · from wallet</span>}
        </p>
        <p className="text-xs text-ink-soft">{text}</p>
      </div>
      <Switch name={name} on={on} setOn={setOn} label={title} />
    </div>
  );
}

/** Option row with a small switch (like RTO Shield rows). */
function Row({ name, title, text, checked, onChange, disabled, extra }: { name: string; title: React.ReactNode; text?: React.ReactNode; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; extra?: React.ReactNode }) {
  return (
    <label className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition ${disabled ? "cursor-not-allowed border-dashed border-rule-strong opacity-70" : "cursor-pointer"} ${checked && !disabled ? "border-brand/40 bg-pine-tint/40" : "border-rule"}`}>
      <input type="checkbox" name={name} checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 ${checked ? "border-brand bg-brand text-white" : "border-rule-strong bg-white"}`}>
        {checked && <Icon name="check" className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span>{text && <span className="block text-xs text-ink-faint">{text}</span>}</span>
      {extra}
    </label>
  );
}

function Save({ intent, label, msg }: { intent: string; label: string; msg: Msg }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 border-t border-rule pt-4">
      <div className="mr-auto min-w-0 text-sm">{msg(intent)}</div>
      <SubmitButton intent={intent} className="btn-primary h-9 px-4 text-sm" busyText="Saving">{label}</SubmitButton>
    </div>
  );
}

function CodForm({ d, msg }: { d: D; msg: Msg }) {
  const [on, setOn] = useState(d.cod.cooldownOn);
  const [after, setAfter] = useState(d.cod.blockAfterPrepaid);
  const active = on || after;
  return (
    <Form method="post" id="cod" className="panel scroll-mt-6 space-y-4 p-5">
      <Head emoji="⏳" title="COD rules" text="Stop the same customer from piling up Cash on Delivery orders." on={active} setOn={(v) => { setOn(v); if (!v) setAfter(false); }} name="_codMaster" />
      <div className={`space-y-2 transition ${active ? "" : "opacity-60"}`}>
        <div className={`rounded-xl border px-4 py-3 transition ${on ? "border-brand/40 bg-pine-tint/40" : "border-rule"}`}>
          <div className="flex flex-wrap items-center gap-3">
            <Switch name="cooldownOn" on={on} setOn={setOn} label="Wait time between COD orders" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Wait time between COD orders</p>
              <p className="text-xs text-ink-faint">Same number can't place another COD order for this long. Online payment stays open.</p>
            </div>
            <div className={`flex gap-1.5 ${on ? "" : "pointer-events-none opacity-50"}`}>
              <input type="number" name="cooldownValue" min={1} defaultValue={d.cod.cooldown.value} className="input h-9 w-16 py-1 text-center text-sm" aria-label="Wait time" />
              <select name="cooldownUnit" defaultValue={d.cod.cooldown.unit} className="input h-9 w-28 py-1 text-sm" aria-label="Unit">
                <option value="hours">hours</option><option value="days">days</option><option value="months">months</option>
              </select>
            </div>
          </div>
        </div>
        <Row name="blockAfterPrepaid" checked={after} onChange={setAfter} title="Online-only after a prepaid order" text="Once a number completes a prepaid order, COD is hidden for it." />
      </div>
      <Save intent="cod" label="Save COD rules" msg={msg} />
    </Form>
  );
}

function OtpForm({ d, msg }: { d: D; msg: Msg }) {
  const [on, setOn] = useState(d.otp.on);
  const [prepaid, setPrepaid] = useState(d.otp.prepaid);
  const [cod, setCod] = useState(d.otp.cod);
  return (
    <Form method="post" id="otp" className="panel scroll-mt-6 space-y-4 p-5">
      <Head emoji="🔐" title="OTP verification" text="Customers confirm their mobile number with a code. Cuts fake numbers and prank orders." on={on} setOn={setOn} name="otpOn" price={`${rupees(d.otp.price)} per OTP`} />
      {!d.otp.ready && <Notice tone="warning">{d.isAdmin ? <>OTP sending isn't set up yet. Add the MSG91 key in <Link to="/dashboard/wallets" className="underline">All wallets → Settings → Messaging</Link>.</> : "OTP sending is being set up by Growpefy. Your settings are saved and OTP starts automatically once it's live."}</Notice>}
      <div className={`grid gap-2 sm:grid-cols-2 transition ${on ? "" : "pointer-events-none opacity-60"}`}>
        <Row name="otpPrepaid" checked={prepaid} onChange={setPrepaid} title="💳 Prepaid" text="Before the payment page" />
        <Row name="otpCod" checked={cod} onChange={setCod} title="💵 COD" text="Before the COD order is placed" />
      </div>
      <p className="text-[11px] text-ink-faint">A verified number can order for 30 minutes without a new OTP.</p>
      <Save intent="otp" label="Save OTP settings" msg={msg} />
    </Form>
  );
}

function BlockCard({ d, msg, blocked }: { d: D; msg: Msg; blocked: number }) {
  const [on, setOn] = useState(d.block.on);
  const [codOnly, setCodOnly] = useState(d.block.codOnly);
  const r = useActionData<typeof action>();
  return (
    <section id="block" className="panel scroll-mt-6">
      <Form method="post" className="space-y-4 p-5">
        <Head emoji="🚫" title="Block customers" text="Stop customers with a bad history by mobile, email, pincode, city, state or country." on={on} setOn={setOn} name="blockOn" />
        <div className={`transition ${on ? "" : "pointer-events-none opacity-60"}`}>
          <div className="inline-flex rounded-lg border border-rule-strong p-0.5 text-xs font-medium" role="radiogroup" aria-label="What to block">
            {codOnly && <input type="hidden" name="codOnly" value="on" />}
            {([[true, "Hide COD only"], [false, "Block all orders"]] as const).map(([v, l]) => (
              <button key={l} type="button" role="radio" aria-checked={codOnly === v} onClick={() => setCodOnly(v)}
                className={`rounded-md px-3 py-1.5 transition ${codOnly === v ? (v ? "bg-ink text-white" : "bg-red-600 text-white") : "text-ink-soft hover:text-ink"}`}>{l}</button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">{codOnly ? "Blocked customers can still pay online." : "Blocked customers can't place any order, prepaid or COD."}</p>
        </div>
        <Save intent="blockSettings" label="Save block settings" msg={msg} />
      </Form>

      <div className="grid gap-4 border-t border-rule bg-paper/40 p-5 lg:grid-cols-2">
        <div className="rounded-2xl border border-rule bg-white p-4">
          <p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden>✍️</span>Add manually</p>
          <Form method="post" className="mt-3 space-y-2.5" key={r?.form === "blockAdd" && r.ok ? r.ok + Date.now() : "add"}>
            <select name="kind" className="input h-9 py-1 text-sm" defaultValue="phone" aria-label="What to block">
              {BLOCK_KINDS.map((k) => <option key={k} value={k}>{BLOCK_LABELS[k]}</option>)}
            </select>
            <textarea name="values" rows={3} className="input text-sm" placeholder="One per line, or separated by commas. E.g. 9876543210" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-sm">{msg("blockAdd")}</div>
              <SubmitButton intent="blockAdd" className="btn-primary h-9 px-4 text-sm" busyText="Adding">Add to block list</SubmitButton>
            </div>
          </Form>
        </div>
        <CsvUpload msg={msg} />
      </div>
      <BlockList d={d} msg={msg} totalAll={blocked} />
    </section>
  );
}

const SAMPLE: Record<CsvSource, string> = { shopify: "/samples/block-list-shopify.csv", woocommerce: "/samples/block-list-woocommerce.csv", other: "/samples/block-list-other.csv" };
const SOURCE_HINT: Record<CsvSource, string> = {
  shopify: "Shopify admin → Orders → Export → CSV for Excel. We read email, shipping phone, pincode, city, state and country.",
  woocommerce: "WooCommerce → Orders → Export (CSV). We read billing email & phone and shipping pincode, city, state, country.",
  other: "Columns: A email, B phone, C pincode, D city, E state, F country. 10-digit phones use your store's country.",
};

function CsvUpload({ msg }: { msg: Msg }) {
  const [source, setSource] = useState<CsvSource>("shopify");
  const [kinds, setKinds] = useState<BlockKind[]>(["phone"]);
  const toggle = (k: BlockKind) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  return (
    <div className="rounded-2xl border border-rule bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-semibold"><span aria-hidden>📄</span>Upload a CSV</p>
        <a href={SAMPLE[source]} download className="inline-flex items-center gap-1 text-[11px] font-medium text-pine hover:underline"><Icon name="download" className="h-3.5 w-3.5" />Sample file</a>
      </div>
      <Form method="post" encType="multipart/form-data" className="mt-3 space-y-2.5">
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Exported from">
          <input type="hidden" name="source" value={source} />
          {CSV_SOURCES.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={source === s} onClick={() => setSource(s)}
              className={`rounded-full border px-3 py-1 text-xs transition ${source === s ? "border-ink bg-ink font-medium text-white" : "border-rule-strong text-ink-soft hover:border-ink-faint"}`}>{CSV_SOURCE_LABELS[s]}</button>
          ))}
        </div>
        <p className="text-[11px] text-ink-faint">{SOURCE_HINT[source]}</p>
        <fieldset>
          <legend className="mb-1 text-xs font-medium">Block from this file</legend>
          <div className="flex flex-wrap gap-1.5">
            {BLOCK_KINDS.map((k) => {
              const on = kinds.includes(k);
              return (
                <label key={k} className={`cursor-pointer rounded-full border px-2.5 py-1 text-xs transition ${on ? "border-brand bg-pine-tint font-medium text-pine" : "border-rule-strong text-ink-soft hover:border-ink-faint"}`}>
                  <input type="checkbox" name="kinds" value={k} checked={on} onChange={() => toggle(k)} className="sr-only" />{on ? "✓ " : ""}{BLOCK_LABELS[k]}
                </label>
              );
            })}
          </div>
          {kinds.some((k) => k === "country" || k === "state") && <p className="mt-1.5 text-[11px] text-warn">Careful: blocking a state or country affects every customer from there.</p>}
        </fieldset>
        <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-xs file:mr-3 file:rounded-lg file:border-0 file:bg-paper-sunk file:px-3 file:py-1.5 file:text-xs file:font-medium" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 text-sm">{msg("blockCsv")}</div>
          <SubmitButton intent="blockCsv" className="btn-primary h-9 px-4 text-sm" busyText="Uploading" disabled={!kinds.length}>Upload and block</SubmitButton>
        </div>
      </Form>
    </div>
  );
}

function BlockList({ d, msg, totalAll }: { d: D; msg: Msg; totalAll: number }) {
  const [params] = useSearchParams();
  const href = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) sp.set(k, v); else sp.delete(k); }
    if (!("page" in patch)) sp.delete("page");
    return `?${sp.toString()}#block`;
  };
  const [clear, setClear] = useState(false);
  useEffect(() => setClear(false), [d.total]);
  const pages = Math.max(1, Math.ceil(d.total / PAGE));
  const note = msg("blockDelete") ?? msg("blockClear");
  return (
    <div className="border-t border-rule p-5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-semibold">Block list <span className="font-normal text-ink-faint">({totalAll})</span></p>
        <Form method="get" className="flex gap-2" preventScrollReset>
          {d.kind && <input type="hidden" name="kind" value={d.kind} />}
          <input name="q" defaultValue={d.q} placeholder="Search" className="input h-8 w-40 py-1 text-xs" aria-label="Search block list" />
        </Form>
        {totalAll > 0 && <button type="button" className="btn-quiet h-8 px-2 text-xs text-bad" onClick={() => setClear((v) => !v)}>Clear list</button>}
      </div>
      {note && <div className="mt-3 text-sm">{note}</div>}
      {clear && (
        <Form method="post" className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs">
          <span>Remove {d.kind ? `all blocked ${BLOCK_LABELS[d.kind].toLowerCase()}s` : "everything"} from the list? Type <b>REMOVE</b>:</span>
          <input type="hidden" name="kind" value={d.kind ?? ""} />
          <input name="confirm" className="input h-8 w-28 py-1 text-xs" />
          <SubmitButton intent="blockClear" className="btn-danger h-8 border border-red-200 bg-white px-3 text-xs" busyText="Removing">Remove</SubmitButton>
        </Form>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Link to={href({ kind: null })} preventScrollReset className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${!d.kind ? "bg-ink text-white" : "bg-paper-sunk text-ink-soft"}`}>All {totalAll}</Link>
        {BLOCK_KINDS.map((k) => (
          <Link key={k} to={href({ kind: k })} preventScrollReset className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${d.kind === k ? "bg-ink text-white" : "bg-paper-sunk text-ink-soft"}`}>{BLOCK_LABELS[k]} {d.counts[k] ?? 0}</Link>
        ))}
      </div>
      {d.list.length === 0 ? (
        <p className="mt-4 rounded-xl bg-paper px-4 py-6 text-center text-xs text-ink-faint">{d.q || d.kind ? "Nothing matches." : "No one is blocked yet."}</p>
      ) : (
        <ul className="mt-3 divide-y divide-rule overflow-hidden rounded-xl border border-rule">
          {d.list.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="w-20 shrink-0 rounded-md bg-paper-sunk px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{BLOCK_LABELS[b.kind]}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{b.label}</span>
              <span className="hidden text-[11px] text-ink-faint sm:block">{new Date(b.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} · {b.source === "csv" ? "CSV" : "Manual"}</span>
              <Form method="post" preventScrollReset><input type="hidden" name="id" value={b.id} />
                <button name="intent" value="blockDelete" className="btn-quiet h-7 px-2 text-[11px]" aria-label={`Unblock ${b.label}`}>Unblock</button>
              </Form>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-ink-faint">Page {d.page} of {pages}</span>
          <div className="flex gap-2">
            {d.page > 1 && <Link to={href({ page: String(d.page - 1) })} preventScrollReset className="btn-secondary h-8 px-3 text-xs">Previous</Link>}
            {d.page < pages && <Link to={href({ page: String(d.page + 1) })} preventScrollReset className="btn-secondary h-8 px-3 text-xs">Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmForm({ d, msg }: { d: D; msg: Msg }) {
  const [on, setOn] = useState(d.confirm.on);
  const [wa, setWa] = useState(d.confirm.whatsapp);
  const [prepaid, setPrepaid] = useState(d.confirm.prepaid);
  const [cod, setCod] = useState(d.confirm.cod);
  const unlocked = d.confirm.orders >= CALL_UNLOCK_ORDERS;
  return (
    <Form method="post" id="confirm" className="panel scroll-mt-6 space-y-4 p-5">
      <Head emoji="💬" title="Order confirmation" text="Confirm every order with the customer right after checkout, so fewer orders get refused at the door." on={on} setOn={setOn} name="confirmOn" />
      {!d.confirm.ready && <Notice tone="warning">{d.isAdmin ? <>WhatsApp sending isn't set up yet. Add the WhatsApp Cloud API details in <Link to="/dashboard/wallets" className="underline">All wallets → Settings → Messaging</Link>.</> : "WhatsApp messages are being set up by Growpefy. Your settings are saved and messages start automatically once it's live."}</Notice>}
      <div className={`space-y-2 transition ${on ? "" : "pointer-events-none opacity-60"}`}>
        <Row name="waOn" checked={wa} onChange={setWa} title="WhatsApp confirmation" text="Order details on WhatsApp right after the order is placed."
          extra={<span className="rounded-full bg-pine-tint px-2 py-0.5 text-[10px] font-semibold text-pine">{rupees(d.confirm.price)}/msg</span>} />
        <div className={`ml-8 flex flex-wrap gap-2 ${wa ? "" : "hidden"}`}>
          {([["waPrepaid", "💳 Prepaid orders", prepaid, setPrepaid], ["waCod", "💵 COD orders", cod, setCod]] as const).map(([n, l, v, set]) => (
            <label key={n} className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition ${v ? "border-brand bg-pine-tint font-medium text-pine" : "border-rule-strong text-ink-soft"}`}>
              <input type="checkbox" name={n} checked={v} onChange={(e) => set(e.target.checked)} className="sr-only" />{v ? "✓ " : ""}{l}
            </label>
          ))}
        </div>
        <div className="rounded-xl border border-dashed border-rule-strong px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-5 w-5 items-center justify-center text-sm" aria-hidden>📞</span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">Call confirmation<span className="rounded-full bg-paper-sunk px-2 py-0.5 text-[10px] font-semibold text-ink-soft">🔒 {unlocked ? "Coming soon" : `Unlocks at ${CALL_UNLOCK_ORDERS} orders`}</span></p>
              <p className="text-xs text-ink-faint">{unlocked ? "You've crossed 100 orders. Call confirmation will appear here soon." : `Your store has ${d.confirm.orders} of ${CALL_UNLOCK_ORDERS} orders.`}</p>
            </div>
          </div>
          {!unlocked && <div className="ml-8 mt-2 h-1.5 max-w-xs overflow-hidden rounded-full bg-paper-sunk"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (d.confirm.orders / CALL_UNLOCK_ORDERS) * 100)}%` }} /></div>}
        </div>
      </div>
      <Save intent="confirm" label="Save confirmation settings" msg={msg} />
    </Form>
  );
}
