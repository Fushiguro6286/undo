// Checkpoint A (Day 5), through the HTTP API with real sandbox money:
//   scenario 1: wrong color -> MERCHANT -> keep-it refund lands (and a retry never pays twice)
//   scenario 6: changed mind on a CONFIRMED order -> BUYER -> denied with the Escalate to PayPal link
//   scenario 11: a refund larger than the capture -> BLOCK
// Uses three unused $29 tee pool orders (scripts/seed-order-pool.ts). Needs JUDGE_MODE=true on the server.
// Usage: npm run spike scripts/checkpoint-a.ts [baseUrl]   (default http://localhost:3000)
import { readFileSync } from "node:fs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { claims, orders } from "../src/db/schema";
import { refundCapture } from "../src/money/router";
import { merchant } from "../src/paypal/client";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const KEY = { "x-merchant-key": process.env.JUDGE_LOGIN_PASSWORD ?? "" };
let failed = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail ? `  ${detail}` : ""}`);
};

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const json = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

async function claimWithPhoto(orderId: string, type: string, photo: string) {
  const open = await api("/api/claims", json({ orderId, type, description: "checkpoint A" }));
  if (open.status !== 200) throw new Error(`open claim: ${JSON.stringify(open.body)}`);
  const form = new FormData();
  form.append("photo", new Blob([readFileSync(`public/samples/${photo}`)], { type: "image/jpeg" }), photo);
  const ev = await api(`/api/claims/${open.body.claimId}/evidence`, { method: "POST", body: form });
  if (ev.status !== 200) throw new Error(`evidence: ${JSON.stringify(ev.body)}`);
  return ev.body;
}

// Unused pool tee orders: captured, $29, no claim yet.
const pool = await db()
  .select({ id: orders.paypalOrderId, captureId: orders.captureId }).from(orders).leftJoin(claims, eq(claims.orderId, orders.id))
  .where(and(eq(orders.pool, true), eq(orders.status, "COMPLETED"), eq(orders.amount, "29.00"), isNull(claims.id)))
  .orderBy(desc(orders.createdAt)).limit(3);
if (pool.length < 3) throw new Error(`need 3 unused $29 pool orders, found ${pool.length}: run scripts/seed-order-pool.ts 3 TEE-SKYBLUE-M`);
console.log(`base ${BASE}; orders ${pool.map((p) => p.id).join(", ")}`);

// Scenario 1
const t0 = Date.now();
const c1 = await claimWithPhoto(pool[0].id, "wrong_item", "wrong-color.jpg");
const keep = c1.offers?.find((o: { action: string }) => o.action === "PARTIAL_REFUND_KEEP_ITEM");
check(c1.faultParty === "MERCHANT", "#1 fault MERCHANT", `${c1.faultParty} ${c1.reasons?.map((r: { code: string }) => r.code)}`);
check(keep?.amount === "8.70" && keep?.explanation?.verdict === "ALLOW", "#1 keep-it offer $8.70, auto-approved", `${keep?.amount} ${keep?.explanation?.verdict} (${keep?.explanation?.source} explanation)`);
const chose = await api(`/api/claims/${c1.id}/choose`, json({ offer_id: keep.id }));
const refund = chose.body.result?.refund;
check(chose.status === 200 && chose.body.result?.status === "REFUND_SENT", "#1 refund sent", `${refund?.refundId} ${refund?.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s from claim`);
const again = await api(`/api/claims/${c1.id}/choose`, json({ offer_id: keep.id }));
check(again.status === 400, "#1 second choice refused", again.body.error);
// The money router itself, retried with the same claim/action/version: PayPal must return the same refund.
const retry = await refundCapture({ claimId: c1.id, captureId: pool[0].captureId!, amount: "8.70", action: "PARTIAL_REFUND_KEEP_ITEM", version: 1 });
check(retry.refundId === refund?.refundId, "#1 retried refund returns the same PayPal refund", `${retry.refundId}`);
const order = await merchant().request("GET", `/v2/checkout/orders/${pool[0].id}`);
const refunds = order.purchase_units[0].payments.refunds ?? [];
check(refunds.length === 1 && refunds[0].amount.value === "8.70", "#1 PayPal shows exactly one $8.70 refund", `${refunds.length} refund(s)`);
let resolved = false;
for (let i = 0; i < 30 && !resolved; i++) {
  resolved = (await api(`/api/claims/${c1.id}`)).body.status === "RESOLVED";
  if (!resolved) await new Promise((r) => setTimeout(r, 2000));
}
console.log(`${resolved ? "PASS" : "INFO"} #1 PAYMENT.CAPTURE.REFUNDED webhook ${resolved ? `confirmed it (${((Date.now() - t0) / 1000).toFixed(1)}s from claim)` : "not received within 60s (expected locally: webhooks need the hosted URL)"}`);

// Scenario 6
const c6 = await claimWithPhoto(pool[1].id, "changed_mind", "correct-item.jpg");
check(c6.faultParty === "BUYER", "#6 fault BUYER", `${c6.reasons?.map((r: { code: string }) => r.code)}`);
const actions6 = c6.offers?.map((o: { action: string }) => o.action) ?? [];
check(actions6.includes("DENY_WITH_REASON") && actions6.includes("ESCALATE_TO_PAYPAL"), "#6 denial offered with Escalate to PayPal", actions6.join(", "));
const deny = await api(`/api/claims/${c6.id}/choose`, json({ offer_id: c6.offers.find((o: { action: string }) => o.action === "DENY_WITH_REASON").id }));
check(deny.body.result?.status === "DENIED" && !!deny.body.result?.escalateUrl, "#6 denied, escalate link returned", deny.body.result?.escalateUrl);

// Scenario 11
const c11 = await claimWithPhoto(pool[2].id, "wrong_item", "wrong-color.jpg");
const big = await api(`/api/merchant/claims/${c11.id}/propose`, json({ action: "REFUND_ON_RETURN", amount: "40.00" }, KEY));
check(big.body.verdict === "BLOCK" && big.body.reasons?.includes("OVER_CAPTURE"), "#11 $40 refund on a $29 capture blocked", `${big.body.verdict} ${big.body.reasons}`);

const audit = await api("/api/audit/verify");
check(audit.body.ok === true, "audit chain verifies", `${audit.body.count} events`);
console.log(failed ? `${failed} FAILED` : "CHECKPOINT A: ALL PASS");
process.exit(failed ? 1 : 0);
