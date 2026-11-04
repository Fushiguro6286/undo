// The money router: the ONLY code that calls PayPal money endpoints. No LLM ever reaches these functions.
// Every call sends a PayPal-Request-Id, so a retry returns the original result instead of moving money twice.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { moneyActions } from "../db/schema";
import { merchant } from "../paypal/client";
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

/**
 * Lane A: refund (part of) a capture. A retry with the same claim/action/version sends the same PayPal-Request-Id,
 * so PayPal returns the first refund instead of paying twice (spike S4). Confirmed later by PAYMENT.CAPTURE.REFUNDED.
 */
export async function refundCapture(r: { claimId: string; captureId: string; amount: string; action: string; version: number }) {
  const value = fromCents(toCents(r.amount));
  if (toCents(value) === 0) throw new Error("refund amount must be above zero");
  const requestId = moneyRequestId(r.claimId, r.action, r.version);
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
    throw e;
  }
}
