// `npm run seed`: gets a deployment's database ready for judges (spec section 18).
// - The store catalog lives in code (src/store/catalog.ts); nothing to load.
// - Policy: shows the approved policy, or says the built-in default applies until the merchant approves one.
// - Order pool: tops judge-pool orders up to the targets below (real sandbox orders paid by the sandbox test card).
// - Disputes: warns when fewer than 5 unused open disputes are left (the human opens them; PayPal has no API for it).
// It cannot create sandbox accounts. Run `npm run db:migrate` first.
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { db } from "../src/db";
import { disputes, policies } from "../src/db/schema";
import { pollPayPal } from "../src/disputes/sync";
import { createPoolOrder } from "./pool";

const TARGETS = [
  { kind: "tee", sku: "TEE-SKYBLUE-M", delegated: false, want: 28 },
  { kind: "jacket", sku: "JACKET-OLIVE-M", delegated: false, want: 6 },
  { kind: "delegated", sku: "TEE-SKYBLUE-M", delegated: true, want: 6 },
] as const;
const MIN_DISPUTES = 5;

/** Unused judge-pool orders by kind: no claim yet and not reserved by a judge run. */
async function unused() {
  const { rows } = await db().execute<{ kind: string; n: number }>(sql`
    select case when o.paypal_intent = 'AUTHORIZE' then 'delegated' when o.amount = 120.00 then 'jacket' when o.amount = 29.00 then 'tee' else 'other' end as kind, count(*)::int as n
    from orders o join intents i on i.id = o.intent_id
    where o.pool and i.buyer_ref = 'judge-pool'
      and ((o.paypal_intent = 'AUTHORIZE' and o.status = 'AUTHORIZED') or (o.paypal_intent = 'CAPTURE' and o.status = 'COMPLETED'))
      and not exists (select 1 from claims c where c.order_id = o.id)
      and not exists (select 1 from rate_limits r where r.key = 'pool-reserve:' || o.paypal_order_id)
    group by 1`);
  return Object.fromEntries(rows.map((r) => [r.kind, Number(r.n)])) as Record<string, number>;
}

const [policy] = await db().select().from(policies).where(isNotNull(policies.approvedAt)).orderBy(desc(policies.version)).limit(1);
console.log(policy ? `policy: v${policy.version} approved ${policy.approvedAt!.toISOString()}` : "policy: none approved; the built-in default policy applies (approve one at /merchant/policy)");

const have = await unused();
let failed = 0;
for (const t of TARGETS) {
  const need = Math.max(0, t.want - (have[t.kind] ?? 0));
  console.log(`pool ${t.kind}: ${have[t.kind] ?? 0} unused, adding ${need}`);
  for (let i = 0; i < need; i++) {
    try {
      const { orderId } = await createPoolOrder(t.sku, t.delegated);
      console.log(`  + ${orderId}`);
    } catch (e) {
      failed++;
      console.error(`  ! ${(e as Error).message}`);
    }
  }
}
console.log("pool now:", await unused());

try {
  await pollPayPal();
} catch (e) {
  console.error(`disputes: PayPal poll failed (${(e as Error).message}); counting the ones already synced`);
}
const open = await db().select({ id: disputes.paypalDisputeId }).from(disputes).where(and(eq(disputes.used, false), ne(disputes.status, "RESOLVED")));
console.log(`disputes: ${open.length} unused and open${open.length < MIN_DISPUTES ? ` - WARNING: fewer than ${MIN_DISPUTES}; open more from sandbox buyer accounts (see README)` : ""}`);
process.exit(failed ? 1 : 0);
