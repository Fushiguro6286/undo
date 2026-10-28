# Spike results (Day 1)

Run each with `npm run spike scripts/spikes/<file>.ts`. Every script prints `PASS` or `FAIL` plus PayPal ids, never tokens.

| Spike | Script | Result | PayPal ids | Decision it forces |
|---|---|---|---|---|
| S1 OAuth (merchant + agent platform) | `s1-oauth.ts` | **PASS** (Oct 28) | merchant APP-1PM15472RS0135816 (disputes scope ✓), agent platform APP-49M125667T230682S (payouts scope ✓) | none. Payouts scope name is `https://uri.paypal.com/payments/payouts` |
| S2 CONFIRMED + custom_id | `s2-confirmed.ts` | **PASS** (Oct 28) | order 4GP18601L49641022 COMPLETED, capture 2H875776GV391002M, item "Classic Tee, Sky Blue, M", custom_id = intent hash after capture | CONFIRMED checkout is live. Body-less POSTs (capture, authorize) need `Content-Type: application/json` or PayPal returns 415 (fixed in the client, with a test) |
| S3 DELEGATED authorize → capture $29 of $35 | `s3-delegated.ts` | **PASS** (Oct 28) | order 51L378204L562312B, authorization 37097301DB125190U → CAPTURED, capture 1LN39240P80983735 $29.00; 2nd capture → 422 AUTHORIZATION_ALREADY_CAPTURED | **DELEGATED is live** (no simulation). `final_capture: true` releases the $6 remainder |
| S4 refund idempotency | `s4-refund-idempotency.ts` | **PASS** (Oct 28) | capture 5L624410YE142664Y; both calls returned refund 22A59817TH8581016; refunds 0 → 1 | `PayPal-Request-Id` is a sufficient retry guard for refunds; keep `${claimId}:${action}:${version}` |
| S5 tracking add/update | `s5-tracking.ts` | **PASS** (Oct 28) | order 4GP18601L49641022: tracker `…-UNDO1793211323536` patched then CANCELLED, `…-UNDO1793211331445B` SHIPPED | tracker id = `{captureId}-{trackingNumber}`; a wrong tracking number is fixed by cancel + re-add |
| S6 payout from agent platform | `s6-payout.ts` | **PASS** (Oct 28) | batch V4TS9YYP47G42 SUCCESS; reused sender_batch_id → 400 USER_BUSINESS_ERROR | agent-fault payouts are live; use `sender_batch_id = ${claimId}:payout:${version}` as the duplicate guard |
| S7 test-card capture, no buyer | `s7-card-capture.ts` | **PASS** (Oct 28) | order 41V33207CW8031431 created COMPLETED with intent CAPTURE, capture 5L624410YE142664Y | **order pool is funded by sandbox test card** (no hand approvals) |
| S8 disputes sandbox flow | `s8-disputes.ts` | **provide-evidence PASS** at INQUIRY and CHARGEBACK (Oct 28–29); adjudicate pending | dispute PP-R-BQG-10194997 on capture 1LN39240P80983735 ("not received"). Timeline: opened → UNDER_REVIEW, no links, not in list → ~1 min WAITING_FOR_SELLER_RESPONSE [provide-evidence, accept-claim, escalate, make-offer, send-message] → evidence → UNDER_REVIEW → WAITING_FOR_BUYER_RESPONSE [accept-claim, send-message, escalate] → merchant `escalate` → stage CHARGEBACK, WAITING_FOR_SELLER_RESPONSE [provide-evidence, accept-claim] → evidence → UNDER_REVIEW [provide-supporting-info] | (1) Multipart parts `input` (JSON) + `evidence-file`: **confirmed**. (2) Send the evidence type listed as `REQUESTED_FROM_SELLER` (here `PROOF_OF_FULFILLMENT` + `evidence_info.tracking_info`); `OTHER` → 400 `EVIDENCE_TYPE_IS_NOT_ALLOWED`. (3) Inquiries never offer adjudicate; `require-evidence` was not offered either. Each transition took ~1–3 min. (4) The list lags at first: also re-fetch known ids. (5) `allowed_response_options` lists accept-claim types (REFUND, PARTIAL_REFUND). **Disputes demo:** run live where the links appear, recorded replay as backup |
| S9 webhook verification | `s9-webhook.ts` + Render logs | not run (needs Render) | | |

## Doc findings (checked against PayPal's published OpenAPI schemas, Oct 28 2026)

- `purchase_units[].custom_id` max length is now **255** (spec says 127); a 64-char hash fits either way.
- Item `name` and purchase-unit `description` accept 3000 chars but PayPal **truncates after 127**: keep the limits text under 127.
- Tracker PATCH only supports `status` → `CANCELLED` (plus `notify_payer`, `items`). PayPal has no "delivered" tracker status, so `delivered_at` stays merchant-reported in our DB (as the spec says).
- Refund 422 issues include `TRANSACTION_DISPUTED` and `REFUND_AMOUNT_EXCEEDED`; authorization capture 422 includes `MAX_CAPTURE_AMOUNT_EXCEEDED`, `AUTHORIZATION_EXPIRED`.
- Payouts: a `sender_batch_id` reused within 30 days is rejected (confirmed by S6); `PayPal-Request-Id` is also accepted.
- Disputes `provide-evidence` is `multipart/form-data`; the schema documents only the `evidence-file` part. The `input` JSON part name is unverified → S8 tests it.
- `require-evidence` body: `{ "action": "SELLER_EVIDENCE" }`; `adjudicate` body: `{ "adjudication_outcome": "SELLER_FAVOR" | "BUYER_FAVOR" }` (both sandbox-only).
- Webhook verification: `POST /v1/notifications/verify-webhook-signature` with the five `paypal-*` headers, `webhook_id` and the event; result `verification_status`.
- With `payment_source.card` and intent `CAPTURE`, the create call itself returns `COMPLETED` (no separate capture call needed).
