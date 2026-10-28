// S4: partial refund with PayPal-Request-Id, retry with the same id -> no double refund.
// Usage: npm run spike scripts/spikes/s4-refund-idempotency.ts [captureId] [orderId]   (defaults to S7, then S2 output)
import { fail, load, merchant, pass, spike, usd } from "./_lib";

await spike("S4", async () => {
  const pp = merchant();
  const src = load("s7") ?? load("s2");
  const captureId = process.argv[2] ?? src?.captureId;
  const orderId = process.argv[3] ?? src?.orderId;
  if (!captureId || !orderId) throw new Error("no capture: run S7 or S2 first, or pass <captureId> <orderId>");
  const countRefunds = async () => ((await pp.request("GET", `/v2/checkout/orders/${orderId}`)).purchase_units[0].payments?.refunds ?? []).length;
  const before = await countRefunds();
  const requestId = `spike-s4:refund:${Date.now()}`;
  const body = { amount: usd("1.00"), note_to_payer: "Undo spike S4" };
  const r1 = await pp.request("POST", `/v2/payments/captures/${captureId}/refund`, { requestId, body });
  const r2 = await pp.request("POST", `/v2/payments/captures/${captureId}/refund`, { requestId, body });
  const after = await countRefunds();
  const ids = { captureId, requestId, refund1: r1.id, refund2: r2.id, refundsBefore: before, refundsAfter: after };
  if (r1.id === r2.id && after === before + 1) pass("S4", "retry with the same PayPal-Request-Id returned the same refund; one refund recorded", ids);
  else fail("S4", "retry produced a second refund or a different id", ids);
});
