// The 13 scenarios (CLAUDE.md section 17) through the deterministic core: fault, rule-made offers, evaluator verdicts.
import { describe, expect, it } from "vitest";
import { loadScenarios, runCore } from "./core";

const scenarios = loadScenarios();

describe("13 scenarios: fault, remedies and evaluator verdicts", () => {
  it("has all 13", () => expect(scenarios.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]));

  for (const s of scenarios) {
    it(`#${s.id} ${s.name}`, () => {
      const r = runCore(s);
      expect(r.fault).toEqual({ party: s.expected.party, reasons: s.expected.reasons });
      expect(r.faultOk).toBe(true);
      expect(r.offers).toEqual(s.expected.offers);
      for (const p of r.proposals) expect({ action: p.action, amount: p.amount, ...p.got }).toEqual({ action: p.action, amount: p.amount, ...p.expected });
      expect(r.violations).toEqual([]);
    });
  }

  it("the injection text changes nothing: #13 decides exactly like #1", () => {
    const [one, thirteen] = [runCore(scenarios[0]), runCore(scenarios[12])];
    expect(thirteen.fault).toEqual(one.fault);
    expect(thirteen.offers).toEqual(one.offers);
  });
});
