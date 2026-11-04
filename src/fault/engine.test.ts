import { describe, expect, it } from "vitest";
import { decideFault, readSize, type FaultInput } from "./engine";

const tee = { type: "tee", color: "Sky Blue", size: "M", price: "29.00" };
const base: FaultInput = {
  assessment: { decision: "READY", signals: [] },
  vision: { item_type: "tee", dominant_color: "Sky Blue", size_tag_text: "M", damage_detected: false },
  mode: "CONFIRMED",
  ordered: tee,
  limits: { item: "tee", size: "M", color: "sky blue", max_price: "35.00", deadline: "2026-11-06" },
  capturedAt: "2026-11-02T10:00:00Z",
  promisedBy: "2026-11-05T10:00:00Z",
  deliveredAt: "2026-11-04T10:00:00Z",
};
const run = (o: Partial<FaultInput>) => decideFault({ ...base, ...o });
const codes = (o: Partial<FaultInput>) => run(o).reasons.map((r) => r.code);
const vision = (v: Partial<NonNullable<FaultInput["vision"]>>) => ({ vision: { ...base.vision!, ...v } });

describe("decideFault, in spec order", () => {
  it("no challenge code -> no decision", () => {
    expect(run({ assessment: { decision: "NEEDS_NEW_PHOTO", signals: ["PHOTO_MATCHES_LISTING"] } })).toEqual({ party: null, reasons: [{ code: "CHALLENGE_CODE_MISSING", refs: ["evidence.vision.challenge_code_found"] }] });
  });
  it("1. any fraud signal -> UNCLEAR, even when the item is plainly wrong", () => {
    const r = run({ assessment: { decision: "READY", signals: ["PHOTO_MATCHES_LISTING", "DELIVERY_DATE_CONTESTED"] }, ...vision({ dominant_color: "Navy" }) });
    expect(r.party).toBe("UNCLEAR");
    expect(r.reasons.map((x) => x.code)).toEqual(["PHOTO_MATCHES_LISTING", "DELIVERY_DATE_CONTESTED"]);
  });
  it("1. missing vision result -> UNCLEAR", () => {
    expect(run({ vision: null })).toMatchObject({ party: "UNCLEAR", reasons: [{ code: "VISION_FAILED" }] });
  });
  it("2. wrong color, size, type or late -> MERCHANT with every reason", () => {
    expect(run(vision({ dominant_color: "Navy" })).party).toBe("MERCHANT");
    expect(codes(vision({ dominant_color: "Navy" }))).toEqual(["DELIVERED_COLOR_MISMATCH"]);
    expect(codes(vision({ size_tag_text: "Size: L" }))).toEqual(["DELIVERED_SIZE_MISMATCH"]);
    expect(codes(vision({ item_type: "hoodie" }))).toEqual(["DELIVERED_ITEM_TYPE_MISMATCH"]);
    expect(codes({ deliveredAt: "2026-11-06T09:00:00Z" })).toEqual(["LATE_DELIVERY"]);
    expect(codes({ ...vision({ dominant_color: "Navy", size_tag_text: "L" }), deliveredAt: "2026-11-07T00:00:00Z" })).toEqual(["DELIVERED_COLOR_MISMATCH", "DELIVERED_SIZE_MISMATCH", "LATE_DELIVERY"]);
  });
  it("2. merchant beats damage, and a mismatch in a DELEGATED order is still the merchant's", () => {
    expect(run(vision({ dominant_color: "Navy", damage_detected: true })).party).toBe("MERCHANT");
    expect(run({ mode: "DELEGATED", ...vision({ dominant_color: "White" }) }).party).toBe("MERCHANT");
  });
  it("2. unreadable or equivalent findings are not mismatches", () => {
    expect(run(vision({ size_tag_text: null, dominant_color: null, item_type: null })).party).toBe("BUYER");
    expect(run(vision({ dominant_color: "sky  blue", size_tag_text: "Medium" })).party).toBe("BUYER");
    expect(run({ ordered: { ...tee, size: "One Size" }, ...vision({ size_tag_text: "L" }) }).party).toBe("BUYER");
    expect(run({ deliveredAt: null }).party).toBe("BUYER");
    expect(run({ deliveredAt: base.promisedBy }).party).toBe("BUYER"); // on time exactly
  });
  it("3. right item, damaged -> CARRIER", () => {
    expect(run(vision({ damage_detected: true }))).toMatchObject({ party: "CARRIER", reasons: [{ code: "ITEM_DAMAGED_IN_TRANSIT" }] });
  });
  it("4. CONFIRMED and matching -> BUYER, citing the PayPal approval and the intent hash", () => {
    expect(run({})).toEqual({ party: "BUYER", reasons: [{ code: "CONFIRMED_CART_MATCHES", refs: ["paypal.approval", "intent.hash", "order.item"] }] });
  });
  it("4. CONFIRMED wins even if the cart breaks the limits (the person approved this exact cart)", () => {
    expect(run({ ordered: { ...tee, size: "L" }, ...vision({ size_tag_text: "L" }) }).party).toBe("BUYER");
  });
  it("5. DELEGATED and the agent's pick breaks the limits -> AGENT with each broken limit", () => {
    const r = run({ mode: "DELEGATED", ordered: { ...tee, size: "L" }, ...vision({ size_tag_text: "L" }) });
    expect(r.party).toBe("AGENT");
    expect(r.reasons.map((x) => x.code)).toEqual(["AGENT_EXCEEDED_LIMITS", "LIMIT_SIZE"]);
  });
  it("6. DELEGATED within limits -> BUYER", () => {
    expect(run({ mode: "DELEGATED" })).toMatchObject({ party: "BUYER", reasons: [{ code: "AGENT_WITHIN_LIMITS" }] });
  });
});

describe("readSize", () => {
  it("reads common tag text", () => {
    for (const [tag, want] of [["M", "M"], ["Size: L", "L"], ["medium", "M"], ["XL", "XL"], ["s / 36", "S"], ["Extra Small", "XS"], ["", null], [null, null], ["100% cotton", null]] as const) {
      expect(readSize(tag)).toBe(want);
    }
  });
});
