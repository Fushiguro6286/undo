// Status of the 5 dispute-stock orders on PayPal and of synced disputes. Usage: npx tsx --env-file=.env --env-file=.env.neon scripts/spikes/stock-status.ts
import { db } from "../../src/db";
import { disputes } from "../../src/db/schema";
import { pollPayPal } from "../../src/disputes/sync";
import { merchant } from "../../src/paypal/client";

for (const id of ["87C6370574184652L", "0UN368672A368253J", "7XM09478HB9689439", "43H316913N2392135", "05J60903RB2842132"]) {
  const o = await merchant().request("GET", `/v2/checkout/orders/${id}`);
  console.log(`order ${id}: ${o.status}`);
}
await pollPayPal().catch((e) => console.log("poll failed:", (e as Error).message));
for (const d of await db().select().from(disputes)) console.log(`dispute ${d.paypalDisputeId}: ${d.stage} ${d.status} used=${d.used} claim=${d.claimId ?? "-"}`);
process.exit(0);
