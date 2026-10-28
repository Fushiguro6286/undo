// S2: CONFIRMED order (items with size+color, custom_id = intent hash) -> buyer approves -> capture -> GET confirms custom_id.
// Usage: npm run spike scripts/spikes/s2-confirmed.ts [--resume]   (--resume waits on the last created order)
import { fail, load, merchant, pass, returnUrls, save, sha256, spike, usd, waitForApproval } from "./_lib";

await spike("S2", async () => {
  const pp = merchant();
  const pending = process.argv.includes("--resume") ? load("s2-pending") : undefined;
  const intent = { mode: "CONFIRMED", limits: { item: "tee", size: "M", color: "sky blue", max_price: "35.00" }, cart: [{ sku: "TEE-SKY-M", qty: 1 }], spike: Date.now() };
  const hash: string = pending?.hash ?? sha256(JSON.stringify(intent));
  const order = pending ? await pp.request("GET", `/v2/checkout/orders/${pending.orderId}`) : await pp.request("POST", "/v2/checkout/orders", {
    requestId: `spike-s2-create-${hash.slice(0, 16)}`,
    body: {
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: hash,
          description: "Undo spike S2 (CONFIRMED cart)",
          amount: { ...usd("29.00"), breakdown: { item_total: usd("29.00") } },
          items: [{ name: "Classic Tee, Sky Blue, M", sku: "TEE-SKY-M", quantity: "1", unit_amount: usd("29.00"), category: "PHYSICAL_GOODS" }],
        },
      ],
      payment_source: { paypal: { experience_context: { brand_name: "Fernleaf Goods (Undo demo)", user_action: "PAY_NOW", ...returnUrls() } } },
    },
  });
  save("s2-pending", { orderId: order.id, hash });
  console.log(pending ? "resuming order" : "created order", order.id, order.status);
  if (order.status !== "APPROVED") await waitForApproval(pp, order);
  const cap = await pp.request("POST", `/v2/checkout/orders/${order.id}/capture`, { requestId: `spike-s2-capture-${order.id}` });
  const captureId = cap.purchase_units[0].payments.captures[0].id;
  const got = await pp.request("GET", `/v2/checkout/orders/${order.id}`);
  const pu = got.purchase_units[0];
  save("s2", { orderId: order.id, captureId, hash });
  const ids = { orderId: order.id, captureId, status: got.status, itemName: pu.items?.[0]?.name };
  if (pu.custom_id === hash && got.status === "COMPLETED") pass("S2", "captured; GET order shows custom_id = intent hash", ids);
  else fail("S2", `custom_id mismatch or not completed (custom_id=${pu.custom_id})`, ids);
});
