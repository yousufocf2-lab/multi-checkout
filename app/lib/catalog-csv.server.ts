import { and, eq } from "drizzle-orm";
import { catalogItems, db, type ItemImage, type ItemOption, type Store } from "~/db.server";
import { saveItem, type ItemInput, type VariantInput } from "~/lib/catalog.server";

type CsvRow = Record<string, string>;

function parseCsv(text: string): CsvRow[] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [], value = "", quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { value += '"'; i++; }
      else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(value); value = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(value); value = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else value += c;
  }
  if (value || row.length) { row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); }
  if (rows.length < 2) throw new Error("This CSV has no product rows.");
  const headers = rows.shift()!.map((x) => x.trim());
  if (!headers.includes("Handle") || !headers.includes("Title")) throw new Error("Choose a Shopify Products CSV with Handle and Title columns.");
  return rows.map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""])));
}

const get = (r: CsvRow, k: string) => (r[k] ?? "").trim();
const truth = (v: string) => ["true", "yes", "1", "active"].includes(v.toLowerCase());
const number = (v: string) => { const n = Number(v.replace(/,/g, "")); return Number.isFinite(n) ? n : null; };
const money = (v: string) => { const n = number(v); return n == null ? null : Math.max(0, Math.round(n * 100)); };
const csvTags = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 100);

export async function importShopifyProductsCsv(store: Store, text: string) {
  const rows = parseCsv(text);
  if (rows.length > 30_000) throw new Error("This file has too many rows. Split it into smaller Shopify product exports.");
  const grouped = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const handle = get(row, "Handle");
    if (!handle) continue;
    const list = grouped.get(handle) ?? [];
    list.push(row); grouped.set(handle, list);
  }
  if (!grouped.size || grouped.size > 2_000) throw new Error("Import one CSV containing between 1 and 2,000 products at a time.");

  let created = 0, updated = 0, variantsCount = 0;
  for (const [handle, productRows] of grouped) {
    const head = productRows.find((r) => get(r, "Title")) ?? productRows[0];
    const title = get(head, "Title");
    if (!title) continue;
    const images: ItemImage[] = [];
    const imageSet = new Set<string>();
    const optionsByName = new Map<string, string[]>();
    const variantMap = new Map<string, VariantInput>();
    for (const row of productRows) {
      const imageUrl = get(row, "Image Src");
      if (/^https?:\/\//i.test(imageUrl) && !imageSet.has(imageUrl)) {
        imageSet.add(imageUrl);
        images.push({ url: imageUrl, alt: get(row, "Image Alt Text") || title, type: "image" });
      }
      const optionValues: string[] = [];
      const optionNames: string[] = [];
      for (let i = 1; i <= 3; i++) {
        const name = get(row, `Option${i} Name`), val = get(row, `Option${i} Value`);
        if (!name || name.toLowerCase() === "title" || !val || val === "Default Title") continue;
        optionNames.push(name); optionValues.push(val);
        const values = optionsByName.get(name) ?? [];
        if (!values.includes(val)) values.push(val);
        optionsByName.set(name, values);
      }
      const price = money(get(row, "Variant Price"));
      const sku = get(row, "Variant SKU");
      const variantId = get(row, "Variant ID");
      const hasVariantData = price != null || sku || optionValues.length || get(row, "Variant Inventory Qty") || variantId;
      if (!hasVariantData) continue;
      const key = variantId || [optionValues.join(" / "), sku, String(price ?? "")].join("|");
      if (variantMap.has(key)) continue;
      const compareAt = money(get(row, "Variant Compare At Price"));
      const stockValue = number(get(row, "Variant Inventory Qty"));
      const grams = number(get(row, "Variant Grams"));
      variantMap.set(key, {
        title: optionValues.length ? optionValues.join(" / ") : "Default",
        optionValues,
        sku: sku || null,
        pricePaise: price ?? 0,
        compareAtPaise: compareAt && compareAt > (price ?? 0) ? compareAt : null,
        stock: stockValue == null ? null : Math.max(0, Math.round(stockValue)),
        weightGrams: grams == null ? null : Math.max(0, Math.round(grams)),
        imageUrl: imageUrlFor(row),
        sourceId: variantId ? `shopify-csv:${variantId}` : null,
      });
    }
    if (!variantMap.size) variantMap.set("default", { title: "Default", optionValues: [], sku: null, pricePaise: 0, compareAtPaise: null, stock: null });
    const statusValue = get(head, "Status").toLowerCase();
    const status: ItemInput["status"] = statusValue === "archived" ? "archived" : statusValue === "active" || (!statusValue && truth(get(head, "Published"))) ? "active" : "draft";
    const options: ItemOption[] = [...optionsByName].map(([name, values]) => ({ name, values }));
    const sourceId = `shopify-csv:${handle}`;
    const [bySource] = await db.select({ id: catalogItems.id }).from(catalogItems).where(and(eq(catalogItems.storeId, store.id), eq(catalogItems.sourceId, sourceId))).limit(1);
    const [byHandle] = bySource ? [undefined] : await db.select({ id: catalogItems.id, source: catalogItems.source }).from(catalogItems).where(and(eq(catalogItems.storeId, store.id), eq(catalogItems.handle, handle))).limit(1);
    const existing = bySource ?? (byHandle?.source === "shopify" ? byHandle : undefined);
    const input: ItemInput = {
      title, handle, descriptionHtml: get(head, "Body (HTML)"), status, vendor: get(head, "Vendor") || null,
      productType: get(head, "Type") || null, tags: csvTags(get(head, "Tags")), images,
      options, variants: [...variantMap.values()], categoryIds: [], seoTitle: get(head, "SEO Title") || null,
      seoDescription: get(head, "SEO Description") || null, kind: "store", source: "shopify", sourceId,
    };
    await saveItem(store, input, existing?.id);
    if (existing) updated++; else created++;
    variantsCount += input.variants.length;
  }
  return { created, updated, variants: variantsCount };
}

function imageUrlFor(row: CsvRow) {
  const url = get(row, "Variant Image");
  return /^https?:\/\//i.test(url) ? url : null;
}
