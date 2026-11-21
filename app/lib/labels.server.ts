// Shipping labels as a PDF, drawn with pdfkit from the store's label design (Shipping → Label design).
// Sizes: 4×6 thermal (vertical), 6×4 thermal (horizontal), A4 one per page, A4 four per page.
// The AWB barcode is Code 128; Delhivery's sort code comes from its packing slip API when available.
import path from "node:path";
import PDFDocument from "pdfkit";
import type { Order } from "~/db.server";
import type { PackingSlip } from "./couriers/delhivery.server";
import type { LabelConfig } from "./label-config";
import { INDIAN_STATES } from "./states";

const ASSETS = path.join(process.cwd(), "assets", "invoice");

// ---- Code 128 (sets B and C) ----
const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313", "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];
function code128(text: string): string {
  const digits = /^\d+$/.test(text) && text.length % 2 === 0 && text.length >= 4;
  const codes: number[] = [];
  if (digits) {
    codes.push(105);
    for (let i = 0; i < text.length; i += 2) codes.push(Number(text.slice(i, i + 2)));
  } else {
    codes.push(104);
    for (const ch of text) codes.push(Math.max(0, Math.min(94, ch.charCodeAt(0) - 32)));
  }
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  return codes.map((c) => PATTERNS[c]).join("");
}
function barcode(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, height: number) {
  const widths = code128(text).split("").map(Number);
  const modules = widths.reduce((a, b) => a + b, 0) + 20; // quiet zone
  const m = width / modules;
  let cx = x + 10 * m;
  widths.forEach((w, i) => {
    if (i % 2 === 0) doc.rect(cx, y, w * m, height).fill("#000");
    cx += w * m;
  });
}

const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
const stateName = (code: string) => INDIAN_STATES.find((s) => s.code === code)?.name ?? code;

export type LabelOrder = Pick<Order, "id" | "awb" | "shopifyOrderName" | "paymentMethod" | "total" | "amountPaid" | "advance" | "customer" | "items" | "createdAt">;
export type LabelStore = { name: string; pickupName: string | null; logo: Buffer | null; skus: Map<string, string> };

const logoCache = new Map<string, Promise<Buffer | null>>();
/** The design's logo as bytes (PNG / JPG only), cached. */
export function loadLogo(url: string | null) {
  if (!url) return Promise.resolve(null);
  if (!logoCache.has(url)) {
    logoCache.set(url, fetch(url, { signal: AbortSignal.timeout(10_000) }).then(async (r) => {
      const b = Buffer.from(await r.arrayBuffer());
      const png = b[0] === 0x89 && b[1] === 0x50, jpg = b[0] === 0xff && b[1] === 0xd8;
      return r.ok && (png || jpg) ? b : null;
    }).catch(() => null));
  }
  return logoCache.get(url)!;
}

type Ctx = { doc: PDFKit.PDFDocument; cfg: LabelConfig; color: boolean; st: LabelStore };

function text(c: Ctx, s: string, x: number, y: number, o: PDFKit.Mixins.TextOptions & { font?: "R" | "M" | "B"; size?: number; color?: string } = {}) {
  const { font = "R", size = 7, color = "#000", ...rest } = o;
  c.doc.font(font).fontSize(size).fillColor(color).text(s, x, y, { lineGap: 0.6, ...rest });
  return c.doc.y;
}
const rule = (c: Ctx, x1: number, x2: number, y: number, w = 0.6) => c.doc.moveTo(x1, y).lineTo(x2, y).lineWidth(w).strokeColor("#000").stroke();

function brand(c: Ctx, x: number, y: number, w: number, h: number) {
  if (c.cfg.logo && c.st.logo) {
    try { c.doc.image(c.st.logo, x, y, { fit: [w, h], valign: "center" }); return; } catch { /* fall back to the name */ }
  }
  text(c, c.cfg.brandName || c.st.name, x, y + h / 2 - 6, { font: "B", size: 10.5, width: w, height: 14, ellipsis: true });
}

function payBox(c: Ctx, o: LabelOrder, x: number, y: number, w: number, h: number) {
  const cod = o.paymentMethod === "cod" || o.paymentMethod === "partial";
  const collect = o.paymentMethod === "cod" ? o.total : o.paymentMethod === "partial" ? Math.max(0, o.total - (o.amountPaid ?? o.advance ?? 0)) : 0;
  if (cod) {
    c.doc.roundedRect(x, y, w, h, 3).fill(c.color ? c.cfg.accent : "#000");
    text(c, "COD · COLLECT", x, y + 4, { font: "M", size: 6, color: "#fff", width: w, align: "center", characterSpacing: 0.6 });
    text(c, rupees(collect), x, y + 11, { font: "B", size: 15, color: "#fff", width: w, align: "center" });
  } else {
    c.doc.roundedRect(x, y, w, h, 3).lineWidth(1.4).strokeColor("#000").stroke();
    text(c, "PREPAID", x, y + (c.cfg.showInvoiceValue ? 5 : 9), { font: "B", size: 12, width: w, align: "center", characterSpacing: 1 });
    if (c.cfg.showInvoiceValue) text(c, `Value ${rupees(o.total)}`, x, y + 20, { size: 6.5, width: w, align: "center" });
  }
}

