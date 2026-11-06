import type { LoaderFunctionArgs } from "@remix-run/node";
import { and, asc, eq } from "drizzle-orm";
import { catalogItems, catalogVariants, db } from "~/db.server";
import { requireStore, requireViewer } from "~/lib/auth.server";
import { catalogAllowed } from "~/lib/catalog.server";

const HEADERS = [
  "Handle", "Title", "Body (HTML)", "Vendor", "Type", "Tags", "Published", "Status",
  "Option1 Name", "Option1 Value", "Option2 Name", "Option2 Value", "Option3 Name", "Option3 Value",
  "Variant SKU", "Variant Grams", "Variant Inventory Tracker", "Variant Inventory Qty", "Variant Price", "Variant Compare At Price", "Variant Image",
  "Image Src", "Image Position", "Image Alt Text", "SEO Title", "SEO Description",
];
const quote = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const cash = (paise: number | null) => paise == null ? "" : (paise / 100).toFixed(2);

export async function loader({ request, params }: LoaderFunctionArgs) {
  const viewer = await requireViewer(request);
  const store = await requireStore(viewer, params.id);
  if (!catalogAllowed(viewer, store)) throw new Response("Not found", { status: 404 });
  const items = await db.select().from(catalogItems).where(eq(catalogItems.storeId, store.id)).orderBy(asc(catalogItems.id));
  const variants = items.length ? await db.select().from(catalogVariants).where(eq(catalogVariants.storeId, store.id)).orderBy(asc(catalogVariants.itemId), asc(catalogVariants.position)) : [];
  const byItem = new Map<number, typeof variants>();
  for (const variant of variants) byItem.set(variant.itemId, [...(byItem.get(variant.itemId) ?? []), variant]);
  const lines = [HEADERS.map(quote).join(",")];
  for (const item of items) {
    const productVariants = byItem.get(item.id) ?? [];
    const opts = item.options ?? [];
    const images = item.images ?? [];
    for (const [index, variant] of (productVariants.length ? productVariants : [null]).entries()) {
      const values = variant?.optionValues ?? [];
      const firstImage = images[0];
      lines.push([
        item.handle, item.title, item.descriptionHtml, item.vendor, item.productType, (item.tags ?? []).join(", "), item.status === "active" ? "TRUE" : "FALSE", item.status,
        opts[0]?.name, values[0], opts[1]?.name, values[1], opts[2]?.name, values[2],
        variant?.sku, variant?.weightGrams, variant?.stock == null ? "" : "shopify", variant?.stock, cash(variant?.pricePaise ?? null), cash(variant?.compareAtPaise ?? null), variant?.imageUrl,
        firstImage?.url, firstImage ? 1 : "", firstImage?.alt ?? item.title, item.seoTitle, item.seoDescription,
      ].map(quote).join(","));
      if (index === 0) for (const [imageIndex, image] of images.slice(1).entries()) {
        lines.push([item.handle, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", image.url, imageIndex + 2, image.alt ?? item.title, "", ""].map(quote).join(","));
      }
    }
  }
  return new Response(`\uFEFF${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="growpefy-products-${store.slug}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
