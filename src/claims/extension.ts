// Resolution Extension response (CLAUDE.md section 11): a claim in the PayPal Cart API's
// validation_issues / resolution_options vocabulary. Proposed extension; written up in docs/resolution-extension.md.
import { eq } from "drizzle-orm";
import { db } from "../db";
import { intents } from "../db/schema";
import type { Reason } from "../fault/engine";
import { intentHash } from "../intent/record";
import { merchant } from "../paypal/client";
import type { getClaim } from "./claims";

const ISSUE_TEXT: Record<string, string> = {
  CHALLENGE_CODE_MISSING: "The photo does not show the claim's challenge code.",
  DELIVERED_COLOR_MISMATCH: "The delivered item's color differs from the order.",
  DELIVERED_SIZE_MISMATCH: "The size tag differs from the size ordered.",
  DELIVERED_ITEM_TYPE_MISMATCH: "A different kind of item was delivered.",
  LATE_DELIVERY: "The item arrived after the promised date.",
  ITEM_DAMAGED_IN_TRANSIT: "The right item arrived damaged.",
  CONFIRMED_CART_MATCHES: "The delivered item matches the cart the buyer approved on PayPal.",
  AGENT_EXCEEDED_LIMITS: "The shopping agent bought outside the limits the buyer approved.",
  AGENT_WITHIN_LIMITS: "The shopping agent stayed inside the limits the buyer approved.",
  PHOTO_MATCHES_LISTING: "The photo matches the store's listing photo.",
  PHOTO_MATCHES_EARLIER_CLAIM: "The photo matches a photo from another claim.",
  LOW_VISION_CONFIDENCE: "The photo could not be read with confidence.",
  VISION_FAILED: "The photo could not be analyzed.",
  DELIVERY_DATE_CONTESTED: "The buyer disputes the delivery date.",
};

/**
 * True when the stored Intent Record still hashes to its stored hash AND that hash is the custom_id on the
 * PayPal order (fixed once the order completed). So the record wasn't edited after the buyer approved.
 */
export async function verifyIntentHash(paypalOrderId: string, intentId: string): Promise<boolean> {
  const [i] = await db().select().from(intents).where(eq(intents.id, intentId));
  if (!i) return false;
  const recomputed = intentHash({ id: i.id, buyer_ref: i.buyerRef, mode: i.mode, limits: i.limits as never, cart: i.cart as never, created_at: i.createdAt.toISOString() });
  const order = await merchant().request("GET", `/v2/checkout/orders/${paypalOrderId}`);
  return recomputed === i.hash && order.purchase_units?.[0]?.custom_id === i.hash;
}

export async function resolutionResponse(claim: Awaited<ReturnType<typeof getClaim>>) {
  const reasons = (claim.reasons ?? []) as Reason[];
  const needsPhoto = claim.status === "AWAITING_PHOTO" || claim.status === "NEEDS_NEW_PHOTO";
  return {
    claim_id: claim.id,
    status: claim.status,
    challenge_code: needsPhoto ? claim.challengeCode : undefined,
    upload_url: needsPhoto ? `${process.env.APP_BASE_URL ?? ""}/claims/${claim.id}` : undefined,
    fault: { party: claim.faultParty, reasons: reasons.map((r) => r.code), intent_hash_verified: claim.order.intentId ? await verifyIntentHash(claim.order.paypalOrderId, claim.order.intentId) : false },
    validation_issues: needsPhoto && !reasons.length
      ? [{ code: "EVIDENCE_REQUIRED", type: "DATA_ERROR", specific_issue: "CHALLENGE_PHOTO_MISSING", message: `Upload a photo of the item with ${claim.challengeCode} visible.` }]
      : reasons.map((r) => ({ code: "CLAIM_FAULT", type: "BUSINESS_RULE_ERROR", specific_issue: r.code, message: ISSUE_TEXT[r.code] ?? r.code, context: { fault_party: claim.faultParty, evidence: r.refs } })),
    resolution_options: needsPhoto
      ? [{ action: "PROVIDE_MISSING_FIELD", label: "Upload a photo showing the challenge code", metadata: { auto_applicable: false } }]
      : claim.offers.map((o) => {
          const e = o.explanation as { label: string; verdict: string; buyer: string } | null;
          return {
            action: o.action,
            label: e?.label ?? o.action,
            option_id: o.id,
            description: e?.buyer,
            metadata: { cost_impact: o.amount ? { value: o.amount, currency_code: o.currency } : null, auto_applicable: e?.verdict === "ALLOW", chosen: o.chosen },
          };
        }),
  };
}