function itemsTable(c: Ctx, o: LabelOrder, x: number, y: number, w: number, maxY: number) {
  const cfg = c.cfg;
  if (cfg.product === "none" && !cfg.showQty && !cfg.showPrice) return y;
  const qtyW = cfg.showQty ? 20 : 0, priceW = cfg.showPrice ? 40 : 0;
  const nameW = w - qtyW - priceW * 2;
  const head = (s: string, xx: number, ww: number, align: "left" | "right") => text(c, s, xx, y, { font: "M", size: 5.8, width: ww, align, color: "#444", characterSpacing: 0.4 });
  head(cfg.product === "sku" ? "SKU" : "ITEM", x, nameW, "left");
  if (cfg.showQty) head("QTY", x + nameW, qtyW, "right");
  if (cfg.showPrice) { head("PRICE", x + nameW + qtyW, priceW, "right"); head("TOTAL", x + nameW + qtyW + priceW, priceW, "right"); }
  y += 8;
  rule(c, x, x + w, y, 0.4);
  y += 2;
  const lines = o.items;
  for (let i = 0; i < lines.length; i++) {
    if (y + 8 > maxY) { text(c, `+ ${lines.length - i} more item${lines.length - i === 1 ? "" : "s"}`, x, y, { size: 6, color: "#444" }); return y + 8; }
    const l = lines[i];
    const sku = c.st.skus.get(l.variantId) ?? null;
    const nm = `${l.title}${l.variantTitle && l.variantTitle !== "Default" ? ` · ${l.variantTitle}` : ""}`;
    const nameTxt = (cfg.product === "sku" ? sku ?? nm : cfg.product === "both" && sku ? `${sku} · ${nm}` : cfg.product === "none" ? "Item" : nm).slice(0, cfg.nameChars);
    text(c, nameTxt, x, y, { size: 6.6, width: nameW - 4, height: 8, ellipsis: true });
    if (cfg.showQty) text(c, String(l.quantity), x + nameW, y, { font: "M", size: 6.6, width: qtyW, align: "right" });
    if (cfg.showPrice) {
      text(c, rupees(l.pricePaise), x + nameW + qtyW, y, { size: 6.6, width: priceW, align: "right" });
      text(c, rupees(l.pricePaise * l.quantity), x + nameW + qtyW + priceW, y, { size: 6.6, width: priceW, align: "right" });
    }
    y += 8.5;
  }
  return y;
}

function shipTo(c: Ctx, o: LabelOrder, x: number, y: number, w: number) {
  const cu = o.customer;
  text(c, "DELIVER TO", x, y, { font: "M", size: 5.8, color: "#444", characterSpacing: 0.6 });
  let yy = text(c, `${cu.firstName} ${cu.lastName}`.trim(), x, y + 7, { font: "B", size: 9.5, width: w, height: 12, ellipsis: true });
  yy = text(c, [cu.address1, cu.address2].filter(Boolean).join(", "), x, yy + 0.5, { size: 7, width: w, height: 27, ellipsis: true });
  yy = text(c, `${cu.city}, ${stateName(cu.state)}`, x, yy + 0.5, { font: "M", size: 7.2, width: w - 62, height: 9, ellipsis: true });
  if (c.cfg.showMobile && cu.phone) yy = text(c, `Mob ${cu.phone}`, x, yy + 0.5, { size: 7 });
  return yy;
}

function pinBox(c: Ctx, pin: string, x: number, y: number) {
  c.doc.roundedRect(x, y, 60, 22, 2).lineWidth(1.2).strokeColor("#000").stroke();
  text(c, "PIN", x, y + 2.5, { font: "M", size: 5, width: 60, align: "center", color: "#444" });
  text(c, pin, x, y + 8, { font: "B", size: 10.5, width: 60, align: "center", characterSpacing: 0.8 });
}

