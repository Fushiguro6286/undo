import { describe, expect, it } from "vitest";
import { canonicalJson, intentHash, type IntentRecord } from "./record";
import { describeLimits, limitsText, limitViolations, matchVariants, type Limits } from "./limits";
import { confirmedOrderBody, delegatedOrderBody } from "./checkout";
import { variantBySku } from "../store/catalog";

const limits: Limits = { item: "tee", size: "M", color: "sky blue", max_price: "35.00", deadline: "2026-11-06" };
const record: IntentRecord = { id: "11111111-1111-4111-8111-111111111111", buyer_ref: "b1", mode: "CONFIRMED", limits, cart: [{ sku: "TEE-SKYBLUE-M", qty: 1 }], created_at: "2026-10-31T10:00:00.000Z" };
const oct31 = new Date("2026-10-31T10:00:00Z"); // promised by Nov 3

describe("intent hash", () => {
  it("is stable regardless of key order", () => {
    const shuffled = { cart: record.cart, created_at: record.created_at, mode: record.mode, limits: { deadline: limits.deadline, max_price: "35.00", color: "sky blue", size: "M", item: "tee" }, buyer_ref: "b1", id: record.id };
    expect(intentHash(shuffled as IntentRecord)).toBe(intentHash(record));
    expect(intentHash(record)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("changes when any field changes", () => {
    expect(intentHash({ ...record, limits: { ...limits, size: "L" } })).not.toBe(intentHash(record));
  });
  it("is pinned (a change here breaks every stored custom_id)", () => {
    expect(canonicalJson({ b: [1, { d: null, c: "x" }], a: true })).toBe('{"a":true,"b":[1,{"c":"x","d":null}]}');
  });
});

describe("limits", () => {
  it("matches only the sky blue tee in M", () => {
    expect(matchVariants(limits, oct31).map((v) => v.sku)).toEqual(["TEE-SKYBLUE-M"]);
  });
  it("treats hyphens in colors as spaces", () => {
    expect(limitViolations(variantBySku("TEE-SKYBLUE-M")!, { ...limits, color: "sky-blue" }, oct31)).toEqual([]);
  });
  it("names every broken limit", () => {
    expect(limitViolations(variantBySku("TEE-SKYBLUE-L")!, limits, oct31)).toEqual(["LIMIT_SIZE"]);
    expect(limitViolations(variantBySku("TEE-NAVY-M")!, limits, oct31)).toEqual(["LIMIT_COLOR"]);
    expect(limitViolations(variantBySku("JACKET-OLIVE-M")!, limits, oct31)).toEqual(["LIMIT_ITEM_TYPE", "LIMIT_COLOR", "LIMIT_PRICE"]);
    expect(limitViolations(variantBySku("TEE-SKYBLUE-M")!, { ...limits, deadline: "2026-11-01" }, oct31)).toEqual(["LIMIT_DEADLINE"]);
  });
  it("treats null limits as unrestricted", () => {
    const open: Limits = { item: "tee", size: null, color: "blue", max_price: null, deadline: null };
    expect(matchVariants(open, oct31).map((v) => v.sku)).toEqual(["TEE-SKYBLUE-S", "TEE-SKYBLUE-M", "TEE-SKYBLUE-L"]);
  });
  it("describes limits in plain words and keeps PayPal text under 127 chars", () => {
    expect(describeLimits(limits)).toBe("a sky blue tee, size M, up to $35.00, delivered by Fri, Nov 6");
    expect(limitsText(limits)).toBe("Agent purchase up to $35.00: sky blue tee, size M, by Fri, Nov 6");
    expect(limitsText({ ...limits, color: "x".repeat(300) }).length).toBe(127);
  });
});

describe("order bodies", () => {
  it("CONFIRMED lists size and color in the item name and the hash in custom_id", () => {
    const b = confirmedOrderBody("h".repeat(64), [{ sku: "TEE-SKYBLUE-M", qty: 2 }, { sku: "BEANIE-RUST-ONESIZE", qty: 1 }]);
    expect(b.intent).toBe("CAPTURE");
    const pu = b.purchase_units[0];
    expect(pu.custom_id).toBe("h".repeat(64));
    expect(pu.items.map((i) => i.name)).toEqual(["Classic Tee, Sky Blue, M", "Wool Beanie, Rust"]);
    expect(pu.amount).toEqual({ currency_code: "USD", value: "76.00", breakdown: { item_total: { currency_code: "USD", value: "76.00" } } });
  });
  it("CONFIRMED rejects unknown skus and bad quantities", () => {
    expect(() => confirmedOrderBody("h", [{ sku: "NOPE", qty: 1 }])).toThrow(/unknown sku/);
    expect(() => confirmedOrderBody("h", [{ sku: "TEE-SKYBLUE-M", qty: 0 }])).toThrow(/quantity/);
    expect(() => confirmedOrderBody("h", [])).toThrow(/empty/);
  });
  it("DELEGATED authorizes the ceiling with the limits as the item name", () => {
    const b = delegatedOrderBody("h", limits);
    expect(b.intent).toBe("AUTHORIZE");
    expect(b.purchase_units[0].amount.value).toBe("35.00");
    expect(b.purchase_units[0].items[0].name).toBe(limitsText(limits));
    expect(() => delegatedOrderBody("h", { ...limits, max_price: null })).toThrow(/maximum price/);
  });
});
