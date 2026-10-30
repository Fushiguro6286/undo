import { eq } from "drizzle-orm";
import { db } from "@/src/db";
import { orders } from "@/src/db/schema";
import { verifyWebhook } from "@/src/paypal/webhooks";

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
  return Response.json({ verified: true });
}
