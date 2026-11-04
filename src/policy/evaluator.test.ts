import { describe, expect, it } from "vitest";
import { agentCompensation, allowedActions, evaluate, type EvalContext, type Proposal } from "./evaluator";
import { DEFAULT_POLICY as policy } from "./schema";

// Default policy: auto-approve <= $25, keep-it max 50%, return required above $150.
const ctx: EvalContext = { party: "MERCHANT", policy, mode: "CONFIRMED", currency: "USD", captureAmount: "29.00", refunded: "0.00", ceiling: null, disputed: false, returnRequired: false };
const keep = (amount: string): Proposal => ({ action: "PARTIAL_REFUND_KEEP_ITEM", amount, currency: "USD" });
const ev = (p: Proposal, c: Partial<EvalContext> = {}) => evaluate(p, { ...ctx, ...c });

describe("evaluate", () => {
  it("allows a valid keep-it refund under the auto-approve limit", () => {
    expect(ev(keep("8.70"))).toEqual({ verdict: "ALLOW", reasons: [] });
  });
  it("action must be allowed for the fault party", () => {
    expect(ev(keep("8.70"), { party: "BUYER" })).toEqual({ verdict: "BLOCK", reasons: ["ACTION_NOT_ALLOWED_FOR_PARTY"] });
    expect(ev({ action: "AGENT_PLATFORM_PAYOUT", amount: "10.00", currency: "USD" }).reasons).toContain("ACTION_NOT_ALLOWED_FOR_PARTY");
    expect(ev({ action: "EXCHANGE", amount: null, currency: "USD" }, { party: "UNCLEAR" }).verdict).toBe("BLOCK");
    expect(ev({ action: "HUMAN_REVIEW", amount: null, currency: "USD" }, { party: "UNCLEAR" }).verdict).toBe("ALLOW");
  });
  it("blocks over-capture, counting earlier refunds", () => {
    expect(ev({ action: "REFUND_ON_RETURN", amount: "40.00", currency: "USD" }).reasons).toContain("OVER_CAPTURE");
    expect(ev({ action: "REFUND_ON_RETURN", amount: "20.00", currency: "USD" }, { refunded: "10.00" }).reasons).toEqual(["OVER_CAPTURE"]);
    expect(ev({ action: "REFUND_ON_RETURN", amount: "19.00", currency: "USD" }, { refunded: "10.00" }).verdict).toBe("ALLOW");
  });
  it("blocks a currency mismatch", () => {
    expect(ev({ ...keep("8.70"), currency: "EUR" }).reasons).toEqual(["CURRENCY_MISMATCH"]);
    expect(ev(keep("8.70"), { currency: "EUR" }).reasons).toEqual(["CURRENCY_MISMATCH"]);
  });
  it("keep-it refund stays within keepItemMaxPct (exact edge allowed)", () => {
    expect(ev(keep("14.50")).verdict).toBe("ALLOW"); // exactly 50%
    expect(ev(keep("14.51")).reasons).toEqual(["KEEP_ITEM_OVER_MAX_PCT"]);
  });
  it("keep-it is blocked when a return is required", () => {
    expect(ev(keep("8.70"), { returnRequired: true }).reasons).toEqual(["RETURN_REQUIRED"]);
    expect(ev({ action: "REFUND_ON_RETURN", amount: "20.00", currency: "USD" }, { returnRequired: true }).verdict).toBe("ALLOW");
  });
  it("blocks every remedy on a disputed capture except escalation and review", () => {
    expect(ev(keep("8.70"), { disputed: true }).reasons).toEqual(["CAPTURE_DISPUTED"]);
    expect(ev({ action: "EXCHANGE", amount: null, currency: "USD" }, { disputed: true }).reasons).toEqual(["CAPTURE_DISPUTED"]);
    expect(ev({ action: "ESCALATE_TO_PAYPAL", amount: null, currency: "USD" }, { disputed: true }).verdict).toBe("ALLOW");
  });
  it("blocks anything on a DELEGATED capture above its ceiling", () => {
    expect(ev(keep("8.70"), { mode: "DELEGATED", ceiling: "28.00" }).reasons).toEqual(["DELEGATED_CAPTURE_OVER_CEILING"]);
    expect(ev(keep("8.70"), { mode: "DELEGATED", ceiling: "35.00" }).verdict).toBe("ALLOW");
  });
  it("queues refunds above autoApproveLimit; BLOCK wins over QUEUE", () => {
    const jacket = { captureAmount: "120.00" };
    expect(ev(keep("36.00"), jacket)).toEqual({ verdict: "QUEUE", reasons: ["ABOVE_AUTO_APPROVE_LIMIT"] });
    expect(ev(keep("25.00"), jacket).verdict).toBe("ALLOW"); // at the limit
    expect(ev(keep("120.00"), jacket)).toEqual({ verdict: "BLOCK", reasons: ["KEEP_ITEM_OVER_MAX_PCT"] });
  });
  it("money amounts must be positive; non-money actions carry no amount", () => {
    expect(ev(keep("0.00")).reasons).toEqual(["AMOUNT_NOT_POSITIVE"]);
    expect(ev({ action: "EXCHANGE", amount: "5.00", currency: "USD" }).reasons).toEqual(["AMOUNT_ON_NON_MONEY_ACTION"]);
  });
  it("agent payout is capped by the policy's compensation and is not queued", () => {
    const agent = { party: "AGENT" as const, mode: "DELEGATED" as const, ceiling: "35.00" };
    expect(ev({ action: "AGENT_PLATFORM_PAYOUT", amount: "29.00", currency: "USD" }, agent).verdict).toBe("ALLOW");
    expect(ev({ action: "AGENT_PLATFORM_PAYOUT", amount: "29.01", currency: "USD" }, agent).reasons).toEqual(["PAYOUT_OVER_COMPENSATION"]);
  });
});

describe("allowedActions and agentCompensation", () => {
  it("follows the policy switches and always offers escalation", () => {
    expect(allowedActions("BUYER", policy, false)).toEqual(["DENY_WITH_REASON", "STANDARD_RETURN", "ESCALATE_TO_PAYPAL", "HUMAN_REVIEW"]);
    expect(allowedActions("BUYER", { ...policy, buyerRemorse: { allowed: false, restockingFeePct: 0 } }, false)).not.toContain("STANDARD_RETURN");
    expect(allowedActions("MERCHANT", policy, true)).not.toContain("PARTIAL_REFUND_KEEP_ITEM");
    expect(allowedActions("CARRIER", policy, false)).toEqual(["REPLACEMENT", "REFUND_ON_RETURN", "ESCALATE_TO_PAYPAL", "HUMAN_REVIEW"]);
    expect(allowedActions("UNCLEAR", policy, false)).toEqual(["ESCALATE_TO_PAYPAL", "HUMAN_REVIEW"]);
  });
  it("computes fixed and percentage compensation, never above the capture", () => {
    expect(agentCompensation(policy, "29.00")).toBe("29.00");
    expect(agentCompensation({ ...policy, agentFault: { compensation: { type: "pct", value: 15 } } }, "29.00")).toBe("4.35");
    expect(agentCompensation({ ...policy, agentFault: { compensation: { type: "fixed", value: 50 } } }, "29.00")).toBe("29.00");
    expect(agentCompensation({ ...policy, agentFault: { compensation: { type: "fixed", value: 5 } } }, "29.00")).toBe("5.00");
  });
});
