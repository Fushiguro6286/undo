// Adds judge-mode pool orders by hand (`npm run seed` tops the pool up to its targets).
// Usage: npm run spike scripts/seed-order-pool.ts [count=1] [sku=TEE-SKYBLUE-M] [delegated]
import { createPoolOrder } from "./pool";

const count = Number(process.argv[2] ?? 1);
const sku = process.argv[3] ?? "TEE-SKYBLUE-M";
const delegated = process.argv[4] === "delegated";
for (let i = 0; i < count; i++) {
  const { orderId, price } = await createPoolOrder(sku, delegated);
  console.log(`pool order ${orderId} (${delegated ? `DELEGATED, limits from ${sku}, ceiling` : sku}, $${price})`);
}
process.exit(0);
