import { verifyWebhook } from "@/src/paypal/webhooks";

// Day 1: verify and log only (spike S9). Event handling arrives on Day 2.
export async function POST(req: Request) {
  const raw = await req.text();
  try {
    const { verified, event } = await verifyWebhook(req.headers, raw);
    console.log(`[webhook] ${event.event_type} ${event.id} verified=${verified}`);
    return Response.json({ verified }, { status: verified ? 200 : 400 });
  } catch (e) {
    console.error("[webhook] verification error:", (e as Error).message);
    return Response.json({ verified: false }, { status: 400 });
  }
}
