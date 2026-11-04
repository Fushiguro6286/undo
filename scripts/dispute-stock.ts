// Dispute stock (spec section 13): real Undo orders paid from sandbox buyer *accounts*, so the buyer can open a
// dispute on them in PayPal's Resolution Center (test-card pool orders can't be disputed).
//   links [n=5] [baseUrl]   creates n CONFIRMED Sky Blue tee orders and prints PayPal approval links. The human
//                           approves each as a sandbox buyer; PayPal returns to {baseUrl}/orders/approved, which captures.
//   claims [baseUrl]        files a claim on every paid stock order without one, through the hosted API:
//                           the first three "my agent bought this without asking" (BUYER fault, denied),
//                           the rest "wrong color" (MERCHANT fault, offers left open).
// Stock orders are flagged pool (judge mode), so the printed demo code on the sample photos is accepted.
// Usage: npx tsx --env-file=.env --env-file=.env.neon scripts/dispute-stock.ts links 5 https://undo-nu.vercel.app
import { readFileSync } from "node:fs";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { claims, intents, orders } from "../src/db/schema";
import { createCheckout } from "../src/intent/orders";
import { recordDelivery } from "../src/claims/claims";

const [mode = "links", ...rest] = process.argv.slice(2);
const STOCK = "dispute-stock";

if (mode === "links") {
  const n = Number(rest[0] ?? 5);
  const base = (rest[1] ?? "https://undo-nu.vercel.app").replace(/\/$/, "");
  const limits = { item: "tee", size: "M", color: "sky blue", max_price: "29.00", deadline: null };
  for (let i = 0; i < n; i++) {
    const o = await createCheckout("CONFIRMED", STOCK, limits, [{ sku: "TEE-SKYBLUE-M", qty: 1 }], undefined, { returnUrl: `${base}/orders/approved`, cancelUrl: `${base}/orders/cancelled` });
    await db().update(orders).set({ pool: true }).where(eq(orders.paypalOrderId, o.orderId));
    console.log(`${i + 1}. ${o.approveUrl}`);
  }
} else if (mode === "claims") {
  const base = (rest[0] ?? "https://undo-nu.vercel.app").replace(/\/$/, "");
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  const stock = await db().select({ id: orders.paypalOrderId }).from(orders).innerJoin(intents, eq(orders.intentId, intents.id)).leftJoin(claims, eq(claims.orderId, orders.id))
    .where(and(eq(intents.buyerRef, STOCK), eq(orders.status, "COMPLETED"), isNull(claims.id))).orderBy(asc(orders.createdAt));
  const done = await db().select({ id: claims.id }).from(claims).innerJoin(orders, eq(claims.orderId, orders.id)).innerJoin(intents, eq(orders.intentId, intents.id)).where(eq(intents.buyerRef, STOCK));
  for (const [i, o] of stock.entries()) {
    const denial = done.length + i < 3;
    // The store ships first: a real tracker on the PayPal order and a merchant-reported delivery (proof of fulfillment).
    await recordDelivery(o.id, new Date());
    const c = await post("/api/claims", denial
      ? { orderId: o.id, type: "agent_mistake", description: "My agent bought this without asking me." }
      : { orderId: o.id, type: "wrong_item", description: "It came in navy, I ordered sky blue." });
    const form = new FormData();
    const photo = denial ? "correct-item.jpg" : "wrong-color.jpg";
    form.append("photo", new Blob([readFileSync(`public/samples/${photo}`)], { type: "image/jpeg" }), photo);
    const ev = await fetch(`${base}/api/claims/${c.claimId}/evidence`, { method: "POST", body: form }).then((r) => r.json());
    const deny = ev.offers?.find((x: { action: string }) => x.action === "DENY_WITH_REASON");
    const chosen = denial && deny ? await post(`/api/claims/${c.claimId}/choose`, { offer_id: deny.id }) : null;
    console.log(`${o.id}  claim ${c.claimId}  ${ev.faultParty ?? ev.error}  ${chosen ? chosen.claim?.status ?? chosen.error : ev.status ?? ""}`);
  }
  if (!stock.length) console.log("no paid stock orders without a claim (approve the links first)");
}
process.exit(0);
