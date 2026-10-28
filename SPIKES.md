| S7 test-card capture, no buyer | `s7-card-capture.ts` | **PASS** (Oct 28) | order 41V33207CW8031431 created COMPLETED with intent CAPTURE, capture 5L624410YE142664Y | **order pool is funded by sandbox test card** (no hand approvals) || S6 payout from agent platform | `s6-payout.ts` | **PASS** (Oct 28) | batch V4TS9YYP47G42 SUCCESS; reused sender_batch_id → 400 USER_BUSINESS_ERROR | agent-fault payouts are live; use `sender_batch_id = ${claimId}:payout:${version}` as the duplicate guard || S4 refund idempotency | `s4-refund-idempotency.ts` | **PASS** (Oct 28) | capture 5L624410YE142664Y; both calls returned refund 22A59817TH8581016; refunds 0 → 1 | `PayPal-Request-Id` is a sufficient retry guard for refunds; keep `${claimId}:${action}:${version}` || S1 OAuth (merchant + agent platform) | `s1-oauth.ts` | **PASS** (Oct 28) | merchant APP-1PM15472RS0135816 (disputes scope ✓), agent platform APP-49M125667T230682S (payouts scope ✓) | none. Payouts scope name is `https://uri.paypal.com/payments/payouts` |# Spike results (Day 1)

Run each with `npm run spike scripts/spikes/<file>.ts`. Every script prints `PASS` or `FAIL` plus PayPal ids, never tokens.

| Spike | Script | Result | PayPal ids | Decision it forces |
|---|---|---|---|---|
| S1 OAuth (merchant + agent platform) | `s1-oauth.ts` | not run | | |
| S2 CONFIRMED + custom_id | `s2-confirmed.ts` | not run | | |
| S3 DELEGATED authorize → capture $29 of $35 | `s3-delegated.ts` | not run | | DELEGATED live or simulated |
| S4 refund idempotency | `s4-refund-idempotency.ts` | not run | | |
| S5 tracking add/update | `s5-tracking.ts` | not run | | |
| S6 payout from agent platform | `s6-payout.ts` | not run | | |
| S7 test-card capture, no buyer | `s7-card-capture.ts` | not run | | order-pool funding |
| S8 disputes sandbox flow | `s8-disputes.ts` | not run | | how disputes are demonstrated |
| S9 webhook verification | `s9-webhook.ts` + Render logs | not run | | |

## Doc findings (checked against PayPal's published OpenAPI schemas, Oct 28 2026)

- `purchase_units[].custom_id` max length is now **255** (spec says 127); a 64-char hash fits either way.
- Item `name` and purchase-unit `description` accept 3000 chars but PayPal **truncates after 127**: keep the limits text under 127.
- Tracker PATCH only supports `status` → `CANCELLED` (plus `notify_payer`, `items`). PayPal has no "delivered" tracker status, so `delivered_at` stays merchant-reported in our DB (as the spec says).
- Refund 422 issues include `TRANSACTION_DISPUTED` and `REFUND_AMOUNT_EXCEEDED`; authorization capture 422 includes `MAX_CAPTURE_AMOUNT_EXCEEDED`, `AUTHORIZATION_EXPIRED`.
- Payouts: a `sender_batch_id` reused within 30 days is rejected (built-in duplicate guard); `PayPal-Request-Id` is also accepted.
- Disputes `provide-evidence` is `multipart/form-data`; the schema documents only the `evidence-file` part. The `input` JSON part name is unverified → S8 tests it.
- `require-evidence` body: `{ "action": "SELLER_EVIDENCE" }`; `adjudicate` body: `{ "adjudication_outcome": "SELLER_FAVOR" | "BUYER_FAVOR" }` (both sandbox-only).
- Webhook verification: `POST /v1/notifications/verify-webhook-signature` with the five `paypal-*` headers, `webhook_id` and the event; result `verification_status`.
