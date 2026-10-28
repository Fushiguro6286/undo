// S3: DELEGATED: AUTHORIZE order for a $35 ceiling -> buyer approves -> authorize -> capture $29 final_capture -> remainder released.
// Usage: npm run spike scripts/spikes/s3-delegated.ts [orderId]   (pass an existing order id to resume waiting on it)
import { fail, merchant, pass, returnUrls, save, sha256, spike, usd, waitForApproval } from "./_lib";

await spike("S3", async () => {
  const pp = merchant();
  const limits = "Agent purchase up to $35: blue tee, size M, by Fri";
  const hash = sha256(JSON.stringify({ mode: "DELEGATED", limits, spike: Date.now() }));
  const resumeId = process.argv[2];
  const order = resumeId ? await pp.request("GET", `/v2/checkout/orders/${resumeId}`) : await pp.request("POST", "/v2/checkout/orders", {
    requestId: `spike-s3-create-${hash.slice(0, 16)}`,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          custom_id: hash,
          description: limits,
          amount: { ...usd("35.00"), breakdown: { item_total: usd("35.00") } },
          items: [{ name: limits, sku: "AGENT-CEILING", quantity: "1", unit_amount: usd("35.00"), category: "PHYSICAL_GOODS" }],
        },
      ],
      payment_source: { paypal: { experience_context: { brand_name: "Fernleaf Goods (Undo demo)", user_action: "CONTINUE", ...returnUrls() } } },
    },
  });
  console.log(resumeId ? "resuming order" : "created order", order.id, order.status);
  if (order.status !== "APPROVED") await waitForApproval(pp, order);
  const auth = await pp.request("POST", `/v2/checkout/orders/${order.id}/authorize`, { requestId: `spike-s3-authorize-${order.id}` });
  const authorizationId = auth.purchase_units[0].payments.authorizations[0].id;
  const cap = await pp.request("POST", `/v2/payments/authorizations/${authorizationId}/capture`, {
    requestId: `spike-s3-capture-${authorizationId}`,
    body: { amount: usd("29.00"), final_capture: true },
  });
  const a = await pp.request("GET", `/v2/payments/authorizations/${authorizationId}`);
  // A second capture must be refused if the remainder was released.
  let secondCapture = "allowed (BAD)";
  try {
    await pp.request("POST", `/v2/payments/authorizations/${authorizationId}/capture`, { requestId: `spike-s3-capture2-${authorizationId}`, body: { amount: usd("1.00") } });
  } catch (e) {
    secondCapture = `refused: ${(e as Error).message}`;
  }
  save("s3", { orderId: order.id, authorizationId, captureId: cap.id });
  const ids = { orderId: order.id, authorizationId, captureId: cap.id, captureAmount: cap.amount?.value, captureStatus: cap.status, authorizationStatus: a.status, secondCapture };
  if (cap.amount?.value === "29.00" && !secondCapture.startsWith("allowed")) pass("S3", "captured $29 of $35 with final_capture; remainder no longer capturable", ids);
  else fail("S3", "unexpected capture result", ids);
});
