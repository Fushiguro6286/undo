// Video prep (DEMO.md): sets up the state the six beats start from, on the deployment's database.
// - beat 2: reserves one paid $29 sky-blue tee pool order for Claude Desktop to claim on (judge runs can't take it);
// - beat 5: opens a claim on a $120 jacket pool order and uploads the navy-tee photo, stopping at OFFERED, so the
//   Studio agent can draft the full refund on camera.
// Beats 3 and 4 use the /judge buttons, which reserve their own orders. Run it shortly before recording.
// Usage: npx tsx --env-file=.env --env-file=.env.neon scripts/demo-prep.ts https://undo-nu.vercel.app
import { readFileSync } from "node:fs";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/db";
import { claims, intents, orders } from "../src/db/schema";
import { hit } from "../src/limits";

const base = (process.argv[2] ?? "https://undo-nu.vercel.app").replace(/\/$/, "");
const TEN_YEARS = 10 * 365 * 86_400;

/** An unused, unreserved judge-pool order of this amount, reserved the same way the /judge buttons reserve theirs. */
async function reserve(amount: string) {
  const rows = await db().select({ id: orders.paypalOrderId }).from(orders).innerJoin(intents, eq(orders.intentId, intents.id)).leftJoin(claims, eq(claims.orderId, orders.id))
    .where(and(eq(orders.pool, true), eq(intents.buyerRef, "judge-pool"), eq(orders.status, "COMPLETED"), eq(orders.amount, amount), isNull(claims.id),
      sql`not exists (select 1 from rate_limits r where r.key = 'pool-reserve:' || ${orders.paypalOrderId})`))
    .orderBy(desc(orders.createdAt)).limit(10);
  for (const r of rows) if ((await hit(`pool-reserve:${r.id}`, TEN_YEARS)).count === 1) return r.id;
  throw new Error(`no unused $${amount} pool order left: run npm run seed`);
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(base + path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${body.error ?? ""}`);
  return body;
}

const tee = await reserve("29.00");
const jacket = await reserve("120.00");
const c = await api("/api/claims", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orderId: jacket, type: "wrong_item", description: "I ordered the olive jacket and got a navy tee." }) });
const form = new FormData();
form.append("photo", new Blob([readFileSync("public/samples/wrong-color.jpg")], { type: "image/jpeg" }), "wrong-color.jpg");
const ev = await api(`/api/claims/${c.claimId}/evidence`, { method: "POST", body: form });
const keep = ev.offers?.find((o: { action: string }) => o.action === "PARTIAL_REFUND_KEEP_ITEM");

console.log(`beat 2 tee order (for Claude Desktop): ${tee}`);
console.log(`beat 5 jacket claim: ${c.claimId} on order ${jacket}: ${ev.faultParty} ${ev.status}, keep-it offer $${keep?.amount ?? "?"}`);
if (ev.status !== "OFFERED" || ev.faultParty !== "MERCHANT" || keep?.amount !== "36.00") {
  console.log("WARNING: beat 5 is not in the expected state (MERCHANT, OFFERED, keep-it $36). Check the claim page before recording.");
  process.exit(1);
}
process.exit(0);
