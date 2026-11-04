import { describe, expect, it } from "vitest";
import { callCost, FLAT_CALL_COST_USD } from "./spend";

describe("LLM spend cap cost", () => {
  it("prices tokens per million when both prices are set", () => {
    expect(callCost(2_000_000, 500_000, { LLM_PRICE_INPUT_PER_MTOK: "0.10", LLM_PRICE_OUTPUT_PER_MTOK: "0.40" })).toBeCloseTo(0.4);
  });
  it("falls back to the flat budget unit when a price is missing or not a number", () => {
    expect(callCost(1000, 1000, {})).toBe(FLAT_CALL_COST_USD);
    expect(callCost(1000, 1000, { LLM_PRICE_INPUT_PER_MTOK: "0.1" })).toBe(FLAT_CALL_COST_USD);
    expect(callCost(1000, 1000, { LLM_PRICE_INPUT_PER_MTOK: "x", LLM_PRICE_OUTPUT_PER_MTOK: "1" })).toBe(FLAT_CALL_COST_USD);
  });
});