function fromBlock(c: Ctx, x: number, y: number, w: number, maxY: number) {
  const cfg = c.cfg;
  const pick = cfg.pickupAddress || (c.st.pickupName ? `Pickup: ${c.st.pickupName}` : "");
  const ret = cfg.returnAddress || pick;
  const name = cfg.brandName || c.st.name;
  if (cfg.showReturn && ret) {
    text(c, "RETURN TO", x, y, { font: "M", size: 5.8, color: "#444", characterSpacing: 0.6 });
    y = text(c, `${name}, ${ret}`, x, y + 7, { size: 6.4, width: w, height: Math.max(8, Math.min(22, maxY - y - 7)), ellipsis: true }) + 2;
  }
  if (cfg.showPickup && pick && (pick !== ret || !cfg.showReturn) && y + 14 < maxY) {
    text(c, "PICKUP FROM", x, y, { font: "M", size: 5.8, color: "#444", characterSpacing: 0.6 });
    y = text(c, pick, x, y + 7, { size: 6.4, width: w, height: 15, ellipsis: true }) + 2;
  }
  const tail = [cfg.showGst && cfg.gstin ? `GSTIN ${cfg.gstin}` : "", cfg.note].filter(Boolean).join("  ·  ");
  if (tail && y + 8 < maxY) y = text(c, tail, x, y, { font: "M", size: 6.2, width: w, height: 8, ellipsis: true }) + 1;
  return y;
}

