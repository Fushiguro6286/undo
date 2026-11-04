// The money router: the ONLY code that calls PayPal money endpoints. No LLM ever reaches these functions.
// Every call sends a PayPal-Request-Id, so a retry returns the original result instead of moving money twice.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { moneyActions, payouts } from "../db/schema";
import { openDisputes } from "../disputes/check";
import { agentPlatform, merchant, PayPalError } from "../paypal/client";
import { fromCents, toCents } from "./cents";

/** DELEGATED invariant: a capture never exceeds the ceiling the person approved. */
export function assertWithinCeiling(amount: string, ceiling: string) {
  if (toCents(amount) > toCents(ceiling)) throw new Error(`capture ${amount} exceeds the approved ceiling ${ceiling}`);
  if (toCents(amount) === 0) throw new Error("capture amount must be above zero");
}

/** CONFIRMED: capture the approved order. */
export async function captureOrder(paypalOrderId: string) {
  const res = await merchant().request("POST", `/v2/checkout/orders/${paypalOrderId}/capture`, { requestId: `${paypalOrderId}:capture` });
  const cap = res.purchase_units[0].payments.captures[0];
  return { captureId: cap.id as string, amount: cap.amount.value as string, status: cap.status as string, payerEmail: res.payer?.email_address as string | undefined };
}

/** DELEGATED step 1: authorize the approved ceiling (no money moves yet). */
export async function authorizeOrder(paypalOrderId: string) {
  const res = await merchant().request("POST", `/v2/checkout/orders/${paypalOrderId}/authorize`, { requestId: `${paypalOrderId}:authorize` });
  const auth = res.purchase_units[0].payments.authorizations[0];
  return { authorizationId: auth.id as string, amount: auth.amount.value as string, status: auth.status as string, payerEmail: res.payer?.email_address as string | undefined };
}

/** DELEGATED step 2: capture the actual price once, releasing the rest of the ceiling (final_capture). */
export async function captureAuthorization(authorizationId: string, amount: string, ceiling: string) {
  assertWithinCeiling(amount, ceiling);
  const value = fromCents(toCents(amount));
  const cap = await merchant().request("POST", `/v2/payments/authorizations/${authorizationId}/capture`, {
    requestId: `${authorizationId}:capture`,
    body: { amount: { currency_code: "USD", value }, final_capture: true },
  });
  return { captureId: cap.id as string, amount: cap.amount.value as string, status: cap.status as string };
}

/** `${claimId}:${action}:${version}`: the same claim, action and version always gets the same PayPal-Request-Id. */
export const moneyRequestId = (claimId: string, action: string, version: number) => `${claimId}:${action}:${version}`;

/** A disputed capture is answered in PayPal: Undo never refunds it. */
export class DisputedCaptureError extends Error {
  constructor(readonly captureId: string, readonly disputeIds: string[], readonly source: "DISPUTE_CHECK" | "TRANSACTION_DISPUTED") {
    super(`capture ${captureId} is disputed in PayPal (${source}); respond in PayPal instead of refunding`);
    this.name = "DisputedCaptureError";
  }
}

/**
 * Lane A: refund (part of) a capture. A retry with the same claim/action/version sends the same PayPal-Request-Id,
 * so PayPal returns the first refund instead of paying twice (spike S4). Confirmed later by PAYMENT.CAPTURE.REFUNDED.
 */
export async function refundCapture(r: { claimId: string; captureId: string; amount: string; action: string; version: number }) {
  const value = fromCents(toCents(r.amount));
  if (toCents(value) === 0) throw new Error("refund amount must be above zero");
  const requestId = moneyRequestId(r.claimId, r.action, r.version);
  // Check the dispute state before every refund; PayPal's TRANSACTION_DISPUTED below is the second guard.
  const disputes = await openDisputes(r.captureId);
  if (disputes.length) throw new DisputedCaptureError(r.captureId, disputes, "DISPUTE_CHECK");
  await db().insert(moneyActions).values({ claimId: r.claimId, lane: "A", kind: "refund", requestId, amount: value, status: "SENDING" }).onConflictDoNothing();
  try {
    const res = await merchant().request("POST", `/v2/payments/captures/${r.captureId}/refund`, {
      requestId,
      body: { amount: { currency_code: "USD", value }, note_to_payer: "Refund for your claim, decided by the store's return policy." },
    });
    await db().update(moneyActions).set({ paypalRef: res.id, status: res.status }).where(eq(moneyActions.requestId, requestId));
    return { refundId: res.id as string, status: res.status as string, amount: value, requestId };
  } catch (e) {
    await db().update(moneyActions).set({ status: "FAILED" }).where(eq(moneyActions.requestId, requestId));
    if (e instanceof PayPalError && e.issues.includes("TRANSACTION_DISPUTED")) throw new DisputedCaptureError(r.captureId, [], "TRANSACTION_DISPUTED");
    throw e;
  }
}

