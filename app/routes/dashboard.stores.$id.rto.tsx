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
  const [list, [{ total }], byKind, orderCount, m, w] = await Promise.all([
    db.select().from(blockedCustomers).where(where).orderBy(desc(blockedCustomers.createdAt)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ total: count() }).from(blockedCustomers).where(where),
    db.select({ kind: blockedCustomers.kind, n: count() }).from(blockedCustomers).where(eq(blockedCustomers.storeId, store.id)).groupBy(blockedCustomers.kind),
    completedOrders(store.id),
    messaging(),
    getWallet(store.id),
  ]);
  const rates = await ratesFor(w);
  const h = store.codCooldownHours;
  const cooldown = h % 730 === 0 ? { value: h / 730, unit: "months" } : h % 24 === 0 ? { value: h / 24, unit: "days" } : { value: h, unit: "hours" };
  return json({
    storeId: store.id, isAdmin: viewer.role === "admin", codEnabled: store.codEnabled,
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

export default function RtoSuite() {
  const d = useLoaderData<typeof loader>();
  const r = useActionData<typeof action>();
  const nav = useNavigation();
  const uploading = nav.state === "submitting" && nav.formData?.get("intent") === "blockCsv";
  const msg = (form: string) => r?.form === form ? <div className="mb-4">{r.ok ? <Notice tone="success">{r.ok}</Notice> : r.error ? <Notice tone="error">{r.error}</Notice> : null}</div> : null;

  return (
    <div className="space-y-5">
      {uploading && <BusyOverlay title="Reading your file" note="Adding customers to the block list." />}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat icon="shipping" label="COD wait time" value={d.cod.cooldownOn ? `${d.cod.cooldown.value} ${d.cod.cooldown.unit}` : "Off"} />
        <Stat icon="check" label="OTP verification" value={d.otp.on ? [d.otp.prepaid && "Prepaid", d.otp.cod && "COD"].filter(Boolean).join(" + ") : "Off"} />
        <Stat icon="users" label="Blocked entries" value={String(Object.values(d.counts).reduce((a, b) => a + (b ?? 0), 0))} />
        <Stat icon="sparkle" label="Order confirmation" value={d.confirm.on ? "WhatsApp" : "Off"} />
      </div>

      {/* COD rules */}
      <Card id="cod" title="COD rules" text="Stop the same customer from piling up Cash on Delivery orders.">
        {msg("cod")}
        {!d.codEnabled && <div className="mb-4"><Notice tone="warning">Cash on Delivery is off for this store, so these rules don't apply right now. Turn it on in <Link className="underline" to={`/dashboard/stores/${d.storeId}/settings`}>Store settings</Link>.</Notice></div>}
        <CodForm d={d} />
      </Card>

      {/* OTP */}
      <Card id="otp" title="OTP verification" text="Customers confirm their mobile number with a one-time code before the order goes through. Cuts fake numbers and prank orders." price={`${rupees(d.otp.price)} per OTP`}>
        {msg("otp")}
        <OtpForm d={d} />
      </Card>

      {/* Block */}
      <Card id="block" title="Block customers" text="Stop customers with a bad history by mobile number, email, pincode, city, state or country.">
        {msg("blockSettings")}
        <BlockSettings d={d} />
        <div className="mt-6 grid gap-5 border-t border-rule pt-6 lg:grid-cols-2">
          <div>
            <h3 className="font-semibold">Add manually</h3>
            {msg("blockAdd")}
            <Form method="post" className="mt-3 space-y-3" key={r?.form === "blockAdd" && r.ok ? r.ok + Date.now() : "add"}>
              <select name="kind" className="input" defaultValue="phone" aria-label="What to block">
                {BLOCK_KINDS.map((k) => <option key={k} value={k}>{BLOCK_LABELS[k]}</option>)}
              </select>
              <textarea name="values" rows={3} className="input" placeholder="One per line, or separated by commas. E.g. 9876543210" />
              <SubmitButton intent="blockAdd" busyText="Adding">Add to block list</SubmitButton>
            </Form>
          </div>
          <CsvUpload storeId={d.storeId} msg={msg("blockCsv")} />
        </div>
        <BlockList d={d} msg={msg("blockDelete") ?? msg("blockClear")} />
      </Card>

      {/* Order confirmation */}
      <Card id="confirm" title="Order confirmation" text="Confirm every order with the customer right after checkout, so fewer orders get refused at the door.">
        {msg("confirm")}
        <ConfirmForm d={d} />
      </Card>
    </div>
  );
}

type D = ReturnType<typeof useLoaderData<typeof loader>>;

function Card({ id, title, text, price, children }: { id: string; title: string; text: string; price?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="panel scroll-mt-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-rule px-5 py-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="mt-0.5 max-w-2xl text-sm text-ink-soft">{text}</p>
        </div>
        {price && <span className="rounded-full bg-pine-tint px-2.5 py-1 text-xs font-semibold text-pine">{price} · from wallet</span>}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Stat({ icon, label, value }: { icon: "shipping" | "check" | "users" | "sparkle"; label: string; value: string }) {
  return (
    <div className="panel flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-pine-tint text-pine"><Icon name={icon} className="h-4 w-4" /></span>
      <div className="min-w-0"><p className="text-xs text-ink-soft">{label}</p><p className="truncate font-semibold">{value}</p></div>
    </div>
  );
}

/** Big on/off switch that controls the options under it. */
function Master({ name, label, on, setOn }: { name: string; label: string; on: boolean; setOn: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-rule bg-paper/60 px-4 py-3">
      <span className="font-medium">{label}</span>
      <input type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} className="sr-only" />
      <span aria-hidden className={`relative h-6 w-10 shrink-0 rounded-full transition ${on ? "bg-brand" : "bg-rule-strong"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </label>
  );
}

/** Round tick option (Prepaid / COD …). */
function Tick({ name, label, hint, checked, onChange, disabled }: { name: string; label: React.ReactNode; hint?: React.ReactNode; checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 rounded-lg px-1 py-1.5 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" name={name} checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition peer-focus-visible:ring-2 peer-focus-visible:ring-brand/40 ${checked ? "border-brand bg-brand text-white" : "border-rule-strong bg-white"}`}>
        {checked && <Icon name="check" className="h-3 w-3" strokeWidth={3} />}
      </span>
      <span className="min-w-0"><span className="block text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-ink-faint">{hint}</span>}</span>
    </label>
  );
}

function CodForm({ d }: { d: D }) {
  const [on, setOn] = useState(d.cod.cooldownOn);
  const [after, setAfter] = useState(d.cod.blockAfterPrepaid);
  return (
    <Form method="post" className="space-y-4">
      <Master name="cooldownOn" label="Wait time between COD orders" on={on} setOn={setOn} />
      {on && (
        <div className="pl-1">
          <div className="flex max-w-sm gap-2">
            <input type="number" name="cooldownValue" min={1} defaultValue={d.cod.cooldown.value} className="input w-28" aria-label="Wait time" />
            <select name="cooldownUnit" defaultValue={d.cod.cooldown.unit} className="input" aria-label="Unit">
              <option value="hours">hours</option><option value="days">days</option><option value="months">months</option>
            </select>
          </div>
          <p className="hint">After a COD order, the same mobile number can't order on COD again for this long. It can still pay online.</p>
        </div>
      )}
      {!on && <input type="hidden" name="cooldownValue" value={d.cod.cooldown.value} />}
      {!on && <input type="hidden" name="cooldownUnit" value={d.cod.cooldown.unit} />}
      <Tick name="blockAfterPrepaid" checked={after} onChange={setAfter} label="Online-only for customers who have paid online before" hint="Once a number completes a prepaid order, COD is hidden for it." />
      <SubmitButton intent="cod" busyText="Saving">Save COD rules</SubmitButton>
    </Form>
  );
}

function OtpForm({ d }: { d: D }) {
  const [on, setOn] = useState(d.otp.on);
  const [prepaid, setPrepaid] = useState(d.otp.prepaid);
  const [cod, setCod] = useState(d.otp.cod);
  return (
    <Form method="post" className="space-y-4">
      {!d.otp.ready && <Notice tone="warning">{d.isAdmin ? <>OTP sending isn't set up yet. Add the MSG91 key in <Link to="/dashboard/wallets" className="underline">All wallets → Settings → Messaging</Link>.</> : "OTP sending is being set up by Growpefy. Your settings are saved and OTP starts automatically once it's live."}</Notice>}
      <Master name="otpOn" label="Ask for OTP at checkout" on={on} setOn={setOn} />
      {on ? (
        <div className="space-y-1 pl-1">
          <Tick name="otpPrepaid" checked={prepaid} onChange={setPrepaid} label="Prepaid" hint="OTP before the customer goes to the payment page" />
          <Tick name="otpCod" checked={cod} onChange={setCod} label="COD" hint="OTP before the Cash on Delivery order is placed" />
        </div>
      ) : (<>{prepaid && <input type="hidden" name="otpPrepaid" value="on" />}{cod && <input type="hidden" name="otpCod" value="on" />}</>)}
      <p className="text-xs text-ink-faint">Each OTP sent costs {rupees(d.otp.price)} from your wallet. A verified number can order for 30 minutes without a new OTP.</p>
      <SubmitButton intent="otp" busyText="Saving">Save OTP settings</SubmitButton>
    </Form>
  );
}

function BlockSettings({ d }: { d: D }) {
  const [on, setOn] = useState(d.block.on);
  const [codOnly, setCodOnly] = useState(d.block.codOnly);
  return (
    <Form method="post" className="space-y-4">
      <Master name="blockOn" label="Block customers on the list below" on={on} setOn={setOn} />
      {on ? (
        <div className="pl-1">
          <Tick name="codOnly" checked={codOnly} onChange={setCodOnly} label="COD block only"
            hint={codOnly ? "Blocked customers can still pay online. Only Cash on Delivery is hidden." : "Blocked customers can't place any order, prepaid or COD."} />
        </div>
      ) : codOnly && <input type="hidden" name="codOnly" value="on" />}
      <SubmitButton intent="blockSettings" busyText="Saving">Save block settings</SubmitButton>
    </Form>
  );
}

const SAMPLE: Record<CsvSource, string> = { shopify: "/samples/block-list-shopify.csv", woocommerce: "/samples/block-list-woocommerce.csv", other: "/samples/block-list-other.csv" };
const SOURCE_HINT: Record<CsvSource, string> = {
  shopify: "Shopify admin → Orders → Export → CSV for Excel. We read email, shipping phone, pincode, city, state and country.",
  woocommerce: "WooCommerce → Orders → Export (CSV). We read billing email & phone and shipping pincode, city, state, country.",
  other: "Columns: A email, B phone, C pincode, D city, E state, F country. 10-digit phones use your store's country.",
};

function CsvUpload({ storeId: _s, msg }: { storeId: number; msg: React.ReactNode }) {
  const [source, setSource] = useState<CsvSource>("shopify");
  const [kinds, setKinds] = useState<BlockKind[]>(["phone"]);
  const toggle = (k: BlockKind) => setKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">Upload a CSV</h3>
        <a href={SAMPLE[source]} download className="inline-flex items-center gap-1 text-xs font-medium text-pine hover:underline"><Icon name="download" className="h-3.5 w-3.5" />Sample file</a>
      </div>
      {msg}
      <Form method="post" encType="multipart/form-data" className="mt-3 space-y-3">
        <label className="block">
          <span className="label">Where did you export this file from?</span>
          <select name="source" value={source} onChange={(e) => setSource(e.target.value as CsvSource)} className="input">
            {CSV_SOURCES.map((s) => <option key={s} value={s}>{CSV_SOURCE_LABELS[s]}</option>)}
          </select>
          <span className="hint">{SOURCE_HINT[source]}</span>
        </label>
        <fieldset>
          <legend className="label">What do you want to block from this file?</legend>
          <div className="flex flex-wrap gap-2">
            {BLOCK_KINDS.map((k) => {
              const on = kinds.includes(k);
              return (
                <label key={k} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition ${on ? "border-brand bg-pine-tint font-medium text-pine" : "border-rule-strong text-ink-soft hover:border-ink-faint"}`}>
                  <input type="checkbox" name="kinds" value={k} checked={on} onChange={() => toggle(k)} className="sr-only" />{BLOCK_LABELS[k]}
                </label>
              );
            })}
          </div>
          {kinds.some((k) => k === "country" || k === "state") && <p className="mt-2 text-xs text-warn">Careful: blocking a state or country affects every customer from there.</p>}
        </fieldset>
        <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-paper-sunk file:px-3 file:py-2 file:text-sm file:font-medium" />
        <SubmitButton intent="blockCsv" busyText="Uploading" disabled={!kinds.length}>Upload and block</SubmitButton>
      </Form>
    </div>
  );
}

function BlockList({ d, msg }: { d: D; msg: React.ReactNode }) {
  const [params] = useSearchParams();
  const href = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v) sp.set(k, v); else sp.delete(k); }
    if (!("page" in patch)) sp.delete("page");
    return `?${sp.toString()}#block`;
  };
  const totalAll = Object.values(d.counts).reduce((a, b) => a + (b ?? 0), 0);
  const [clear, setClear] = useState(false);
  useEffect(() => setClear(false), [d.total]);
  const pages = Math.max(1, Math.ceil(d.total / PAGE));
  return (
    <div className="mt-6 border-t border-rule pt-6">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto font-semibold">Block list <span className="font-normal text-ink-faint">({totalAll})</span></h3>
        <Form method="get" className="flex gap-2" preventScrollReset>
          {d.kind && <input type="hidden" name="kind" value={d.kind} />}
          <input name="q" defaultValue={d.q} placeholder="Search" className="input h-9 w-44 py-1.5 text-sm" aria-label="Search block list" />
        </Form>
        {totalAll > 0 && <button type="button" className="btn-quiet text-xs text-bad" onClick={() => setClear((v) => !v)}>Clear list</button>}
      </div>
      {msg}
      {clear && (
        <Form method="post" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
          <span>Remove {d.kind ? `all blocked ${BLOCK_LABELS[d.kind].toLowerCase()}s` : "everything"} from the list? Type <b>REMOVE</b>:</span>
          <input type="hidden" name="kind" value={d.kind ?? ""} />
          <input name="confirm" className="input h-8 w-28 py-1 text-sm" />
          <SubmitButton intent="blockClear" className="btn-danger border border-red-200 bg-white" busyText="Removing">Remove</SubmitButton>
        </Form>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Link to={href({ kind: null })} preventScrollReset className={`rounded-full px-3 py-1 text-xs font-medium ${!d.kind ? "bg-ink text-white" : "bg-paper-sunk text-ink-soft"}`}>All {totalAll}</Link>
        {BLOCK_KINDS.map((k) => (
          <Link key={k} to={href({ kind: k })} preventScrollReset className={`rounded-full px-3 py-1 text-xs font-medium ${d.kind === k ? "bg-ink text-white" : "bg-paper-sunk text-ink-soft"}`}>{BLOCK_LABELS[k]} {d.counts[k] ?? 0}</Link>
        ))}
      </div>
      {d.list.length === 0 ? (
        <p className="mt-4 rounded-lg bg-paper px-4 py-6 text-center text-sm text-ink-faint">{d.q || d.kind ? "Nothing matches." : "No one is blocked yet."}</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-rule">
          <table className="table min-w-[520px]">
            <thead><tr><th>Type</th><th>Value</th><th>Added</th><th /></tr></thead>
            <tbody>
              {d.list.map((b) => (
                <tr key={b.id}>
                  <td className="text-ink-soft">{BLOCK_LABELS[b.kind]}</td>
                  <td className="font-medium">{b.label}</td>
                  <td className="text-xs text-ink-faint">{new Date(b.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })} · {b.source === "csv" ? "CSV" : "Manual"}</td>
                  <td className="text-right">
                    <Form method="post" preventScrollReset><input type="hidden" name="id" value={b.id} />
                      <button name="intent" value="blockDelete" className="btn-quiet text-xs" aria-label={`Unblock ${b.label}`}>Unblock</button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-ink-faint">Page {d.page} of {pages}</span>
          <div className="flex gap-2">
            {d.page > 1 && <Link to={href({ page: String(d.page - 1) })} preventScrollReset className="btn-secondary px-3 py-1.5">Previous</Link>}
            {d.page < pages && <Link to={href({ page: String(d.page + 1) })} preventScrollReset className="btn-secondary px-3 py-1.5">Next</Link>}
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmForm({ d }: { d: D }) {
  const [on, setOn] = useState(d.confirm.on);
  const [wa, setWa] = useState(d.confirm.whatsapp);
  const [prepaid, setPrepaid] = useState(d.confirm.prepaid);
  const [cod, setCod] = useState(d.confirm.cod);
  const unlocked = d.confirm.orders >= CALL_UNLOCK_ORDERS;
  return (
    <Form method="post" className="space-y-4">
      {!d.confirm.ready && <Notice tone="warning">{d.isAdmin ? <>WhatsApp sending isn't set up yet. Add the WhatsApp Cloud API details in <Link to="/dashboard/wallets" className="underline">All wallets → Settings → Messaging</Link>.</> : "WhatsApp messages are being set up by Growpefy. Your settings are saved and messages start automatically once it's live."}</Notice>}
      <Master name="confirmOn" label="Confirm orders with customers" on={on} setOn={setOn} />
      {on ? (
        <div className="space-y-3 pl-1">
          <div className="rounded-xl border border-rule p-3">
            <Tick name="waOn" checked={wa} onChange={setWa} label={<>WhatsApp confirmation <span className="ml-1 rounded-full bg-pine-tint px-2 py-0.5 text-[11px] font-semibold text-pine">{rupees(d.confirm.price)} per message</span></>}
              hint="Sends the order details on WhatsApp right after the order is placed." />
            {wa && (
              <div className="ml-8 mt-1 space-y-0.5">
                <Tick name="waPrepaid" checked={prepaid} onChange={setPrepaid} label="Prepaid orders" />
                <Tick name="waCod" checked={cod} onChange={setCod} label="COD orders" />
              </div>
            )}
          </div>
          <div className="rounded-xl border border-dashed border-rule-strong p-3">
            <Tick name="callOn" checked={false} disabled label={<>Call confirmation <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-paper-sunk px-2 py-0.5 text-[11px] font-semibold text-ink-soft">🔒 {unlocked ? "Coming soon" : `Unlocks at ${CALL_UNLOCK_ORDERS} orders`}</span></>}
              hint={unlocked ? "You've crossed 100 orders. Call confirmation will appear here soon." : `Your store has ${d.confirm.orders} of ${CALL_UNLOCK_ORDERS} orders.`} />
            {!unlocked && <div className="ml-8 mt-1 h-1.5 max-w-xs overflow-hidden rounded-full bg-paper-sunk"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, (d.confirm.orders / CALL_UNLOCK_ORDERS) * 100)}%` }} /></div>}
          </div>
        </div>
      ) : (<>{wa && <input type="hidden" name="waOn" value="on" />}{prepaid && <input type="hidden" name="waPrepaid" value="on" />}{cod && <input type="hidden" name="waCod" value="on" />}</>)}
      <SubmitButton intent="confirm" busyText="Saving">Save confirmation settings</SubmitButton>
    </Form>
  );
}