/** Vertical label in a 288 × 432 box (scaled to the real size by the caller). */
function portrait(c: Ctx, o: LabelOrder, slip: PackingSlip | undefined, batch: string) {
  const W = 288, H = 432, P = 12, IW = W - 2 * P;
  const doc = c.doc;
  doc.roundedRect(5, 5, W - 10, H - 10, 4).lineWidth(1).strokeColor("#000").stroke();
  // Header: brand | courier
  if (c.color) { doc.save().fillOpacity(0.09); doc.rect(5.5, 5.5, W - 11, 36).fill(c.cfg.accent); doc.restore(); }
  brand(c, P, 11, 150, 24);
  text(c, "DELHIVERY", W - P - 110, 12, { font: "B", size: 10, width: 110, align: "right", characterSpacing: 0.8 });
  text(c, "Surface", W - P - 110, 25, { size: 6.2, width: 110, align: "right", color: "#444" });
  rule(c, 5, W - 5, 42, 0.8);
  // Payment + routing
  payBox(c, o, P, 48, 118, 34);
  if (c.cfg.showSortCode && slip?.sortCode) {
    text(c, "SORT CODE", P + 128, 49, { font: "M", size: 5.8, color: "#444", characterSpacing: 0.6 });
    text(c, slip.sortCode, P + 128, 56, { font: "B", size: 12, width: IW - 128, height: 15, ellipsis: true });
    if (slip.destination) text(c, slip.destination, P + 128, 71, { size: 6, width: IW - 128, height: 8, ellipsis: true, color: "#444" });
  } else {
    text(c, "ORDER", P + 128, 49, { font: "M", size: 5.8, color: "#444", characterSpacing: 0.6 });
    text(c, o.shopifyOrderName ?? `#${o.id.slice(-8).toUpperCase()}`, P + 128, 57, { font: "B", size: 11, width: IW - 128 });
  }
  // AWB
  if (o.awb) {
    barcode(doc, o.awb, P, 90, IW, 58);
    text(c, `AWB  ${o.awb}`, P, 151, { font: "B", size: 8.5, width: IW, align: "center", characterSpacing: 1.2 });
  }
  rule(c, 5, W - 5, 164, 0.8);
  // Deliver to
  const yEnd = shipTo(c, o, P, 170, IW - 66);
  pinBox(c, o.customer.pincode, W - P - 60, 178);
  const y2 = Math.max(yEnd + 5, 232);
  rule(c, 5, W - 5, y2, 0.8);
  // Order line
  const name = o.shopifyOrderName ?? `#${o.id.slice(-8).toUpperCase()}`;
  let y = y2 + 6;
  text(c, `Order ${name}`, P, y, { font: "B", size: 8 });
  if (c.cfg.showDate) text(c, new Date(o.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }), W - P - 90, y + 0.5, { size: 6.8, width: 90, align: "right" });
  y += 11;
  if (c.cfg.showOrderBarcode) { barcode(doc, name.replace(/^#/, ""), P - 4, y, 130, 18); y += 22; }
  y = itemsTable(c, o, P, y + 2, IW, H - 62) + 3;
  // From / return
  const yF = Math.max(y, H - 64);
  rule(c, 5, W - 5, yF, 0.8);
  fromBlock(c, P, yF + 5, IW, H - 16);
  text(c, batch, P, H - 15, { size: 5, width: IW, align: "right", color: "#666" });
}

/** Horizontal label in a 432 × 288 box. */
function landscape(c: Ctx, o: LabelOrder, slip: PackingSlip | undefined, batch: string) {
  const W = 432, H = 288, P = 12, L = 236; // left column width
  const doc = c.doc;
  doc.roundedRect(5, 5, W - 10, H - 10, 4).lineWidth(1).strokeColor("#000").stroke();
  doc.moveTo(L, 5).lineTo(L, H - 5).lineWidth(0.8).strokeColor("#000").stroke();
  // Left: brand, AWB, deliver to
  brand(c, P, 10, 130, 22);
  text(c, "DELHIVERY · Surface", L - P - 100, 16, { font: "B", size: 7.5, width: 100, align: "right" });
  rule(c, 5, L, 38, 0.8);
  if (o.awb) {
    barcode(doc, o.awb, P - 4, 44, L - 2 * P + 8, 50);
    text(c, `AWB  ${o.awb}`, P, 97, { font: "B", size: 8.5, width: L - 2 * P, align: "center", characterSpacing: 1.2 });
  }
  rule(c, 5, L, 110, 0.8);
  shipTo(c, o, P, 116, L - 2 * P - 66);
  pinBox(c, o.customer.pincode, L - P - 60, 124);
  // Right: payment, routing, order, items, return
  const X = L + 10, RW = W - P - X;
  payBox(c, o, X, 12, RW, 34);
  let y = 52;
  if (c.cfg.showSortCode && slip?.sortCode) {
    text(c, "SORT CODE", X, y, { font: "M", size: 5.8, color: "#444" });
    text(c, slip.sortCode, X, y + 7, { font: "B", size: 11, width: RW, height: 14, ellipsis: true });
    y += 22;
  }
  const name = o.shopifyOrderName ?? `#${o.id.slice(-8).toUpperCase()}`;
  text(c, `Order ${name}`, X, y, { font: "B", size: 8 });
  if (c.cfg.showDate) text(c, new Date(o.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }), X + RW - 60, y + 0.5, { size: 6.8, width: 60, align: "right" });
  y += 11;
  if (c.cfg.showOrderBarcode) { barcode(doc, name.replace(/^#/, ""), X - 4, y, 110, 16); y += 20; }
  y = itemsTable(c, o, X, y + 2, RW, H - 70) + 3;
  const yF = Math.max(y, H - 72);
  rule(c, L, W - 5, yF, 0.8);
  fromBlock(c, X, yF + 5, RW, H - 15);
  text(c, batch, P, H - 15, { size: 5, width: L - 2 * P, color: "#666" });
}

/** One PDF of labels in the design's size. */
export function labelsPdf(list: LabelOrder[], slips: Map<string, PackingSlip>, cfg: LabelConfig, st: LabelStore, batch: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const A4: [number, number] = [595.28, 841.89];
    const page: [number, number] = cfg.size === "4x6" ? [288, 432] : cfg.size === "6x4" ? [432, 288] : A4;
    const doc = new PDFDocument({ size: page, margin: 0, autoFirstPage: false, info: { Title: `Shipping labels ${batch}`, Author: cfg.brandName || st.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (b: Buffer) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("R", path.join(ASSETS, "Inter-Regular.otf"));
    doc.registerFont("M", path.join(ASSETS, "Inter-SemiBold.otf"));
    doc.registerFont("B", path.join(ASSETS, "Inter-Bold.otf"));
    const c: Ctx = { doc, cfg, color: cfg.size === "a4" || cfg.size === "a4x4", st };
    const draw = (o: LabelOrder, x: number, y: number, scale: number) => {
      doc.save();
      doc.translate(x, y).scale(scale);
      (cfg.size === "6x4" ? landscape : portrait)(c, o, o.awb ? slips.get(o.awb) : undefined, `Batch ${batch}`);
      doc.restore();
    };
    if (cfg.size === "4x6" || cfg.size === "6x4") {
      for (const o of list) { doc.addPage({ size: page, margin: 0 }); draw(o, 0, 0, 1); }
    } else if (cfg.size === "a4") {
      const s = Math.min((A4[0] - 60) / 288, (A4[1] - 60) / 432);
      for (const o of list) { doc.addPage({ size: A4, margin: 0 }); draw(o, (A4[0] - 288 * s) / 2, (A4[1] - 432 * s) / 2, s); }
    } else {
      // 2 × 2 on A4, with light cut marks
      const cw = A4[0] / 2, ch = A4[1] / 2, s = Math.min((cw - 16) / 288, (ch - 16) / 432);
      list.forEach((o, i) => {
        if (i % 4 === 0) {
          doc.addPage({ size: A4, margin: 0 });
          doc.save().dash(3, { space: 3 }).lineWidth(0.4).strokeColor("#999");
          doc.moveTo(cw, 0).lineTo(cw, A4[1]).stroke().moveTo(0, ch).lineTo(A4[0], ch).stroke();
          doc.undash().restore();
        }
        const k = i % 4, col = k % 2, row = Math.floor(k / 2);
        draw(o, col * cw + (cw - 288 * s) / 2, row * ch + (ch - 432 * s) / 2, s);
      });
    }
    if (!list.length) doc.addPage({ size: page, margin: 0 });
    doc.end();
  });
}
