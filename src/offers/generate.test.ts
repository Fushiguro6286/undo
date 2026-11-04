import { describe, expect, it } from "vitest";
import type { Reason } from "../fault/engine";
import { DEFAULT_POLICY as policy } from "../policy/schema";
import { generateOffers, type OfferInput } from "./generate";

const r = (...codes: string[]): Reason[] => codes.map((code) => ({ code, refs: [] }));
const base: OfferInput = { party: "MERCHANT", reasons: r("DELIVERED_COLOR_MISMATCH"), policy, mode: "CONFIRMED", currency: "USD", captureAmount: "29.00", refunded: "0.00", ceiling: null, disputed: false, returnRequired: false, daysLate: null, daysSinceDelivery: 2 };
const offers = (o: Partial<OfferInput>) => generateOffers({ ...base, ...o }).map((x) => [x.action, x.amount, x.verdict]);

describe("generateOffers", () => {
  it("wrong item: keep-it 30% (auto), exchange, refund on return (queued above $25), escalate", () => {
    expect(offers({})).toEqual([
      ["PARTIAL_REFUND_KEEP_ITEM", "8.70", "ALLOW"],
      ["EXCHANGE", null, "ALLOW"],
      ["REFUND_ON_RETURN", "29.00", "QUEUE"],
      ["ESCALATE_TO_PAYPAL", null, "ALLOW"],
    ]);
    expect(generateOffers(base)[0].ruleIds).toEqual(["policy.v1.merchantFault.keepItemPct", "policy.v1.keepItemMaxPct"]);
  });
  it("$120 jacket: keep-it $36 is queued", () => {
    expect(offers({ captureAmount: "120.00" })[0]).toEqual(["PARTIAL_REFUND_KEEP_ITEM", "36.00", "QUEUE"]);
  });
  it("late only: 20% keep-it, no exchange or return; within grace: nothing automatic", () => {
    expect(offers({ reasons: r("LATE_DELIVERY"), daysLate: 1.5 })).toEqual([["PARTIAL_REFUND_KEEP_ITEM", "5.80", "ALLOW"], ["ESCALATE_TO_PAYPAL", null, "ALLOW"]]);
    expect(offers({ reasons: r("LATE_DELIVERY"), daysLate: 1, policy: { ...policy, lateDelivery: { graceDays: 2, partialRefundPct: 20 } } })).toEqual([["ESCALATE_TO_PAYPAL", null, "ALLOW"]]);
  });
  it("wrong and late: the higher rate, capped at keepItemMaxPct", () => {
    const p = { ...policy, merchantFault: { ...policy.merchantFault, keepItemPct: 30 }, lateDelivery: { graceDays: 0, partialRefundPct: 60 } };
    expect(offers({ reasons: r("DELIVERED_SIZE_MISMATCH", "LATE_DELIVERY"), daysLate: 3, policy: p })[0]).toEqual(["PARTIAL_REFUND_KEEP_ITEM", "14.50", "ALLOW"]);
  });
  it("return required: no keep-it offer", () => {
    expect(offers({ returnRequired: true }).map((o) => o[0])).toEqual(["EXCHANGE", "REFUND_ON_RETURN", "ESCALATE_TO_PAYPAL"]);
  });
  it("earlier refunds shrink the refund-on-return amount", () => {
    expect(offers({ refunded: "8.70" })).toContainEqual(["REFUND_ON_RETURN", "20.30", "ALLOW"]);
  });
  it("carrier, agent, unclear", () => {
    expect(offers({ party: "CARRIER", reasons: r("ITEM_DAMAGED_IN_TRANSIT") })).toEqual([["REPLACEMENT", null, "ALLOW"], ["REFUND_ON_RETURN", "29.00", "QUEUE"], ["ESCALATE_TO_PAYPAL", null, "ALLOW"]]);
    expect(offers({ party: "AGENT", mode: "DELEGATED", ceiling: "35.00" })).toEqual([["AGENT_PLATFORM_PAYOUT", "29.00", "ALLOW"], ["ESCALATE_TO_PAYPAL", null, "ALLOW"]]);
    expect(offers({ party: "UNCLEAR" })).toEqual([["HUMAN_REVIEW", null, "ALLOW"], ["ESCALATE_TO_PAYPAL", null, "ALLOW"]]);
  });
  it("buyer: denial always comes with escalation; ordinary return only inside the window", () => {
    expect(offers({ party: "BUYER" })).toEqual([["DENY_WITH_REASON", null, "ALLOW"], ["STANDARD_RETURN", "26.10", "QUEUE"], ["ESCALATE_TO_PAYPAL", null, "ALLOW"]]);
    expect(offers({ party: "BUYER", daysSinceDelivery: 31 })).toEqual([["DENY_WITH_REASON", null, "ALLOW"], ["ESCALATE_TO_PAYPAL", null, "ALLOW"]]);
  });
  it("every offer set, for every party and state, includes Escalate to PayPal", () => {
    for (const party of ["MERCHANT", "CARRIER", "AGENT", "BUYER", "UNCLEAR"] as const)
      for (const disputed of [false, true])
        for (const daysSinceDelivery of [2, 31])
          expect(offers({ party, disputed, daysSinceDelivery, mode: party === "AGENT" ? "DELEGATED" : "CONFIRMED", ceiling: party === "AGENT" ? "35.00" : null }).map((o) => o[0])).toContain("ESCALATE_TO_PAYPAL");
  });
  it("no decision: no offers; disputed capture: only escalation", () => {
    expect(offers({ party: null })).toEqual([]);
    expect(offers({ disputed: true })).toEqual([["ESCALATE_TO_PAYPAL", null, "ALLOW"]]);
  });
});
