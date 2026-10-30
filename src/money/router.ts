// The money router: the ONLY code that calls PayPal money endpoints. No LLM ever reaches these functions.
// Every call sends a PayPal-Request-Id, so a retry returns the original result instead of moving money twice.
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
