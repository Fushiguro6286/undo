// Dispute state of a capture. A dispute's seller_transaction_id is the capture id (spike S8).
import { merchant } from "../paypal/client";

/** Ids of the PayPal disputes on this capture that are not RESOLVED. */
export async function openDisputes(captureId: string): Promise<string[]> {
  const r = await merchant().request("GET", `/v1/customer/disputes?disputed_transaction_id=${encodeURIComponent(captureId)}`);
  return ((r?.items ?? []) as { dispute_id: string; status: string }[]).filter((d) => d.status !== "RESOLVED").map((d) => d.dispute_id);
}
