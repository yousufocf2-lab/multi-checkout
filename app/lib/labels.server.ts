// 4×6 inch thermal shipping labels (one per page) for Delhivery shipments, drawn with pdfkit. The AWB barcode is
// Code 128; Delhivery's sort / routing code comes from its packing slip API when available.
import path from "node:path";
import PDFDocument from "pdfkit";
import type { Order } from "~/db.server";
import type { PackingSlip } from "./couriers/delhivery.server";
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
    codes.push(105); // start C
    for (let i = 0; i < text.length; i += 2) codes.push(Number(text.slice(i, i + 2)));
  } else {
    codes.push(104); // start B
    for (const ch of text) codes.push(Math.max(0, Math.min(94, ch.charCodeAt(0) - 32)));
  }
  let sum = codes[0];
  for (let i = 1; i < codes.length; i++) sum += codes[i] * i;
  codes.push(sum % 103, 106);
  return codes.map((c) => PATTERNS[c]).join("");
}
/** Draws a Code 128 barcode filling `width`. */
function barcode(doc: PDFKit.PDFDocument, text: string, x: number, y: number, width: number, height: number) {
  const widths = code128(text).split("").map(Number);
  const modules = widths.reduce((a, b) => a + b, 0) + 20; // 10-module quiet zone each side
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
export type LabelFrom = { name: string; pickup: string | null };

/** One PDF, one 4×6 label per order. */
export function labelsPdf(list: LabelOrder[], slips: Map<string, PackingSlip>, from: LabelFrom, batch: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const W = 288, H = 432, P = 10; // 4×6 inches
    const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false, info: { Title: `Shipping labels ${batch}`, Author: from.name } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("R", path.join(ASSETS, "Inter-Regular.otf"));
    doc.registerFont("M", path.join(ASSETS, "Inter-SemiBold.otf"));
    doc.registerFont("B", path.join(ASSETS, "Inter-Bold.otf"));
    const t = (s: string, x: number, y: number, o: PDFKit.Mixins.TextOptions & { font?: string; size?: number } = {}) => {
      const { font = "R", size = 8, ...rest } = o;
      doc.font(font).fontSize(size).fillColor("#000").text(s, x, y, { lineGap: 1, ...rest });
    };
    const line = (y: number) => doc.moveTo(P, y).lineTo(W - P, y).lineWidth(1).strokeColor("#000").stroke();

    for (const o of list) {
      doc.addPage({ size: [W, H], margin: 0 });
      const slip = o.awb ? slips.get(o.awb) : undefined;
      const c = o.customer;
      const cod = o.paymentMethod === "cod" || o.paymentMethod === "partial";
      const collect = o.paymentMethod === "cod" ? o.total : o.paymentMethod === "partial" ? Math.max(0, o.total - (o.amountPaid ?? o.advance ?? 0)) : 0;
      doc.rect(4, 4, W - 8, H - 8).lineWidth(1.2).strokeColor("#000").stroke();

      // Header: courier + payment
      t("DELHIVERY", P, P + 2, { font: "B", size: 14 });
      t(slip?.sortCode ?? "", P, P + 20, { font: "B", size: 11, width: 150 });
      doc.rect(W - P - 112, P, 112, 34).fill("#000");
      doc.font("B").fontSize(cod ? 13 : 12).fillColor("#fff").text(cod ? `COD ${rupees(collect)}` : "PREPAID", W - P - 112, P + (cod ? 10 : 11), { width: 112, align: "center" });
      line(P + 40);

      // AWB barcode
      if (o.awb) {
        barcode(doc, o.awb, P + 4, P + 48, W - 2 * P - 8, 56);
        t(o.awb, P, P + 108, { font: "B", size: 12, width: W - 2 * P, align: "center", characterSpacing: 1.5 });
      }
      line(P + 128);

      // Ship to
      let y = P + 134;
      t("SHIP TO", P, y, { font: "M", size: 7 });
      t(`${c.firstName} ${c.lastName}`.trim(), P, y + 10, { font: "B", size: 11, width: W - 2 * P });
      y = doc.y + 1;
      t([c.address1, c.address2].filter(Boolean).join(", "), P, y, { size: 8.5, width: W - 2 * P, height: 48, ellipsis: true });
      y = Math.min(doc.y, P + 210) + 1;
      t(`${c.city}, ${stateName(c.state)}`, P, y, { font: "M", size: 9, width: W - 2 * P - 70 });
      t(`PIN ${c.pincode}`, W - P - 80, y - 1, { font: "B", size: 12, width: 80, align: "right" });
      t(`Mobile: ${c.phone}`, P, doc.y + 2, { size: 8.5 });
      if (slip?.destination) t(`Destination: ${slip.destination}`, P, doc.y + 1, { size: 7.5 });
      line(P + 262);

      // Order details
      y = P + 268;
      const order = o.shopifyOrderName ?? `#${o.id.slice(-8).toUpperCase()}`;
      t(`Order ${order}`, P, y, { font: "B", size: 10 });
      t(new Date(o.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }), W - P - 100, y + 1, { size: 8, width: 100, align: "right" });
      barcode(doc, order.replace(/^#/, ""), P, y + 15, 150, 22);
      const items = o.items.map((l) => `${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""} × ${l.quantity}`).join(", ");
      const qty = o.items.reduce((a, l) => a + l.quantity, 0);
      t(`Qty ${qty}`, W - P - 100, y + 20, { font: "M", size: 9, width: 100, align: "right" });
      t(items, P, y + 42, { size: 8, width: W - 2 * P, height: 34, ellipsis: true });
      line(P + 352);

      // Return / seller
      y = P + 358;
      t("IF UNDELIVERED, RETURN TO", P, y, { font: "M", size: 7 });
      t(slip?.sellerName ?? from.name, P, y + 9, { font: "B", size: 9, width: W - 2 * P });
      const ret = slip?.returnAddress ?? slip?.sellerAddress ?? (from.pickup ? `Pickup: ${from.pickup}` : "");
      if (ret) t(ret, P, doc.y + 1, { size: 7.5, width: W - 2 * P, height: 30, ellipsis: true });
      t(`Batch ${batch}`, P, H - P - 12, { size: 6.5, width: W - 2 * P, align: "right" });
    }
    if (!list.length) doc.addPage({ size: [W, H], margin: 0 });
    doc.end();
  });
}
