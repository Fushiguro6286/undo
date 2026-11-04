import { describe, expect, it } from "vitest";
import { diffPolicy } from "./compiler";
import { DEFAULT_POLICY } from "./schema";

describe("diffPolicy", () => {
  it("lists every changed rule by path, ignoring the version", () => {
    const next = { ...DEFAULT_POLICY, version: 7, autoApproveLimit: 40, lateDelivery: { graceDays: 1, partialRefundPct: 20 }, agentFault: { compensation: { type: "fixed" as const, value: 10 } } };
    expect(diffPolicy(DEFAULT_POLICY, next)).toEqual([
      { path: "autoApproveLimit", from: 25, to: 40 },
      { path: "lateDelivery.graceDays", from: 0, to: 1 },
      { path: "agentFault.compensation.type", from: "pct", to: "fixed" },
      { path: "agentFault.compensation.value", from: 100, to: 10 },
    ]);
  });
  it("is empty for identical rules", () => {
    expect(diffPolicy(DEFAULT_POLICY, { ...DEFAULT_POLICY, version: 2 })).toEqual([]);
  });
});
