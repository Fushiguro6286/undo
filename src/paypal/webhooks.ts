import { merchant } from "./client";

/** Verifies a webhook with PayPal's verify-webhook-signature API. `rawBody` is the exact request body. */
export async function verifyWebhook(headers: Headers, rawBody: string) {
  const event = JSON.parse(rawBody);
  const h = (name: string) => headers.get(name) ?? "";
  const res = await merchant().request<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    body: {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: process.env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    },
  });
  return { verified: res.verification_status === "SUCCESS", event };
}
