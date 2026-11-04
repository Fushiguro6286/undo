// Day 6 check: drives the MCP server like Claude Desktop would, over streamable HTTP.
// Lists the tools (exactly five; none confirms consent or moves money), proposes a purchase, gets a PayPal approval
// link, then on an unused $29 pool order: open_claim -> photo upload -> claim_status -> choose_remedy with an invented
// option id (rejected), an invented amount (rejected), then a real option.
// Usage: npm run spike scripts/mcp-check.ts [baseUrl]   (default http://localhost:3000)
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../src/db";
import { claims, orders } from "../src/db/schema";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
let failed = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail ? `  ${detail}` : ""}`);
};

const client = new Client({ name: "undo-mcp-check", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`)));
type Result = { isError?: boolean; content: { type: string; text: string }[] };
async function call(name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as Result;
  const t = r.content[0]?.text ?? "";
  let body: any = t;
  try { body = JSON.parse(t); } catch {}
  return { error: !!r.isError, body };
}

const tools = (await client.listTools()).tools.map((t) => t.name).sort();
check(JSON.stringify(tools) === JSON.stringify(["choose_remedy", "claim_status", "get_approval_link", "open_claim", "propose_purchase"]), "exactly the five spec tools", tools.join(", "));
check(!tools.some((t) => /confirm|approve|refund|capture|pay/i.test(t)), "no tool can confirm consent or move money");

const p = await call("propose_purchase", { request: "sky-blue tee, size M, under $35, by Friday" });
check(!p.error && p.body.limits?.size === "M" && p.body.matches?.some((m: { sku: string }) => m.sku === "TEE-SKYBLUE-M"), "propose_purchase extracts limits and finds the tee", p.error ? p.body : p.body.summary);

const link = await call("get_approval_link", { mode: "CONFIRMED", limits: p.body.limits, cart: [{ sku: "TEE-SKYBLUE-M", qty: 1 }] });
check(!link.error && /sandbox\.paypal\.com\/checkoutnow\?token=/.test(link.body.approval_url ?? ""), "get_approval_link returns PayPal's approval URL", link.error ? link.body : link.body.approval_url);
const dlink = await call("get_approval_link", { mode: "DELEGATED", limits: p.body.limits, agent_pick_sku: "TEE-SKYBLUE-L" });
check(!dlink.error && !!dlink.body.approval_url, "DELEGATED link with the agent's pick", dlink.error ? dlink.body : dlink.body.order_id);
const over = await call("get_approval_link", { mode: "DELEGATED", limits: p.body.limits, agent_pick_sku: "JACKET-OLIVE-M" });
check(over.error, "a pick above the ceiling is refused", over.body);

const [o] = await db()
  .select({ id: orders.paypalOrderId }).from(orders).leftJoin(claims, eq(claims.orderId, orders.id))
  .where(and(eq(orders.pool, true), eq(orders.status, "COMPLETED"), eq(orders.amount, "29.00"), isNull(claims.id)))
  .orderBy(desc(orders.createdAt)).limit(1);
if (!o) throw new Error("no unused $29 pool order: run scripts/seed-order-pool.ts 1 TEE-SKYBLUE-M");

const c = await call("open_claim", { order_id: o.id, type: "wrong_item", description: "It came in navy, I ordered sky blue." });
check(!c.error && /^UNDO-/.test(c.body.challenge_code) && !!c.body.upload_url, "open_claim returns a challenge code and upload link", c.error ? c.body : c.body.challenge_code);

// The person uploads the photo on the claim page (here: the same endpoint the page uses).
const form = new FormData();
form.append("photo", new Blob([readFileSync("public/samples/wrong-color.jpg")], { type: "image/jpeg" }), "wrong-color.jpg");
await fetch(`${BASE}/api/claims/${c.body.claim_id}/evidence`, { method: "POST", body: form });

const s = await call("claim_status", { claim_id: c.body.claim_id });
const keep = s.body.resolution_options?.find((r: { action: string }) => r.action === "PARTIAL_REFUND_KEEP_ITEM");
check(!s.error && s.body.fault?.party === "MERCHANT" && !!keep, "claim_status shows the ruling and rule-made options", s.error ? s.body : `${s.body.fault.party}; ${s.body.resolution_options.map((r: { action: string }) => r.action).join(", ")}`);

const fake = await call("choose_remedy", { claim_id: c.body.claim_id, option_id: "00000000-0000-4000-8000-000000000000" });
check(fake.error, "an invented option id is rejected", fake.body);
const fake2 = await call("choose_remedy", { claim_id: c.body.claim_id, option_id: "refund-everything" });
check(fake2.error, "a made-up option name is rejected", fake2.body);
const greedy = await call("choose_remedy", { claim_id: c.body.claim_id, option_id: keep.option_id, amount: "29.00" });
check(greedy.error, "an invented amount is rejected", greedy.body);
const ok = await call("choose_remedy", { claim_id: c.body.claim_id, option_id: keep.option_id, amount: keep.metadata.cost_impact.value });
check(!ok.error && ok.body.result?.status === "REFUND_SENT", "the real option goes through the policy and refunds", ok.error ? ok.body : `${ok.body.result.refund?.refundId} $${ok.body.result.refund?.amount}`);

await client.close();
console.log(failed ? `${failed} FAILED` : "MCP CHECK: ALL PASS");
process.exit(failed ? 1 : 0);
