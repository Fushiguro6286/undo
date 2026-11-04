# Resolution Extension (proposal)

**Status:** proposal from the Undo hackathon project. It is not a PayPal product or an adopted part of any protocol.

## Problem

Agentic checkout protocols (PayPal Store Sync's Cart API, UCP, AP2 mandates) say how an agent *buys*. None of them says what happens when an agent purchase goes *wrong*. Today the only path is a PayPal dispute: slow for the buyer, costly for the merchant, and blind to the question that matters for agent purchases: **did the person approve this, or did their agent go beyond what they approved?**

## Proposal

The merchant exposes one more endpoint next to its Cart API. The buyer's agent calls it after delivery. It reuses the Cart API's response style: HTTP 200 with `validation_issues` (each with a `code` and a `specific_issue`) and `resolution_options` (an `action`, a label and `metadata` that says whether it can be applied automatically). So an agent that already handles cart issues can handle claims too.

```
POST /undo/v1/orders/{paypal_order_id}/claims
```

### 1. Open a claim (JSON)

```json
{ "type": "wrong_item", "description": "I ordered sky blue and got a navy tee." }
```

`type` is one of `wrong_item`, `damaged`, `late`, `not_as_expected`, `changed_mind`, `agent_mistake`, `other`. The description is stored as data. It never changes the decision.

Response: the claim waits for a photo that shows a one-time challenge code.

```json
{
  "claim_id": "…",
  "status": "AWAITING_PHOTO",
  "challenge_code": "UNDO-7F3A",
  "upload_url": "https://undo-nu.vercel.app/claims/…",
  "fault": { "party": null, "reasons": [], "intent_hash_verified": true },
  "validation_issues": [
    { "code": "EVIDENCE_REQUIRED", "type": "DATA_ERROR", "specific_issue": "CHALLENGE_PHOTO_MISSING",
      "message": "Upload a photo of the item with UNDO-7F3A visible." }
  ],
  "resolution_options": [
    { "action": "PROVIDE_MISSING_FIELD", "label": "Upload a photo showing the challenge code", "metadata": { "auto_applicable": false } }
  ]
}
```

### 2. Add the photo (multipart)

Fields: `claim_id`, `photo`. The merchant checks the photo (challenge code, item type, color, size tag, damage, reuse of a listing photo), runs a deterministic fault engine, and returns the remedies its own policy allows.

```json
{
  "claim_id": "…",
  "status": "OFFERED",
  "fault": { "party": "MERCHANT", "reasons": ["DELIVERED_COLOR_MISMATCH"], "intent_hash_verified": true },
  "validation_issues": [
    { "code": "CLAIM_FAULT", "type": "BUSINESS_RULE_ERROR", "specific_issue": "DELIVERED_COLOR_MISMATCH",
      "message": "The delivered item's color differs from the order.",
      "context": { "fault_party": "MERCHANT", "evidence": ["evidence.vision.dominant_color", "order.item"] } }
  ],
  "resolution_options": [
    { "action": "PARTIAL_REFUND_KEEP_ITEM", "label": "Keep it, 30% back", "option_id": "…",
      "metadata": { "cost_impact": { "value": "8.70", "currency_code": "USD" }, "auto_applicable": true, "chosen": false } },
    { "action": "EXCHANGE", "label": "Exchange for the right item", "option_id": "…",
      "metadata": { "cost_impact": null, "auto_applicable": true, "chosen": false } },
    { "action": "ESCALATE_TO_PAYPAL", "label": "Escalate to PayPal", "option_id": "…",
      "metadata": { "cost_impact": null, "auto_applicable": false, "chosen": false } }
  ]
}
```

The agent then picks one `option_id`. In Undo that is `POST /api/claims/{id}/choose` (or the MCP tool `choose_remedy`). An option or amount the merchant did not offer is rejected.

## Fields

| Field | Meaning |
|---|---|
| `fault.party` | `MERCHANT`, `CARRIER`, `AGENT`, `BUYER` or `UNCLEAR` (a person reviews it) |
| `fault.reasons` | Machine reasons, e.g. `DELIVERED_SIZE_MISMATCH`, `LATE_DELIVERY`, `ITEM_DAMAGED_IN_TRANSIT`, `CONFIRMED_CART_MATCHES`, `AGENT_EXCEEDED_LIMITS`, `PHOTO_MATCHES_LISTING`, `LOW_VISION_CONFIDENCE` |
| `fault.intent_hash_verified` | The stored Intent Record still hashes to its hash, and that hash is the PayPal order's `custom_id`. PayPal fixes `custom_id` once the order completes, so the record was not edited after the person approved |
| `resolution_options[].action` | `PARTIAL_REFUND_KEEP_ITEM`, `EXCHANGE`, `REFUND_ON_RETURN`, `REPLACEMENT`, `AGENT_PLATFORM_PAYOUT`, `STANDARD_RETURN`, `DENY_WITH_REASON`, `ESCALATE_TO_PAYPAL`, `HUMAN_REVIEW` |
| `metadata.cost_impact` | The amount that moves if the option is chosen, computed from the merchant's policy (never by an LLM) |
| `metadata.auto_applicable` | `true` when the merchant's policy allows it without a person (under its auto-approve limit). `false` means it goes to the merchant's approval queue |

## Rules every implementation keeps

1. **Consent comes only from PayPal.** CONFIRMED (cart mandate): the person approved the exact cart on PayPal. DELEGATED (intent mandate): the person approved a ceiling plus limits; the agent picked later. The agent can never record consent.
2. **Fault is deterministic.** Same records in, same fault out. Claim text and photo text are data, never instructions.
3. **Agent fault is paid by the agent platform**, not the merchant or the buyer, when a DELEGATED pick breaks the person's limits.
4. **Every option set includes `ESCALATE_TO_PAYPAL`.** PayPal stays the final arbiter, and a disputed capture is never touched by the extension.
5. **Money moves only through PayPal**, with idempotent request ids, after the merchant's policy evaluator allows it.

## Fallback for merchants without the endpoint

The buyer's agent builds an evidence pack (order, PayPal approval, intent hash, photo findings, tracking) and the person files it in PayPal's Resolution Center. Buyers can't open disputes through the API.

## Sources and caveats

- The response style follows PayPal's Store Sync Cart API docs on response handling (docs.paypal.ai, agentic commerce). Those pages moved during the hackathon and returned 404 when re-checked on Nov 5, 2026, so the exact field names above follow Undo's spec and search summaries of those pages. Check them against the current Cart API reference before building on this.
- Undo's working implementation: `app/undo/v1/orders/[id]/claims/route.ts` and `src/claims/extension.ts`.
