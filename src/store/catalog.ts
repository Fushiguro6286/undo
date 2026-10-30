// The fictional demo store (invented brand, no real products). Prices are PayPal-style decimal strings.

export const STORE_NAME = "Fernleaf Goods";
export const PROMISE_DAYS = 3; // promised_by = capture time + 3 days

export type Product = { id: string; type: string; name: string; price: string; colors: string[]; sizes: string[] };
export type Variant = { sku: string; productId: string; type: string; name: string; color: string; size: string; price: string };

export const PRODUCTS: Product[] = [
  { id: "TEE", type: "tee", name: "Classic Tee", price: "29.00", colors: ["Sky Blue", "Navy", "White"], sizes: ["S", "M", "L"] },
  { id: "HOODIE", type: "hoodie", name: "Trail Hoodie", price: "54.00", colors: ["Heather Grey", "Forest"], sizes: ["S", "M", "L"] },
  { id: "JACKET", type: "jacket", name: "Field Jacket", price: "120.00", colors: ["Olive", "Black"], sizes: ["S", "M", "L"] },
  { id: "SHIRT", type: "shirt", name: "Linen Shirt", price: "46.00", colors: ["White", "Sand"], sizes: ["S", "M", "L"] },
  { id: "SOCKS", type: "socks", name: "Running Socks 3-Pack", price: "14.00", colors: ["White", "Black"], sizes: ["S", "M", "L"] },
  { id: "BEANIE", type: "beanie", name: "Wool Beanie", price: "18.00", colors: ["Rust", "Charcoal"], sizes: ["One Size"] },
  { id: "TOTE", type: "tote", name: "Canvas Tote", price: "22.00", colors: ["Natural", "Black"], sizes: ["One Size"] },
];

const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "");
export const skuOf = (productId: string, color: string, size: string) => `${productId}-${slug(color)}-${slug(size)}`;

export const VARIANTS: Variant[] = PRODUCTS.flatMap((p) =>
  p.colors.flatMap((color) =>
    p.sizes.map((size) => ({ sku: skuOf(p.id, color, size), productId: p.id, type: p.type, name: p.name, color, size, price: p.price })),
  ),
);

export const variantBySku = (sku: string) => VARIANTS.find((v) => v.sku === sku);

/** The PayPal item name: product, color and size, e.g. "Classic Tee, Sky Blue, M". */
export const itemName = (v: Variant) => (v.size === "One Size" ? `${v.name}, ${v.color}` : `${v.name}, ${v.color}, ${v.size}`);

export const promisedBy = (from: Date) => new Date(from.getTime() + PROMISE_DAYS * 86_400_000);
