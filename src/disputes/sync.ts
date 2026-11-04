// Keeps the disputes table in step with PayPal (webhooks plus polling; sandbox disputes can arrive late, and the
// list lags at first, so known open ids are re-fetched too: spike S8). An open dispute on a claim's capture puts
// the claim in the approval queue as "respond in PayPal". Pending agent payouts are settled on the same poll.
import { after } from "next/server";
import { desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { claims, disputes, orders } from "../db/schema";
import { merchant } from "../paypal/client";
import { pendingPayoutBatches, refreshPayout, respondInPayPal } from "../claims/resolve";

/** Fetches one dispute, stores its stage and status, links it to the latest claim on its capture. */
export async function syncDispute(id: string) {
  const d = await merchant().request("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`);
  const captureIds: string[] = (d.disputed_transactions ?? []).map((t: { seller_transaction_id?: string }) => t.seller_transaction_id).filter(Boolean);
  const [claim] = captureIds.length
    ? await db().select({ id: claims.id }).from(claims).innerJoin(orders, eq(claims.orderId, orders.id)).where(inArray(orders.captureId, captureIds)).orderBy(desc(claims.createdAt)).limit(1)
    : [];
  const row = { stage: d.dispute_life_cycle_stage ?? null, status: d.status ?? null, lastPolled: new Date() };
  await db().insert(disputes).values({ paypalDisputeId: id, claimId: claim?.id ?? null, ...row })
    .onConflictDoUpdate({ target: disputes.paypalDisputeId, set: { ...row, claimId: sql`coalesce(${disputes.claimId}, excluded.claim_id)` } });
  if (claim && d.status !== "RESOLVED") await respondInPayPal(claim.id, { disputeIds: [id], source: "DISPUTE_SYNC" });
  return { id, status: d.status as string, claimId: claim?.id ?? null };
}

/** One poll: every dispute PayPal lists plus every known open one, then every unsettled payout. */
export async function pollPayPal() {
  const list = await merchant().request("GET", "/v1/customer/disputes?page_size=50");
  const known = await db().select({ id: disputes.paypalDisputeId }).from(disputes).where(ne(disputes.status, "RESOLVED"));
  const ids = new Set<string>([...(list?.items ?? []).map((i: { dispute_id: string }) => i.dispute_id), ...known.map((k) => k.id)]);
  for (const id of ids) await syncDispute(id);
  for (const batchId of await pendingPayoutBatches()) await refreshPayout(batchId);
  return { disputes: ids.size };
}

let lastPoll = 0;

/**
 * Polls at most once a minute, after the response is sent. Called from the console and claim reads.
 * shortcut: Vercel Hobby only runs daily crons, so polling rides on page traffic (the console refreshes every 20 s);
 * webhooks cover the rest. Move to a per-minute cron on a paid plan.
 */
export function pollSoon() {
  if (Date.now() - lastPoll < 60_000) return;
  lastPoll = Date.now();
  after(() => pollPayPal().catch((e) => console.error("[poll]", (e as Error).message)));
}
