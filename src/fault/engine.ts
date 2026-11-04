// Fault engine (CLAUDE.md section 9): pure, deterministic, checked in the spec's order. No LLM, no I/O.
// Claim text never reaches this function, so nothing a buyer writes can change the ruling.
import type { Assessment } from "../claims/fraud";
import type { VisionResult } from "../claims/vision";
import { limitViolations, type Limits } from "../intent/limits";

export type FaultParty = "MERCHANT" | "CARRIER" | "AGENT" | "BUYER" | "UNCLEAR";
/** A machine reason plus the stored records that back it (order, PayPal approval, intent hash, photo result, tracking). */
export type Reason = { code: string; refs: string[] };
/** party null = no decision (the challenge code is missing; ask for a new photo). */
export type FaultResult = { party: FaultParty | null; reasons: Reason[] };

export type Item = { type: string; color: string; size: string; price: string };

export type FaultInput = {
  assessment: Pick<Assessment, "decision" | "signals">;
  vision: Pick<VisionResult, "item_type" | "dominant_color" | "size_tag_text" | "damage_detected"> | null;
  mode: "CONFIRMED" | "DELEGATED";
  /** What the PayPal order says was bought: the cart item (CONFIRMED) or the agent's chosen item (DELEGATED). */
  ordered: Item;
  limits: Limits;
  capturedAt: string; // ISO; sets the promised date the deadline limit is checked against
  promisedBy: string | null; // ISO
  deliveredAt: string | null; // ISO, merchant-reported
};

const norm = (s: string) => s.toLowerCase().replace(/gray/g, "grey").replace(/\s+/g, " ").trim();

/** "M", "Size: M", "Medium", "m / 38" -> "M"; null when no size can be read. */
export function readSize(tag: string | null): string | null {
  if (!tag) return null;
  const t = tag.toUpperCase();
  const word = t.match(/\b(EXTRA SMALL|SMALL|MEDIUM|LARGE)\b/)?.[1];
  if (word) return { "EXTRA SMALL": "XS", SMALL: "S", MEDIUM: "M", LARGE: "L" }[word]!;
  return t.match(/\b(XXL|XL|XS|S|M|L)\b/)?.[1] ?? null;
}

export function decideFault(i: FaultInput): FaultResult {
  if (i.assessment.decision === "NEEDS_NEW_PHOTO") return { party: null, reasons: [{ code: "CHALLENGE_CODE_MISSING", refs: ["evidence.vision.challenge_code_found"] }] };

  // 1. Fraud signal (or no vision result at all) -> a person decides.
  if (i.assessment.signals.length || !i.vision) {
    const codes = i.assessment.signals.length ? i.assessment.signals : ["VISION_FAILED"];
    return { party: "UNCLEAR", reasons: codes.map((code) => ({ code, refs: ["evidence.fraud_signals"] })) };
  }

  // 2. Delivered item differs from the order, or it arrived late -> merchant.
  const v = i.vision;
  const wrong: Reason[] = [];
  if (v.item_type && norm(v.item_type) !== norm(i.ordered.type)) wrong.push({ code: "DELIVERED_ITEM_TYPE_MISMATCH", refs: ["evidence.vision.item_type", "order.item"] });
  if (v.dominant_color && norm(v.dominant_color) !== norm(i.ordered.color)) wrong.push({ code: "DELIVERED_COLOR_MISMATCH", refs: ["evidence.vision.dominant_color", "order.item"] });
  const seen = readSize(v.size_tag_text);
  if (seen && i.ordered.size !== "One Size" && seen !== i.ordered.size.toUpperCase()) wrong.push({ code: "DELIVERED_SIZE_MISMATCH", refs: ["evidence.vision.size_tag_text", "order.item"] });
  if (i.deliveredAt && i.promisedBy && new Date(i.deliveredAt) > new Date(i.promisedBy)) wrong.push({ code: "LATE_DELIVERY", refs: ["shipment.delivered_at", "order.promised_by", "tracking"] });
  if (wrong.length) return { party: "MERCHANT", reasons: wrong };

  // 3. Right item, damaged -> carrier (the merchant's policy supplies the remedies).
  if (v.damage_detected) return { party: "CARRIER", reasons: [{ code: "ITEM_DAMAGED_IN_TRANSIT", refs: ["evidence.vision.damage_detected", "tracking"] }] };

  // 4. The person approved this exact cart on PayPal.
  if (i.mode === "CONFIRMED") return { party: "BUYER", reasons: [{ code: "CONFIRMED_CART_MATCHES", refs: ["paypal.approval", "intent.hash", "order.item"] }] };

  // 5. The person approved limits only; the agent's choice broke them.
  const broken = limitViolations(i.ordered, i.limits, new Date(i.capturedAt));
  if (broken.length) {
    return { party: "AGENT", reasons: [{ code: "AGENT_EXCEEDED_LIMITS", refs: ["intent.limits", "intent.hash", "order.chosen_item"] }, ...broken.map((code) => ({ code, refs: ["intent.limits", "order.chosen_item"] }))] };
  }

  // 6. The agent stayed inside the approved limits.
  return { party: "BUYER", reasons: [{ code: "AGENT_WITHIN_LIMITS", refs: ["paypal.approval", "intent.limits", "intent.hash", "order.chosen_item"] }] };
}
