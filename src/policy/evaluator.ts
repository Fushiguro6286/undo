// Policy evaluator (CLAUDE.md section 10): pure and deterministic. Every offer and every proposal (system, buyer
// agent or Studio agent) passes through here before any money moves. Amounts are decimal strings, compared in cents.
import type { FaultParty } from "../fault/engine";
import { fromCents, toCents } from "../money/cents";
import type { Policy } from "./schema";

export const ACTIONS = [
  "PARTIAL_REFUND_KEEP_ITEM",
  "EXCHANGE",
  "REFUND_ON_RETURN",
  "REPLACEMENT",
  "AGENT_PLATFORM_PAYOUT",
  "STANDARD_RETURN",
  "DENY_WITH_REASON",
  "ESCALATE_TO_PAYPAL",
  "HUMAN_REVIEW",
] as const;
export type Action = (typeof ACTIONS)[number];

/** Actions that refund the merchant's capture. */
export const REFUND_ACTIONS: readonly Action[] = ["PARTIAL_REFUND_KEEP_ITEM", "REFUND_ON_RETURN", "STANDARD_RETURN"];
const MONEY_ACTIONS: readonly Action[] = [...REFUND_ACTIONS, "AGENT_PLATFORM_PAYOUT"];
/** Always open: PayPal stays the final arbiter, and a person can always look. */
const ALWAYS: Action[] = ["ESCALATE_TO_PAYPAL", "HUMAN_REVIEW"];

/** The remedies this policy allows for a fault party. returnRequired (fraud check 3) removes keep-the-item. */
export function allowedActions(party: FaultParty, p: Policy, returnRequired: boolean): Action[] {
  const by: Record<FaultParty, (Action | false)[]> = {
    MERCHANT: [!returnRequired && p.keepItemMaxPct > 0 && p.merchantFault.keepItemPct > 0 && "PARTIAL_REFUND_KEEP_ITEM", p.merchantFault.allowExchange && "EXCHANGE", p.merchantFault.allowRefundOnReturn && "REFUND_ON_RETURN"],
    CARRIER: [p.carrierDamage.offerReplacement && "REPLACEMENT", p.carrierDamage.offerRefundOnReturn && "REFUND_ON_RETURN"],
    AGENT: ["AGENT_PLATFORM_PAYOUT"],
    BUYER: ["DENY_WITH_REASON", p.buyerRemorse.allowed && "STANDARD_RETURN"],
    UNCLEAR: [],
  };
  return [...by[party].filter((a): a is Action => a !== false), ...ALWAYS];
}

/** What the agent platform owes the buyer under this policy, capped at the capture amount. */
export function agentCompensation(p: Policy, captureAmount: string): string {
  const capture = toCents(captureAmount);
  const c = p.agentFault.compensation;
  const owed = c.type === "fixed" ? Math.round(c.value * 100) : Math.round((capture * c.value) / 100);
  return fromCents(Math.min(owed, capture));
}

export type Proposal = { action: Action; amount: string | null; currency: string };

export type EvalContext = {
  party: FaultParty;
  policy: Policy;
  mode: "CONFIRMED" | "DELEGATED";
  currency: string; // the capture's currency
  captureAmount: string;
  refunded: string; // refunds already made on this capture
  ceiling: string | null; // DELEGATED authorization ceiling
  disputed: boolean; // the capture has an open PayPal dispute
  returnRequired: boolean;
};

export type Verdict = { verdict: "ALLOW" | "QUEUE" | "BLOCK"; reasons: string[] };

export function evaluate(p: Proposal, c: EvalContext): Verdict {
  const block: string[] = [];
  const isMoney = MONEY_ACTIONS.includes(p.action);
  const amount = p.amount === null ? 0 : toCents(p.amount);
  const capture = toCents(c.captureAmount);

  if (!allowedActions(c.party, c.policy, c.returnRequired).includes(p.action)) {
    block.push(p.action === "PARTIAL_REFUND_KEEP_ITEM" && c.returnRequired ? "RETURN_REQUIRED" : "ACTION_NOT_ALLOWED_FOR_PARTY");
  }
  if (p.currency !== c.currency || p.currency !== c.policy.currency) block.push("CURRENCY_MISMATCH");
  // A disputed capture is answered in PayPal, never with an Undo remedy.
  if (c.disputed && !ALWAYS.includes(p.action)) block.push("CAPTURE_DISPUTED");
  if (c.mode === "DELEGATED" && c.ceiling !== null && capture > toCents(c.ceiling)) block.push("DELEGATED_CAPTURE_OVER_CEILING");

  if (!isMoney && amount > 0) block.push("AMOUNT_ON_NON_MONEY_ACTION");
  if (isMoney && amount <= 0) block.push("AMOUNT_NOT_POSITIVE");
  if (REFUND_ACTIONS.includes(p.action) && amount > capture - toCents(c.refunded)) block.push("OVER_CAPTURE");
  // amount / capture <= keepItemMaxPct / 100, in integers
  if (p.action === "PARTIAL_REFUND_KEEP_ITEM" && amount * 100 > capture * c.policy.keepItemMaxPct) block.push("KEEP_ITEM_OVER_MAX_PCT");
  if (p.action === "AGENT_PLATFORM_PAYOUT" && amount > toCents(agentCompensation(c.policy, c.captureAmount))) block.push("PAYOUT_OVER_COMPENSATION");

  if (block.length) return { verdict: "BLOCK", reasons: block };
  // autoApproveLimit guards the merchant's own money (refunds). Payouts come from the agent platform's account.
  if (REFUND_ACTIONS.includes(p.action) && amount > Math.round(c.policy.autoApproveLimit * 100)) return { verdict: "QUEUE", reasons: ["ABOVE_AUTO_APPROVE_LIMIT"] };
  return { verdict: "ALLOW", reasons: [] };
}
