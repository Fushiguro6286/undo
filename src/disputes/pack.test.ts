import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: () => { throw new Error("no db in unit tests"); } }));
const { statementsValid, templateStatements } = await import("./pack");
const { buildPdf, wrap } = await import("./pdf");

const facts = {
  order: ["PayPal order 8T106 from Fernleaf Goods: 1 x Classic Tee, Sky Blue, M at $29.00.", "Captured $29.00 USD (capture 5DK87) on 2026-11-04."],
  approval: ["PayPal shows order status COMPLETED; the buyer approved it on PayPal's own checkout page."],
  photo: ['The photo shows a sky blue tee, size tag "M", damage not detected (vision confidence 0.93).'],
};

describe("evidence pack statements", () => {
  it("accept statements that cite existing sources and only use their numbers", () => {
    expect(statementsValid([{ text: "The buyer paid $29.00 for the Sky Blue tee.", cites: ["order"] }, { text: "The buyer approved the order on PayPal.", cites: ["approval"] }], facts)).toBe(true);
  });
  it("reject a statement with no citation, a missing source, or an invented number", () => {
    expect(statementsValid([{ text: "The buyer approved it.", cites: [] }], facts)).toBe(false);
    expect(statementsValid([{ text: "Tracking shows delivery.", cites: ["tracking"] }], facts)).toBe(false);
    expect(statementsValid([{ text: "The buyer paid $35.00.", cites: ["order"] }], facts)).toBe(false);
    expect(statementsValid([{ text: "Vision confidence was 0.93.", cites: ["order"] }], facts)).toBe(false); // number from an uncited source
    expect(statementsValid([], facts)).toBe(false);
  });
  it("template statements are the facts verbatim, each citing its own source", () => {
    const t = templateStatements(facts);
    expect(t).toHaveLength(4);
    expect(statementsValid(t, facts)).toBe(true);
    expect(t[0]).toEqual({ text: facts.order[0], cites: ["order"] });
  });
});

describe("evidence type choice", async () => {
  const { pickEvidence, requestedTypes } = await import("./respond");
  it("sends only a requested type Undo holds a record for", () => {
    const asked = ["PROOF_OF_FULFILLMENT", "PROOF_OF_REFUND", "PROOF_OF_DELIVERY_SIGNATURE"];
    expect(pickEvidence(asked, { tracking: false, refunds: false })).toBeNull(); // the spike dispute: nothing to send
    expect(pickEvidence(asked, { tracking: true, refunds: false })).toBe("PROOF_OF_FULFILLMENT");
    expect(pickEvidence(asked, { tracking: false, refunds: true })).toBe("PROOF_OF_REFUND");
    expect(pickEvidence(["ITEM_DESCRIPTION"], { tracking: false, refunds: false })).toBe("ITEM_DESCRIPTION");
    expect(pickEvidence([], { tracking: false, refunds: false })).toBe("OTHER");
  });
  it("reads requests for the current stage only", () => {
    const d = { dispute_life_cycle_stage: "CHARGEBACK", evidences: [
      { source: "REQUESTED_FROM_SELLER", evidence_type: "OTHER", dispute_life_cycle_stage: "INQUIRY" },
      { source: "SUBMITTED_BY_SELLER", evidence_type: "PROOF_OF_FULFILLMENT", dispute_life_cycle_stage: "CHARGEBACK" },
      { source: "REQUESTED_FROM_SELLER", evidence_type: "PROOF_OF_REFUND", dispute_life_cycle_stage: "CHARGEBACK" },
    ] };
    expect(requestedTypes(d)).toEqual(["PROOF_OF_REFUND"]);
  });
});

describe("pdf", () => {
  it("builds a well-formed PDF with an xref that points at every object", () => {
    const pdf = buildPdf("Title (test)", ["Line with \\ and (parens) and Hindi नमस्ते", ...Array.from({ length: 80 }, (_, i) => `row ${i}`)]);
    const s = pdf.toString("latin1");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("/Count 2"); // 80+ lines wrap onto two pages
    expect(s).toContain("\\(parens\\)");
    const start = Number(s.match(/startxref\n(\d+)/)![1]);
    expect(s.slice(start, start + 4)).toBe("xref");
    for (const m of s.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)) expect(s.slice(Number(m[1])).match(/^\d+ 0 obj/)).not.toBeNull();
  });
  it("wraps long lines", () => {
    expect(wrap("word ".repeat(40).trim(), 30).every((l) => l.length <= 30)).toBe(true);
  });
});
