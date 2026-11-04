import { describe, expect, it } from "vitest";
import { fromCents, toCents } from "./cents";
import { assertWithinCeiling, moneyRequestId } from "./router";

describe("cents", () => {
  it("round-trips PayPal amounts", () => {
    expect(toCents("29.00")).toBe(2900);
    expect(toCents("0.5")).toBe(50);
    expect(toCents("120")).toBe(12000);
    expect(fromCents(3605)).toBe("36.05");
    expect(() => toCents("1.234")).toThrow();
    expect(() => toCents("-1.00")).toThrow();
  });
});

describe("DELEGATED ceiling", () => {
  it("allows captures up to the ceiling and blocks anything above or zero", () => {
    expect(() => assertWithinCeiling("29.00", "35.00")).not.toThrow();
    expect(() => assertWithinCeiling("35.00", "35.00")).not.toThrow();
    expect(() => assertWithinCeiling("35.01", "35.00")).toThrow(/exceeds/);
    expect(() => assertWithinCeiling("0.00", "35.00")).toThrow(/above zero/);
  });
});

describe("money request ids", () => {
  it("are stable for a retry and change only with action or version", () => {
    const c = "11111111-1111-4111-8111-111111111111";
    expect(moneyRequestId(c, "PARTIAL_REFUND_KEEP_ITEM", 1)).toBe(moneyRequestId(c, "PARTIAL_REFUND_KEEP_ITEM", 1));
    expect(moneyRequestId(c, "PARTIAL_REFUND_KEEP_ITEM", 1)).toBe(`${c}:PARTIAL_REFUND_KEEP_ITEM:1`);
    expect(moneyRequestId(c, "PARTIAL_REFUND_KEEP_ITEM", 2)).not.toBe(moneyRequestId(c, "PARTIAL_REFUND_KEEP_ITEM", 1));
  });
});
