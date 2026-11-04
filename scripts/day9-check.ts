// Day 9 done-when, with real sandbox money:
//   1. Scenario 5: a DELEGATED order where the agent bought size L although the limits said M -> AGENT ->
//      the agent platform's payout lands in the buyer's sandbox account (PayPal reports the item SUCCESS).
//   2. A disputed capture is never refunded: the money router refuses a refund on a capture with an open
//      PayPal dispute before any refund call (capture 1LN39240P80983735 has dispute PP-R-BQG-10194997, spike S8).
// Uses one unused DELEGATED pool order (scripts/seed-order-pool.ts 1 TEE-SKYBLUE-M delegated). Needs JUDGE_MODE=true.
// Usage: npx tsx --env-file=.env --env-file=.env.neon scripts/day9-check.ts [baseUrl] [disputedCaptureId]
import { readFileSync } from "node:fs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { claims, orders } from "../src/db/schema";
import { openDisputes } from "../src/disputes/check";
import { DisputedCaptureError, refundCapture } from "../src/money/router";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const DISPUTED = process.argv[3] ?? "1LN39240P80983735";
let failed = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail ? `  ${detail}` : ""}`);
};
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
console.log(`base ${BASE}`);

// 1. Scenario 5
const [order] = await db().select({ id: orders.paypalOrderId }).from(orders).leftJoin(claims, eq(claims.orderId, orders.id))
  .where(and(eq(orders.pool, true), eq(orders.status, "AUTHORIZED"), eq(orders.paypalIntent, "AUTHORIZE"), isNull(claims.id)))
  .orderBy(desc(orders.createdAt)).limit(1);
if (!order) throw new Error("no unused DELEGATED pool order: run scripts/seed-order-pool.ts 1 TEE-SKYBLUE-M delegated");
const t0 = Date.now();
const f = await api(`/api/delegated/${order.id}/fulfill`, post({ sku: "TEE-SKYBLUE-L" }));
check(f.status === 200 && f.body.amount === "29.00", "agent picks Sky Blue L inside the $29 ceiling; captured", `${order.id} ${f.body.status} ${JSON.stringify(f.body.chosenItem?.limit_violations ?? f.body.error)}`);
const open = await api("/api/claims", post({ orderId: order.id, type: "agent_mistake", description: "I asked for size M. My agent bought an L." }));
const form = new FormData();
form.append("photo", new Blob([readFileSync("public/samples/wrong-size.jpg")], { type: "image/jpeg" }), "wrong-size.jpg");
const ev = await api(`/api/claims/${open.body.claimId}/evidence`, { method: "POST", body: form });
check(ev.body.faultParty === "AGENT", "photo matches the order (L); the agent broke the limits -> AGENT", `${ev.body.faultParty} ${JSON.stringify(ev.body.reasons?.map((r: { code: string }) => r.code))}`);
const c = await api(`/api/claims/${open.body.claimId}`);
const payoutOffer = c.body.offers?.find((o: { action: string }) => o.action === "AGENT_PLATFORM_PAYOUT");
const pick = await api(`/api/claims/${open.body.claimId}/choose`, post({ offer_id: payoutOffer?.id }));
check(pick.body.result?.status === "PAYOUT_SENT", "buyer picks the agent platform payout; Payouts call sent", pick.body.error ?? `batch ${pick.body.result?.payout?.payoutBatchId} $${pick.body.result?.payout?.amount}`);
let secs: number | null = null;
for (let i = 0; i < 36 && secs === null; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const s = await api(`/api/claims/${open.body.claimId}`); // claim reads also run the payout/dispute poll (at most once a minute)
  if (s.body.status === "RESOLVED") secs = Math.round((Date.now() - t0) / 1000);
  if (s.body.status === "PAYOUT_FAILED") break;
}
check(secs !== null, "PayPal reports the payout to the buyer's sandbox account as SUCCESS", secs === null ? "not settled" : `${secs}s from the agent's purchase`);

// 2. Disputed capture
const ids = await openDisputes(DISPUTED);
check(ids.length > 0, "the test capture has an open PayPal dispute", `${DISPUTED}: ${ids.join(", ") || "none"}`);
const err = await refundCapture({ claimId: "00000000-0000-4000-8000-000000000009", captureId: DISPUTED, amount: "1.00", action: "DAY9_DISPUTE_GUARD", version: 1 }).catch((e) => e);
check(err instanceof DisputedCaptureError && err.source === "DISPUTE_CHECK", "money router refuses to refund the disputed capture (no refund call made)", String(err?.message ?? err));

console.log(failed ? `${failed} FAILED` : "DAY 9: ALL PASS");
process.exit(failed ? 1 : 0);
