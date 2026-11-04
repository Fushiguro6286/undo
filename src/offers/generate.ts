// Offer generation (CLAUDE.md section 11): pure. Policy + fault ruling -> every allowed remedy with its amount.
// Each offer is run through the evaluator; BLOCK never reaches the buyer, QUEUE means a person approves first.
import type { FaultParty, Reason } from "../fault/engine";
import { fromCents, toCents } from "../money/cents";
import { agentCompensation, allowedActions, evaluate, type Action, type EvalContext } from "../policy/evaluator";
import type { Policy } from "../policy/schema";

export type OfferDraft = { action: Action; amount: string | null; currency: string; ruleIds: string[]; label: string; verdict: "ALLOW" | "QUEUE" };

export type OfferInput = Omit<EvalContext, "party"> & {
  party: FaultParty | null;
  reasons: Reason[];
  daysLate: number | null; // delivered_at - promised_by, in days (null if not late or unknown)
  daysSinceDelivery: number | null;
};

export const ESCALATE_URL = "https://www.sandbox.paypal.com/resolutioncenter"; // sandbox Resolution Center: PayPal stays the final arbiter

const pctOf = (cents: number, pct: number) => Math.round((cents * pct) / 100);

export function generateOffers(i: OfferInput): OfferDraft[] {
  if (!i.party) return []; // no decision yet (new photo needed)
  const p: Policy = i.policy;
  const v = `policy.v${p.version}`;
  const remaining = toCents(i.captureAmount) - toCents(i.refunded);
  const codes = new Set(i.reasons.map((r) => r.code));
  const itemWrong = ["DELIVERED_ITEM_TYPE_MISMATCH", "DELIVERED_COLOR_MISMATCH", "DELIVERED_SIZE_MISMATCH"].some((c) => codes.has(c));
  const lateBeyondGrace = codes.has("LATE_DELIVERY") && (i.daysLate ?? 0) > p.lateDelivery.graceDays;
  const allowed = new Set(allowedActions(i.party, p, i.returnRequired));
  const out: Omit<OfferDraft, "verdict">[] = [];
  const add = (action: Action, cents: number | null, ruleIds: string[], label: string) => {
    if (allowed.has(action) && (cents === null || cents > 0)) out.push({ action, amount: cents === null ? null : fromCents(cents), currency: p.currency, ruleIds: ruleIds.map((r) => `${v}.${r}`), label });
  };

  if (i.party === "MERCHANT") {
    // Keep-it refund: the wrong-item rate, or the late rate, whichever is higher; never above keepItemMaxPct.
    const rates: [number, string][] = [];
    if (itemWrong) rates.push([p.merchantFault.keepItemPct, "merchantFault.keepItemPct"]);
    if (lateBeyondGrace) rates.push([p.lateDelivery.partialRefundPct, "lateDelivery.partialRefundPct"]);
    const [pct, rule] = rates.sort((a, b) => b[0] - a[0])[0] ?? [0, ""];
    const keepPct = Math.min(pct, p.keepItemMaxPct);
    if (rule) add("PARTIAL_REFUND_KEEP_ITEM", Math.min(pctOf(toCents(i.captureAmount), keepPct), remaining), [rule, "keepItemMaxPct"], `Keep the item and get ${keepPct}% back`);
    if (itemWrong) {
      add("EXCHANGE", null, ["merchantFault.allowExchange"], "Exchange it for the item you ordered");
      add("REFUND_ON_RETURN", remaining, ["merchantFault.allowRefundOnReturn"], "Send it back for a full refund");
    }
  }
  if (i.party === "CARRIER") {
    add("REPLACEMENT", null, ["carrierDamage.offerReplacement"], "Get a free replacement");
    add("REFUND_ON_RETURN", remaining, ["carrierDamage.offerRefundOnReturn"], "Send it back for a full refund");
  }
  if (i.party === "AGENT") add("AGENT_PLATFORM_PAYOUT", toCents(agentCompensation(p, i.captureAmount)), ["agentFault.compensation"], "Your agent's platform pays you back");
  if (i.party === "BUYER") {
    add("DENY_WITH_REASON", null, [], "Claim denied: the order matches what was approved");
    const inWindow = i.daysSinceDelivery === null || i.daysSinceDelivery <= p.returnWindowDays;
    if (inWindow) add("STANDARD_RETURN", remaining - pctOf(remaining, p.buyerRemorse.restockingFeePct), ["buyerRemorse.allowed", "buyerRemorse.restockingFeePct", "returnWindowDays"], `Return it for a refund minus the ${p.buyerRemorse.restockingFeePct}% restocking fee`);
  }
  if (i.party === "UNCLEAR") add("HUMAN_REVIEW", null, [], "A person at the store reviews your claim");
  add("ESCALATE_TO_PAYPAL", null, [], "Take it to PayPal's Resolution Center");

  return out.flatMap((o) => {
    const r = evaluate(o, { ...i, party: i.party! });
    return r.verdict === "BLOCK" ? [] : [{ ...o, verdict: r.verdict }];
  });
}
