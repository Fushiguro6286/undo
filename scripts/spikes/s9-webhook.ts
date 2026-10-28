// S9 (part 1): checks the merchant app's webhook points at the deployed /api/webhooks/paypal with the events Undo needs.
// Part 2 is a real event: run S2 (or S7) so PayPal sends PAYMENT.CAPTURE.COMPLETED, then look in the Render logs for
//   [webhook] PAYMENT.CAPTURE.COMPLETED WH-... verified=true
import { fail, merchant, pass, spike } from "./_lib";

const NEEDED = ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.REFUNDED", "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"];

await spike("S9", async () => {
  const id = process.env.PAYPAL_WEBHOOK_ID;
  if (!id) throw new Error("PAYPAL_WEBHOOK_ID is not set");
  const { webhooks = [] } = await merchant().request("GET", "/v1/notifications/webhooks");
  const wh = webhooks.find((w: any) => w.id === id);
  if (!wh) return fail("S9", "PAYPAL_WEBHOOK_ID not found on the merchant app", { known: webhooks.map((w: any) => w.id) });
  const types: string[] = wh.event_types.map((e: any) => e.name);
  const missing = types.includes("*") ? [] : NEEDED.filter((t) => !types.includes(t));
  const expectedUrl = `${process.env.APP_BASE_URL}/api/webhooks/paypal`;
  const ids = { webhookId: id, url: wh.url, missingEvents: missing };
  if (wh.url === expectedUrl && !missing.length) pass("S9", "webhook configured; now trigger a real event (S2/S7) and check Render logs for verified=true", ids);
  else fail("S9", `webhook url should be ${expectedUrl} and subscribe to ${NEEDED.join(", ")}`, ids);
});
