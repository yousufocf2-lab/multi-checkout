// GST tax invoice for a wallet recharge as a PDF (A4), with the Growpefy logo. Built with pdfkit on the server.
import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { BillingDetails } from "~/db.server";
import { stateCode } from "./billing.server";

const ASSETS = path.join(process.cwd(), "assets", "invoice");
const C = { ink: "#0B1513", soft: "#4A5753", faint: "#7C8884", rule: "#DCE3E0", tint: "#EEF6F2", green: "#0B5D4B", mint: "#2DD496" };

export type InvoiceData = {
  no: string; date: Date; txnid: string; mihpayid: string | null; source: "payu" | "admin"; note: string | null;
  seller: BillingDetails & { sac?: string };
  buyer: BillingDetails; store: string;
  credit: number; gst: number; total: number; intra: boolean; // paise
};

const money = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const two = (n: number) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const three = (n: number) => `${n >= 100 ? `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? " " : ""}` : ""}${n % 100 ? two(n % 100) : ""}`;
/** 2360.50 → "Two Thousand Three Hundred Sixty Rupees and Fifty Paise Only" (Indian grouping) */
export function inWords(paise: number) {
  let r = Math.floor(paise / 100);
  const p = paise % 100;
  const parts: string[] = [];
  const cr = Math.floor(r / 1_00_00_000); r %= 1_00_00_000;
  const lakh = Math.floor(r / 1_00_000); r %= 1_00_000;
  const th = Math.floor(r / 1000); r %= 1000;
  if (cr) parts.push(`${three(cr)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (r) parts.push(three(r));
  return `${parts.join(" ") || "Zero"} Rupees${p ? ` and ${two(p)} Paise` : ""} Only`;
}

export function invoicePdf(d: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Tax Invoice ${d.no}`, Author: d.seller.name || "Growpefy", Subject: "Growpefy wallet recharge" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("R", path.join(ASSETS, "Inter-Regular.otf"));
    doc.registerFont("M", path.join(ASSETS, "Inter-SemiBold.otf"));
    doc.registerFont("B", path.join(ASSETS, "Inter-Bold.otf"));

    const W = doc.page.width; // 595
    const L = 44, R = W - 44, CW = R - L;
    const text = (t: string, x: number, y: number, o: PDFKit.Mixins.TextOptions & { font?: string; size?: number; color?: string } = {}) => {
      const { font = "R", size = 9, color = C.ink, ...rest } = o;
      doc.font(font).fontSize(size).fillColor(color).text(t, x, y, { lineGap: 1.5, ...rest });
      return doc.y;
    };

    // ---- top band ----
    doc.rect(0, 0, W, 6).fill(C.green);
    doc.rect(W * 0.62, 0, W * 0.38, 6).fill(C.mint);
    const logo = path.join(ASSETS, "growpefy-lockup.png");
    if (fs.existsSync(logo)) doc.image(logo, L, 34, { height: 30 });
    text("TAX INVOICE", L, 34, { width: CW, align: "right", font: "B", size: 20, color: C.green, characterSpacing: 1 });
    text("Original for recipient", L, 60, { width: CW, align: "right", size: 8, color: C.faint });

    // invoice facts strip
    let y = 92;
    doc.roundedRect(L, y, CW, 50, 8).fill(C.tint);
    const facts: [string, string][] = [
      ["Invoice no.", d.no],
      ["Invoice date", d.date.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })],
      ["Place of supply", d.buyer.state ? `${d.buyer.state}${stateCode(d.buyer.state) ? ` (${stateCode(d.buyer.state)})` : ""}` : d.seller.state || "—"],
      ["Payment", d.source === "admin" ? "Received by Growpefy" : "Paid online (PayU)"],
    ];
    const fw = CW / facts.length;
    facts.forEach(([k, v], i) => {
      text(k.toUpperCase(), L + 14 + i * fw, y + 11, { size: 7, color: C.faint, characterSpacing: 0.6, width: fw - 20 });
      text(v, L + 14 + i * fw, y + 24, { font: "M", size: 9.5, width: fw - 20, lineBreak: false, ellipsis: true });
    });

    // ---- from / bill to ----
    y += 72;
    const col = (title: string, x: number, b: BillingDetails, w: number) => {
      text(title.toUpperCase(), x, y, { size: 7.5, color: C.green, font: "B", characterSpacing: 0.8 });
      let yy = text(b.name || "—", x, y + 14, { font: "B", size: 11, width: w });
      const lines = [
        b.address,
        b.state ? `State: ${b.state}${stateCode(b.state) ? ` · Code ${stateCode(b.state)}` : ""}` : null,
        b.gstin ? `GSTIN: ${b.gstin}` : null,
        [b.email, b.phone].filter(Boolean).join(" · ") || null,
      ].filter(Boolean) as string[];
      for (const l of lines) yy = text(l, x, yy + 2, { size: 9, color: l.startsWith("GSTIN") ? C.ink : C.soft, font: l.startsWith("GSTIN") ? "M" : "R", width: w });
      return yy;
    };
    const half = CW / 2 - 12;
    const yA = col("From", L, d.seller, half);
    const yB = col("Bill to", L + CW / 2 + 12, { ...d.buyer, name: d.buyer.name || d.store }, half);
    y = Math.max(yA, yB) + 22;

    // ---- items table ----
    const cols = [
      { t: "#", w: 24, a: "left" as const },
      { t: "Description", w: CW - 24 - 62 - 40 - 92 - 92, a: "left" as const },
      { t: "SAC", w: 62, a: "left" as const },
      { t: "Qty", w: 40, a: "right" as const },
      { t: "Rate", w: 92, a: "right" as const },
      { t: "Taxable value", w: 92, a: "right" as const },
    ];
    doc.rect(L, y, CW, 24).fill(C.green);
    let x = L;
    cols.forEach((c) => { text(c.t, x + 8, y + 8, { font: "M", size: 8, color: "#FFFFFF", width: c.w - 16, align: c.a }); x += c.w; });
    y += 24;
    const rowTop = y;
    x = L;
    const desc = "Prepaid wallet credit for Growpefy services";
    const sub = `Checkout platform fees, OTP and WhatsApp messaging · Store: ${d.store}`;
    const cells = ["1", "", d.seller.sac || "998314", "1", money(d.credit), money(d.credit)];
    let rowEnd = rowTop + 40;
    cols.forEach((c, i) => {
      if (i === 1) {
        const yy = text(desc, x + 8, rowTop + 10, { font: "M", size: 9.5, width: c.w - 16 });
        rowEnd = Math.max(rowEnd, text(sub, x + 8, yy + 2, { size: 8, color: C.faint, width: c.w - 16 }) + 10);
      } else text(cells[i], x + 8, rowTop + 10, { size: 9.5, width: c.w - 16, align: c.a, font: i === 5 ? "M" : "R" });
      x += c.w;
    });
    y = rowEnd;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.7).strokeColor(C.rule).stroke();

    // ---- totals ----
    y += 14;
    const TL = R - 230;
    const tot = (k: string, v: string, bold = false) => {
      text(k, TL, y, { size: bold ? 10.5 : 9.5, color: bold ? C.ink : C.soft, font: bold ? "B" : "R", width: 120 });
      text(v, TL + 110, y, { size: bold ? 10.5 : 9.5, font: bold ? "B" : "M", width: 110, align: "right" });
      y += bold ? 20 : 17;
    };
    const halfGst = Math.round(d.gst / 2);
    tot("Taxable value", money(d.credit));
    if (d.intra) { tot("CGST @ 9%", money(halfGst)); tot("SGST @ 9%", money(d.gst - halfGst)); }
    else tot("IGST @ 18%", money(d.gst));
    doc.roundedRect(TL - 12, y - 4, 242, 30, 6).fill(C.green);
    text("Total", TL, y + 5, { font: "B", size: 11, color: "#FFFFFF", width: 120 });
    text(money(d.total), TL + 110, y + 5, { font: "B", size: 11, color: "#FFFFFF", width: 110, align: "right" });
    const amountY = y + 40;

    // amount in words + tax summary (left of totals)
    let ly = rowEnd + 14;
    text("AMOUNT IN WORDS", L, ly, { size: 7.5, color: C.faint, characterSpacing: 0.6 });
    ly = text(inWords(d.total), L, ly + 12, { font: "M", size: 9.5, width: TL - L - 30 });
    ly += 12;
    text("TAX SUMMARY", L, ly, { size: 7.5, color: C.faint, characterSpacing: 0.6 });
    ly = text(d.intra ? `CGST 9% ${money(halfGst)} + SGST 9% ${money(d.gst - halfGst)} on ${money(d.credit)}` : `IGST 18% ${money(d.gst)} on ${money(d.credit)}`, L, ly + 12, { size: 9, color: C.soft, width: TL - L - 30 });
    ly = text("Tax payable on reverse charge: No", L, ly + 3, { size: 9, color: C.soft, width: TL - L - 30 });

    // ---- payment details ----
    y = Math.max(amountY, ly) + 24;
    doc.roundedRect(L, y, CW, 58, 8).lineWidth(0.7).strokeColor(C.rule).stroke();
    text("PAYMENT DETAILS", L + 14, y + 11, { size: 7.5, color: C.green, font: "B", characterSpacing: 0.8 });
    const pay = d.source === "admin"
      ? `Received by Growpefy${d.note ? ` · ${d.note}` : ""} · Ref ${d.txnid}`
      : `Paid online via PayU · Transaction ${d.txnid}${d.mihpayid ? ` · PayU ID ${d.mihpayid}` : ""}`;
    text(pay, L + 14, y + 25, { size: 9, width: CW - 28 });
    text(`Wallet credit of ${money(d.credit)} added to the ${d.store} Growpefy wallet.`, L + 14, y + 39, { size: 9, color: C.soft, width: CW - 28 });

    // ---- signature ----
    y += 88;
    text(`For ${d.seller.name || "Growpefy"}`, R - 200, y, { width: 200, align: "right", font: "M", size: 9.5 });
    doc.moveTo(R - 160, y + 40).lineTo(R, y + 40).lineWidth(0.7).strokeColor(C.rule).stroke();
    text("Authorised signatory", R - 200, y + 45, { width: 200, align: "right", size: 8.5, color: C.faint });

    // terms (left of signature)
    const terms = [
      "Wallet balance is non-refundable and non-transferable and can be used only for Growpefy services.",
      "Refunds apply only to failed or duplicate payments, as per our Refund & Cancellation Policy.",
      "This is a computer-generated invoice and does not need a physical signature.",
    ];
    text("TERMS", L, y, { size: 7.5, color: C.faint, characterSpacing: 0.6 });
    let ty = y + 12;
    for (const t of terms) ty = text(`•  ${t}`, L, ty + 2, { size: 8, color: C.soft, width: CW - 230 });

    // ---- footer ----
    const fy = doc.page.height - 46;
    doc.moveTo(L, fy).lineTo(R, fy).lineWidth(0.7).strokeColor(C.rule).stroke();
    text([d.seller.name || "Growpefy", d.seller.email, d.seller.phone, "growpefy.com"].filter(Boolean).join("  ·  "), L, fy + 10, { width: CW, align: "center", size: 8, color: C.faint });
    doc.rect(0, doc.page.height - 6, W, 6).fill(C.green);

    doc.end();
  });
}
