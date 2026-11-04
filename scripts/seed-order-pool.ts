// Judge-mode order pool: real captured sandbox orders, paid with PayPal's published sandbox test card
// (developer.paypal.com/api/rest/sandbox/card-testing/; proven by spike S7), so no hand approvals are needed.
// Usage: npm run spike scripts/seed-order-pool.ts [count=1] [sku=TEE-SKYBLUE-M]
import { createCheckout } from "../src/intent/orders";
import { variantBySku } from "../src/store/catalog";

const count = Number(process.argv[2] ?? 1);
const sku = process.argv[3] ?? "TEE-SKYBLUE-M";
const v = variantBySku(sku);
if (!v) throw new Error(`unknown sku ${sku}`);
const card = { name: "Undo Pool", number: "4012000033330026", expiry: "2030-12", security_code: "123" };
const limits = { item: v.type, size: v.size === "One Size" ? null : v.size, color: v.color.toLowerCase(), max_price: v.price, deadline: null };

for (let i = 0; i < count; i++) {
  const { orderId } = await createCheckout("CONFIRMED", "judge-pool", limits, [{ sku, qty: 1 }], { card });
  console.log(`pool order ${orderId} (${sku}, $${v.price})`);
}
process.exit(0);
