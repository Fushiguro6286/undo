import { eq } from "drizzle-orm";
import { db } from "@/src/db";
import { orders } from "@/src/db/schema";
import { verifyWebhook } from "@/src/paypal/webhooks";
import { confirmRefund, refreshPayout } from "@/src/claims/resolve";
import { syncDispute } from "@/src/disputes/sync";

// Only verified events are acted on. Handlers are idempotent: PayPal retries deliveries.
export async function POST(req: Request) {
  const raw = await req.text();
  let event;
  try {
    const v = await verifyWebhook(req.headers, raw);
    console.log(`[webhook] ${v.event.event_type} ${v.event.id} verified=${v.verified}`);
    if (!v.verified) return Response.json({ verified: false }, { status: 400 });
    event = v.event;
  } catch (e) {
    console.error("[webhook] verification error:", (e as Error).message);
    return Response.json({ verified: false }, { status: 400 });
  }

  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const capture = event.resource;
    const orderId = capture?.supplementary_data?.related_ids?.order_id;
    if (orderId) {
      // Confirms what the approve/fulfill call already recorded, and fills it in if that call never finished.
      const [o] = await db().select().from(orders).where(eq(orders.paypalOrderId, orderId));
      if (o && (o.status !== "COMPLETED" || !o.captureId)) {
        await db().update(orders).set({ status: "COMPLETED", captureId: o.captureId ?? capture.id, amount: o.amount ?? capture.amount?.value }).where(eq(orders.id, o.id));
      }
    }
  }
  if (event.event_type === "PAYMENT.CAPTURE.REFUNDED" && event.resource?.id) {
    const done = await confirmRefund(event.resource.id); // resource is the refund
    if (done) console.log(`[webhook] refund ${event.resource.id} confirmed for claim ${done.claimId} after ${done.secondsFromClaim}s`);
  }
  if (event.event_type?.startsWith("CUSTOMER.DISPUTE.") && event.resource?.dispute_id) {
    const d = await syncDispute(event.resource.dispute_id);
    console.log(`[webhook] dispute ${d.id} ${d.status} claim ${d.claimId ?? "-"}`);
  }
  if (event.event_type?.startsWith("PAYMENT.PAYOUTS")) {
    // Item events carry payout_batch_id; batch events carry batch_header. The status is re-read from PayPal.
    const batchId = event.resource?.payout_batch_id ?? event.resource?.batch_header?.payout_batch_id;
    const done = batchId ? await refreshPayout(batchId) : null;
    if (done) console.log(`[webhook] payout ${batchId} ${done.itemStatus} for claim ${done.claimId} after ${done.secondsFromClaim}s`);
  }
  return Response.json({ verified: true });
}
