import { describe, expect, it } from "vitest";
import { fromCents, toCents } from "./cents";
import { assertWithinCeiling } from "./router";

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
