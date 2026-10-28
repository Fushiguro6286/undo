// S7: capture with nobody at the PayPal page, using a published sandbox test card
// (developer.paypal.com/api/rest/sandbox/card-testing/). Tries intent CAPTURE, then the documented
// AUTHORIZE -> capture flow. The result decides how the order pool is funded.
import { fail, merchant, pass, save, sha256, spike, usd } from "./_lib";

const card = { name: "Undo Pool", number: "4012000033330026", expiry: "2030-12", security_code: "123" };
const hash = sha256(`s7-${Date.now()}`);
const orderBody = (intent: "CAPTURE" | "AUTHORIZE") => ({
  intent,
  purchase_units: [
    {
      custom_id: hash,
      amount: { ...usd("29.00"), breakdown: { item_total: usd("29.00") } },
      items: [{ name: "Classic Tee, Navy, M", sku: "TEE-NAVY-M", quantity: "1", unit_amount: usd("29.00"), category: "PHYSICAL_GOODS" }],
    },
  ],
  payment_source: { card },
});

await spike("S7", async () => {
  const pp = merchant();
  try {
    const o = await pp.request("POST", "/v2/checkout/orders", { requestId: `spike-s7-cap-${hash.slice(0, 16)}`, body: orderBody("CAPTURE") });
    console.log("CAPTURE order", o.id, o.status);
    const done = o.status === "COMPLETED" ? o : await pp.request("POST", `/v2/checkout/orders/${o.id}/capture`, { requestId: `spike-s7-capture-${o.id}` });
    const c = done.purchase_units[0].payments.captures[0];
    save("s7", { orderId: o.id, captureId: c.id, flow: "CAPTURE" });
    if (c.status === "COMPLETED") return pass("S7", "card order captured with no buyer interaction (intent CAPTURE)", { orderId: o.id, captureId: c.id });
    console.log("capture status", c.status);
  } catch (e) {
    console.log("CAPTURE flow failed:", (e as Error).message);
  }
  const o = await pp.request("POST", "/v2/checkout/orders", { requestId: `spike-s7-auth-${hash.slice(0, 16)}`, body: orderBody("AUTHORIZE") });
  console.log("AUTHORIZE order", o.id, o.status);
  const authorized = o.status === "COMPLETED" ? o : await pp.request("POST", `/v2/checkout/orders/${o.id}/authorize`, { requestId: `spike-s7-authorize-${o.id}` });
  const authId = authorized.purchase_units[0].payments.authorizations[0].id;
  const c = await pp.request("POST", `/v2/payments/authorizations/${authId}/capture`, { requestId: `spike-s7-authcap-${authId}`, body: { final_capture: true } });
  save("s7", { orderId: o.id, captureId: c.id, flow: "AUTHORIZE" });
  if (c.status === "COMPLETED") pass("S7", "card order captured with no buyer interaction (AUTHORIZE -> capture)", { orderId: o.id, authorizationId: authId, captureId: c.id });
  else fail("S7", `capture status ${c.status}`, { orderId: o.id, captureId: c.id });
});
