// The deterministic part of every scenario: fraud checks -> fault engine -> rule-made offers -> evaluator on each
// proposal. No PayPal and no LLM: the vision result is part of each fixture. Shared by the unit test and `npm run eval`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assess, type AssessInput } from "../src/claims/fraud";
import type { VisionResult } from "../src/claims/vision";
import { decideFault, type FaultInput } from "../src/fault/engine";
import { generateOffers } from "../src/offers/generate";
import { evaluate, type Action } from "../src/policy/evaluator";
import { DEFAULT_POLICY as policy } from "../src/policy/schema";

export type Scenario = Omit<FaultInput, "assessment" | "vision"> & {
  id: number;
  name: string;
  ceiling: string | null;
  refunded: string;
  disputed: boolean;
  claim: { type: string; description: string };
  evidence: Pick<AssessInput, "codeFound" | "photoMatches" | "deliveryContested"> & { vision: VisionResult | null };
  expected: { party: string | null; reasons: string[]; refs?: string[]; offers: string[] };
  proposals: { action: Action; amount: string | null; currency: string; expected: { verdict: string; reasons: string[] } }[];
};

const DAY = 86_400_000;

export function loadScenarios(dir = join(process.cwd(), "evals", "scenarios")): Scenario[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

/** "ACTION amount VERDICT", the form the fixtures list expected offers in. */
export const offerKey = (o: { action: string; amount: string | null; verdict: string }) => `${o.action} ${o.amount ?? "-"} ${o.verdict}`;

export function runCore(s: Scenario) {
  const a = assess({ ...s.evidence, visionConfidence: s.evidence.vision?.confidence ?? null, claimValue: s.ordered.price, requireReturnAbove: policy.requireReturnAbove });
  const fault = decideFault({ ...s, assessment: a, vision: s.evidence.vision });
  const delivered = s.deliveredAt ? Date.parse(String(s.deliveredAt)) : null;
  const promised = s.promisedBy ? Date.parse(String(s.promisedBy)) : null;
  const ctx = { policy, mode: s.mode, currency: "USD", captureAmount: s.ordered.price, refunded: s.refunded, ceiling: s.ceiling, disputed: s.disputed, returnRequired: a.returnRequired };
  const offers = generateOffers({ ...ctx, party: fault.party, reasons: fault.reasons, daysLate: delivered && promised && delivered > promised ? (delivered - promised) / DAY : null, daysSinceDelivery: 1 }).map(offerKey);
  const proposals = s.proposals.map((p) => ({ action: p.action, amount: p.amount, expected: p.expected, got: fault.party ? evaluate(p, { ...ctx, party: fault.party }) : { verdict: "BLOCK", reasons: ["NO_DECISION"] } }));
  // A violation: an offer the evaluator would block reached the buyer, or a proposal that should be blocked was not.
  const violations = [
    ...offers.filter((o) => o.endsWith(" BLOCK")),
    ...proposals.filter((p) => p.expected.verdict === "BLOCK" && p.got.verdict !== "BLOCK").map((p) => `${p.action} ${p.amount} not blocked`),
  ];
  const faultOk = fault.party === s.expected.party && JSON.stringify(fault.reasons.map((r) => r.code)) === JSON.stringify(s.expected.reasons)
    && (s.expected.refs ?? []).every((ref) => fault.reasons.flatMap((r) => r.refs).includes(ref));
  const proposalsOk = proposals.every((p) => p.got.verdict === p.expected.verdict && JSON.stringify(p.got.reasons) === JSON.stringify(p.expected.reasons));
  const remedyOk = JSON.stringify(offers) === JSON.stringify(s.expected.offers) && proposalsOk;
  return { fault: { party: fault.party, reasons: fault.reasons.map((r) => r.code) }, faultOk, offers, proposals, remedyOk, violations, blocked: proposals.filter((p) => p.got.verdict === "BLOCK").length };
}
