// S10: an order with experience_context.return_url/cancel_url returns an approval link (for agents that can't render
// the JS SDK button). Prints the link rels; creates a sandbox order only, no money moves.
import { merchant } from "../../src/paypal/client";

const order = await merchant().request("POST", "/v2/checkout/orders", {
  requestId: `s10-${Date.now()}`,
  body: {
    intent: "CAPTURE",
    purchase_units: [{ amount: { currency_code: "USD", value: "1.00" } }],
    payment_source: { paypal: { experience_context: { brand_name: "Undo S10", user_action: "PAY_NOW", return_url: "https://undo-nu.vercel.app/orders/approved", cancel_url: "https://undo-nu.vercel.app/orders/cancelled" } } },
  },
});
console.log(order.status, order.id);
for (const l of order.links) console.log(`  ${l.rel} ${l.method} ${l.href}`);
const link = order.links.find((l: { rel: string }) => l.rel === "payer-action");
console.log(link ? "PASS payer-action link present" : "FAIL no payer-action link");
