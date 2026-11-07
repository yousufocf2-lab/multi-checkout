// Storefront URL scheme (Growpefy's own, not Shopify's):
//   every product  /products/all
//   a category     /category/<handle>
//   a product      /product/<handle>
// Old /collections/... and /products/<handle> links redirect here.

export const productPath = (root: string, handle: string) => `${root}/product/${handle}`;
export const categoryPath = (root: string, handle: string) => (handle === "all" ? `${root}/products/all` : `${root}/category/${handle}`);
export const allProductsPath = (root: string) => `${root}/products/all`;

/** The new path with the old request's query string kept (ad tracking like utm_* and fbclid survives the redirect). */
export function movedTo(request: Request, path: string) {
  const { search } = new URL(request.url);
  return path + search;
}
