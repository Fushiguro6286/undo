import { agentPlatform, merchant } from "./client";

/** Payout events come from the agent platform's own webhook, so they are verified with that app and webhook id. */
export const isPayoutEvent = (type: string) => type.startsWith("PAYMENT.PAYOUTS");

/** Verifies a webhook with PayPal's verify-webhook-signature API. `rawBody` is the exact request body. */
export async function verifyWebhook(headers: Headers, rawBody: string) {
  const event = JSON.parse(rawBody);
  const payout = isPayoutEvent(String(event?.event_type ?? ""));
  const app = payout ? agentPlatform() : merchant();
  const webhookId = payout ? process.env.AGENT_PLATFORM_WEBHOOK_ID : process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return { verified: false, event };
  const h = (name: string) => headers.get(name) ?? "";
  const res = await app.request<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    body: {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: webhookId,
      webhook_event: event,
    },
  });
  return { verified: res.verification_status === "SUCCESS", event };
}
