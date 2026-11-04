// Prints each dispute-stock order's capture id (PayPal's "transaction ID") and capture time, for opening disputes by hand.
import { merchant } from "../../src/paypal/client";
const ids = ["87C6370574184652L", "0UN368672A368253J", "7XM09478HB9689439", "43H316913N2392135", "05J60903RB2842132"];
for (const [i, id] of ids.entries()) {
  const o = await merchant().request("GET", `/v2/checkout/orders/${id}`);
  const c = o.purchase_units?.[0]?.payments?.captures?.[0];
  console.log(`${i + 1}. order ${id}  transaction ${c?.id}  ${c?.create_time}  ${c?.amount?.value} ${c?.status}`);
}
process.exit(0);
