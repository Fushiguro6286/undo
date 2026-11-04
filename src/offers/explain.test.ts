import { describe, expect, it } from "vitest";
import { amountsMatch, templateExplanation } from "./explain";

describe("amountsMatch", () => {
  it("accepts text whose amounts all equal the rule amount", () => {
    expect(amountsMatch("Keep the tee and get $8.70 back.", "8.70")).toBe(true);
    expect(amountsMatch("A refund of $ 8.7 lands today.", "8.70")).toBe(true);
    expect(amountsMatch("Keep it: 30% back, no amount stated.", "8.70")).toBe(true);
  });
  it("rejects any other amount, including bare decimals", () => {
    expect(amountsMatch("You get $9.00 back.", "8.70")).toBe(false);
    expect(amountsMatch("You get $8.70 now and $20.30 later.", "8.70")).toBe(false);
    expect(amountsMatch("Refund of 29.00 on return.", "8.70")).toBe(false);
    expect(amountsMatch("Refund $1,200.00", "1200.00")).toBe(true);
  });
  it("rejects any amount on an offer that has none", () => {
    expect(amountsMatch("We send a replacement worth $29.00.", null)).toBe(false);
    expect(amountsMatch("We send a replacement.", null)).toBe(true);
  });
});

describe("templateExplanation", () => {
  it("states the rule amount and the approval step", () => {
    const t = templateExplanation({ action: "PARTIAL_REFUND_KEEP_ITEM", amount: "36.00", currency: "USD", ruleIds: ["policy.v1.merchantFault.keepItemPct"], label: "Keep the item and get 30% back", verdict: "QUEUE" }, "MERCHANT");
    expect(t.buyer).toContain("$36.00");
    expect(t.buyer).toContain("approves");
    expect(amountsMatch(t.buyer, "36.00") && amountsMatch(t.merchant, "36.00")).toBe(true);
  });
});
