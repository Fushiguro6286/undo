// The 13 scenarios (CLAUDE.md section 17) through the deterministic core only: fraud checks -> fault engine -> evaluator.
// No PayPal and no LLM: the vision result is part of each fixture. Day 11 adds replay/live modes and results.json.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assess, type AssessInput } from "../src/claims/fraud";
import type { VisionResult } from "../src/claims/vision";
import { decideFault, type FaultInput } from "../src/fault/engine";
import { evaluate, type Action } from "../src/policy/evaluator";
import { DEFAULT_POLICY as policy } from "../src/policy/schema";

type Scenario = Omit<FaultInput, "assessment" | "vision"> & {
  id: number;
  name: string;
  ceiling: string | null;
  refunded: string;
  disputed: boolean;
  claim: { type: string; description: string };
  evidence: Pick<AssessInput, "codeFound" | "photoMatches" | "deliveryContested"> & { vision: VisionResult | null };
  expected: { party: string | null; reasons: string[]; refs?: string[] };
  proposals: { action: Action; amount: string | null; currency: string; expected: { verdict: string; reasons: string[] } }[];
};

const dir = join(__dirname, "scenarios");
const scenarios: Scenario[] = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

describe("13 scenarios: fault and evaluator verdicts", () => {
  it("has all 13", () => expect(scenarios.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));

  for (const s of scenarios) {
    it(`#${s.id} ${s.name}`, () => {
      const a = assess({ ...s.evidence, visionConfidence: s.evidence.vision?.confidence ?? null, claimValue: s.ordered.price, requireReturnAbove: policy.requireReturnAbove });
      const fault = decideFault({ ...s, assessment: a, vision: s.evidence.vision });
      expect(fault.party).toBe(s.expected.party);
      expect(fault.reasons.map((r) => r.code)).toEqual(s.expected.reasons);
      for (const ref of s.expected.refs ?? []) expect(fault.reasons.flatMap((r) => r.refs)).toContain(ref);

      for (const p of s.proposals) {
        const v = evaluate(p, { party: fault.party!, policy, mode: s.mode, currency: "USD", captureAmount: s.ordered.price, refunded: s.refunded, ceiling: s.ceiling, disputed: s.disputed, returnRequired: a.returnRequired });
        expect({ action: p.action, amount: p.amount, ...v }).toEqual({ action: p.action, amount: p.amount, verdict: p.expected.verdict, reasons: p.expected.reasons });
      }
    });
  }
});