/**
 * Agent fault: the agent platform's account pays the buyer (Payouts). sender_batch_id and PayPal-Request-Id are both
 * the money request id: PayPal pays a sender_batch_id only once in 30 days (spike S6). Confirmed by webhook or polling.
 */
export async function payoutAgentFault(r: { claimId: string; receiver: string; amount: string; version: number }) {
  const value = fromCents(toCents(r.amount));
  if (toCents(value) === 0) throw new Error("payout amount must be above zero");
  const requestId = moneyRequestId(r.claimId, "AGENT_PLATFORM_PAYOUT", r.version);
  await db().insert(moneyActions).values({ claimId: r.claimId, lane: "A", kind: "payout", requestId, amount: value, status: "SENDING" }).onConflictDoNothing();
  try {
    const res = await agentPlatform().request("POST", "/v1/payments/payouts", {
      requestId,
      body: {
        sender_batch_header: { sender_batch_id: requestId, recipient_type: "EMAIL", email_subject: "Compensation from your shopping agent's platform", email_message: "Your agent bought outside the limits you approved, so its platform pays you back." },
        items: [{ recipient_type: "EMAIL", receiver: r.receiver, amount: { currency: "USD", value }, sender_item_id: requestId, note: "Agent-fault compensation, decided by Undo." }],
      },
    });
    const batchId = res.batch_header.payout_batch_id as string;
    const status = res.batch_header.batch_status as string;
    await db().update(moneyActions).set({ paypalRef: batchId, status }).where(eq(moneyActions.requestId, requestId));
    await db().insert(payouts).values({ claimId: r.claimId, payoutBatchId: batchId, amount: value, status }).onConflictDoNothing();
    return { payoutBatchId: batchId, status, amount: value, requestId };
  } catch (e) {
    await db().update(moneyActions).set({ status: "FAILED" }).where(eq(moneyActions.requestId, requestId));
    throw e;
  }
}

/**
 * Merchant at fault on a disputed capture: accept the buyer's claim in PayPal, which refunds them. Called only after
 * a person's tap. PayPal documents a multipart body with one optional file (accept-claim-document); the accepted
 * response options come from the dispute's allowed_response_options, so nothing else is sent.
 */
export async function acceptDisputeClaim(r: { claimId: string; disputeId: string; amount: string; version: number; acceptType: string; note: string }) {
  const requestId = moneyRequestId(r.claimId, "ACCEPT_DISPUTE_CLAIM", r.version);
  const value = fromCents(toCents(r.amount));
  await db().insert(moneyActions).values({ claimId: r.claimId, lane: "DISPUTE", kind: "refund", requestId, amount: value, status: "SENDING" }).onConflictDoNothing();
  try {
    // The live API refuses an empty body (400 MISSING_OR_INVALID_REQUEST_BODY, Nov 5); PayPal's reference docs take
    // JSON with a note and one of the dispute's allowed_response_options.accept_claim types.
    await merchant().request("POST", `/v1/customer/disputes/${encodeURIComponent(r.disputeId)}/accept-claim`, { requestId, body: { note: r.note.slice(0, 2000), accept_claim_type: r.acceptType } });
    await db().update(moneyActions).set({ paypalRef: r.disputeId, status: "ACCEPTED" }).where(eq(moneyActions.requestId, requestId));
    return { disputeId: r.disputeId, amount: value, requestId };
  } catch (e) {
    await db().update(moneyActions).set({ status: "FAILED" }).where(eq(moneyActions.requestId, requestId));
    throw e;
  }
}

/** The payout's item status (SUCCESS, PENDING, UNCLAIMED, FAILED, ...): read-only. */
export async function payoutItemStatus(batchId: string) {
  const res = await agentPlatform().request("GET", `/v1/payments/payouts/${encodeURIComponent(batchId)}`);
  return { batchStatus: res.batch_header.batch_status as string, itemStatus: (res.items?.[0]?.transaction_status ?? res.batch_header.batch_status) as string };
}
