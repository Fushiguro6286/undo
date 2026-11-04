// Checkpoint B (Day 8): demo beats 1, 2, 4 and 5 (spec section 19) on a running deployment, with real sandbox money.
//   beat 1: the buyer's agent (MCP) asks for the tee; PayPal's approval URL comes back and the order's custom_id
//           is the Intent Record hash (the PayPal approval itself is the human's click in Claude Desktop).
//   beat 2: wrong color through MCP -> MERCHANT -> the agent picks the keep-it refund -> PayPal confirms by webhook.
//   beat 4: "my agent bought this without asking me" on a CONFIRMED order -> BUYER, denied, Escalate to PayPal link.
//   beat 5: $120 jacket -> the Studio agent's $120 keep-it draft is blocked -> the policy amount ($36) is queued
//           -> the merchant approves it with one tap -> refund confirmed; the console shows the steps.
// Uses two unused $29 tee pool orders and one $120 jacket (scripts/seed-order-pool.ts). Needs JUDGE_MODE=true.
// Usage: npm run spike scripts/checkpoint-b.ts [baseUrl]   (default http://localhost:3000)
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { claims, intents, orders } from "../src/db/schema";
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
const post = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
async function upload(claimId: string, photo: string) {
  const form = new FormData();
  form.append("photo", new Blob([readFileSync(`public/samples/${photo}`)], { type: "image/jpeg" }), photo);
  return api(`/api/claims/${claimId}/evidence`, { method: "POST", body: form });
}
async function waitResolved(claimId: string, t0: number) {
  for (let i = 0; i < 40; i++) {
    const c = await api(`/api/claims/${claimId}`);
    if (c.body.status === "RESOLVED") return Math.round((Date.now() - t0) / 1000);
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}
const unused = (amount: string, n: number) =>
  db().select({ id: orders.paypalOrderId }).from(orders).leftJoin(claims, eq(claims.orderId, orders.id))
    .where(and(eq(orders.pool, true), eq(orders.status, "COMPLETED"), eq(orders.amount, amount), isNull(claims.id)))
    .orderBy(desc(orders.createdAt)).limit(n);

const tees = await unused("29.00", 2);
const [jacket] = await unused("120.00", 1);
if (tees.length < 2 || !jacket) throw new Error("need 2 unused $29 tees and 1 $120 jacket in the pool: run scripts/seed-order-pool.ts");
console.log(`base ${BASE}`);

const mcp = new Client({ name: "undo-checkpoint-b", version: "0.1.0" });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
async function tool(name: string, args: Record<string, unknown>) {
  const r = (await mcp.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  let body: any = r.content[0]?.text;
  try { body = JSON.parse(body); } catch {}
  return { error: !!r.isError, body };
}

// Beat 1
const p = await tool("propose_purchase", { request: "sky-blue tee, size M, under $35, by Friday" });
const link = await tool("get_approval_link", { mode: "CONFIRMED", limits: p.body.limits, cart: [{ sku: "TEE-SKYBLUE-M", qty: 1 }] });
check(!link.error && /sandbox\.paypal\.com\/checkoutnow\?token=/.test(link.body.approval_url ?? ""), "beat 1: MCP returns PayPal's approval URL", link.body.approval_url ?? JSON.stringify(link.body));
const [row] = await db().select({ hash: intents.hash }).from(orders).innerJoin(intents, eq(orders.intentId, intents.id)).where(eq(orders.paypalOrderId, link.body.order_id ?? ""));
const order = await merchant().request("GET", `/v2/checkout/orders/${link.body.order_id}`);
const pu = order.purchase_units?.[0];
check(!!row && pu?.custom_id === row.hash, "beat 1: PayPal order custom_id = Intent Record hash", `${pu?.custom_id?.slice(0, 16)}… item "${pu?.items?.[0]?.name}"`);

// Beat 2
const t2 = Date.now();
const c2 = await tool("open_claim", { order_id: tees[0].id, type: "wrong_item", description: "It came in navy, I ordered sky blue." });
const up2 = await upload(c2.body.claim_id, "wrong-color.jpg");
const s2 = await tool("claim_status", { claim_id: c2.body.claim_id });
const keep = s2.body.resolution_options?.find((r: { action: string }) => r.action === "PARTIAL_REFUND_KEEP_ITEM");
check(up2.status === 200 && s2.body.fault?.party === "MERCHANT" && (s2.body.resolution_options?.length ?? 0) >= 3, "beat 2: navy tee -> MERCHANT with rule-made offers", `${s2.body.fault?.party}; ${s2.body.resolution_options?.map((r: { action: string }) => r.action).join(", ")}`);
const pick = await tool("choose_remedy", { claim_id: c2.body.claim_id, option_id: keep?.option_id, amount: keep?.metadata?.cost_impact?.value });
check(!pick.error && pick.body.result?.status === "REFUND_SENT", "beat 2: the agent picks keep-it; refund sent", pick.error ? JSON.stringify(pick.body) : `${pick.body.result.refund?.refundId} $${pick.body.result.refund?.amount}`);
const secs2 = await waitResolved(c2.body.claim_id, t2);
check(secs2 !== null, "beat 2: PayPal confirmed the refund (webhook)", `${secs2}s from claim`);

// Beat 4
const c4 = await tool("open_claim", { order_id: tees[1].id, type: "agent_mistake", description: "My agent bought this without asking me." });
await upload(c4.body.claim_id, "correct-item.jpg");
const s4 = await tool("claim_status", { claim_id: c4.body.claim_id });
const deny = s4.body.resolution_options?.find((r: { action: string }) => r.action === "DENY_WITH_REASON");
const esc = s4.body.resolution_options?.find((r: { action: string }) => r.action === "ESCALATE_TO_PAYPAL");
check(s4.body.fault?.party === "BUYER" && JSON.stringify(s4.body.fault?.reasons ?? []).includes("CONFIRMED_CART_MATCHES") && s4.body.fault?.intent_hash_verified === true, "beat 4: BUYER, cart approved on PayPal, intent hash verified", `${s4.body.fault?.party} ${JSON.stringify(s4.body.fault?.reasons)}`);
check(!!deny && !!esc, "beat 4: denial comes with Escalate to PayPal", s4.body.resolution_options?.map((r: { action: string }) => r.action).join(", "));
const d4 = await tool("choose_remedy", { claim_id: c4.body.claim_id, option_id: deny?.option_id });
check(!d4.error && /DENIED/.test(JSON.stringify(d4.body)), "beat 4: claim denied", d4.error ? JSON.stringify(d4.body) : d4.body.claim?.status);
await mcp.close();

// Beat 5
const t5 = Date.now();
const open5 = await api("/api/claims", post({ orderId: jacket.id, type: "wrong_item", description: "I ordered the olive jacket and got a navy tee." }));
const ev5 = await upload(open5.body.claimId, "wrong-color.jpg");
check(ev5.body.faultParty === "MERCHANT", "beat 5: $120 jacket -> MERCHANT", ev5.body.faultParty);
const draft = await api(`/api/merchant/claims/${open5.body.claimId}/propose`, post({ action: "PARTIAL_REFUND_KEEP_ITEM", amount: "120.00", via: "studio_agent" }, KEY));
check(draft.body.verdict === "BLOCK" && draft.body.queued?.amount === "36.00", "beat 5: Studio agent's $120 draft blocked; $36 queued", `${draft.body.verdict} ${draft.body.reasons} -> ${draft.body.queued?.amount}`);
const tap = await api(`/api/merchant/approvals/${draft.body.queued?.approvalId}`, post({ decision: "approve" }, KEY));
check(tap.body.status === "REFUND_SENT", "beat 5: one tap approves $36", `${tap.body.refund?.refundId} $${tap.body.refund?.amount}`);
const secs5 = await waitResolved(open5.body.claimId, t5);
check(secs5 !== null, "beat 5: PayPal confirmed the refund (webhook)", `${secs5}s from claim`);
const con = await api("/api/merchant/console", { headers: KEY });
const steps = con.body.claims?.find((c: { id: string }) => c.id === open5.body.claimId)?.timeline?.map((e: { event: string }) => e.event) ?? [];
check(["PROPOSAL_BLOCKED", "PROPOSAL_QUEUED", "APPROVAL_APPROVED", "REFUND_SENT", "REFUND_CONFIRMED"].every((e) => steps.includes(e)) && con.body.audit?.ok, "beat 5: console timeline shows block -> queue -> approval -> PayPal; audit chain verified", `${steps.join(" > ")}; audit ${con.body.audit?.ok} (${con.body.audit?.count})`);

console.log(failed ? `${failed} FAILED` : "CHECKPOINT B: ALL PASS");
process.exit(failed ? 1 : 0);
