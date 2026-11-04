import { describe, expect, it } from "vitest";
import { chainHash, GENESIS, payloadHash, verifyChain } from "./log";

function chain(payloads: unknown[]) {
  let prev = GENESIS;
  return payloads.map((payload, i) => {
    const pHash = payloadHash(payload);
    const row = { seq: i + 1, payload, payloadHash: pHash, prevHash: prev, hash: chainHash(prev, pHash) };
    prev = row.hash;
    return row;
  });
}

describe("verifyChain", () => {
  const rows = chain([{ a: 1 }, { amount: "8.70", action: "PARTIAL_REFUND_KEEP_ITEM" }, { b: [1, 2] }]);
  it("accepts an intact chain (and an empty one)", () => {
    expect(verifyChain(rows)).toMatchObject({ ok: true, count: 3 });
    expect(verifyChain([]).ok).toBe(true);
  });
  it("payload hash ignores key order", () => {
    expect(payloadHash({ x: 1, y: 2 })).toBe(payloadHash({ y: 2, x: 1 }));
  });
  it("catches an edited payload", () => {
    const bad = rows.map((r) => (r.seq === 2 ? { ...r, payload: { amount: "29.00", action: "PARTIAL_REFUND_KEEP_ITEM" } } : r));
    expect(verifyChain(bad)).toMatchObject({ ok: false, brokenAt: 2, problem: "payload was changed after it was logged" });
  });
  it("catches a deleted event and a rewritten hash", () => {
    expect(verifyChain([rows[0], rows[2]])).toMatchObject({ ok: false, brokenAt: 3 });
    expect(verifyChain(rows.map((r) => (r.seq === 1 ? { ...r, hash: GENESIS } : r)))).toMatchObject({ ok: false, brokenAt: 1, problem: "hash does not match" });
  });
});
