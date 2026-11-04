import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { codeMatches, DEMO_CHALLENGE_CODE, newChallengeCode } from "./code";
import { assess, type AssessInput } from "./fraud";
import { findMatches, hamming, phash, PHASH_MATCH_THRESHOLD } from "./phash";
import { productSvg } from "../store/art";
import { DEFAULT_POLICY, Policy } from "../policy/schema";

describe("challenge code", () => {
  it("has the UNDO-XXXX shape without look-alike characters", () => {
    for (let i = 0; i < 200; i++) expect(newChallengeCode()).toMatch(/^UNDO-[2-9A-HJKMNP-Z]{4}$/);
  });
  it("matches what vision read, ignoring case, spaces and punctuation", () => {
    expect(codeMatches("undo 7f3a.", "UNDO-7F3A")).toBe(true);
    expect(codeMatches("UNDO-7F3B", "UNDO-7F3A")).toBe(false);
    expect(codeMatches(null, "UNDO-7F3A")).toBe(false);
  });
  it("accepts the demo code only when allowed", () => {
    expect(codeMatches(DEMO_CHALLENGE_CODE, "UNDO-7F3A")).toBe(false);
    expect(codeMatches("undo-demo", "UNDO-7F3A", true)).toBe(true);
  });
});

describe("photo match", () => {
  const png = (svg: string, w = 480) => sharp(Buffer.from(svg)).resize(w).png().toBuffer();

  it("hamming distance counts differing bits", () => {
    expect(hamming("0000000000000000", "0000000000000000")).toBe(0);
    expect(hamming("ffffffffffffffff", "0000000000000000")).toBe(64);
    expect(hamming("0000000000000003", "0000000000000001")).toBe(1);
  });

  it("edited copies of a listing photo stay within the threshold", async () => {
    const listing = await png(productSvg("tee", "Sky Blue"));
    const code = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480"><rect x="300" y="400" width="170" height="60" fill="#fff"/><text x="310" y="440" font-size="30">UNDO-DEMO</text></svg>');
    const copies = [
      await sharp(listing).resize(300).jpeg({ quality: 50 }).toBuffer(),
      await sharp(listing).composite([{ input: code }]).jpeg().toBuffer(),
      await sharp(listing).extract({ left: 12, top: 12, width: 456, height: 456 }).jpeg().toBuffer(),
    ];
    const h = await phash(listing);
    for (const c of copies) expect(hamming(h, await phash(c))).toBeLessThanOrEqual(PHASH_MATCH_THRESHOLD / 2);
  });

  it("a new photo of the same item does not match its listing photo", async () => {
    const item = await sharp(Buffer.from(productSvg("tee", "Sky Blue").replace(/<rect[^>]*\/>/, ""))).resize(380).rotate(12, { background: "#0000" }).png().toBuffer();
    const photo = await sharp({ create: { width: 640, height: 640, channels: 3, background: "#8a6e52" } }).composite([{ input: item, left: 110, top: 90 }]).jpeg().toBuffer();
    expect(hamming(await phash(await png(productSvg("tee", "Sky Blue"))), await phash(photo))).toBeGreaterThan(PHASH_MATCH_THRESHOLD * 4);
  });

  it("findMatches keeps only candidates within the threshold, closest first", () => {
    const h = "0000000000000000";
    const out = findMatches(h, [
      { kind: "listing", ref: "far", hash: "00000000000007ff" }, // 11 bits
      { kind: "earlier_claim", ref: "edge", hash: "00000000000003ff" }, // 10 bits
      { kind: "listing", ref: "near", hash: "0000000000000001" }, // 1 bit
    ], 10);
    expect(out.map((m) => m.ref)).toEqual(["near", "edge"]);
  });
});

describe("fraud checks", () => {
  const base: AssessInput = { codeFound: true, photoMatches: [], visionConfidence: 0.9, deliveryContested: false, claimValue: "29.00", requireReturnAbove: 150 };

  it("a clean claim is ready with no signals", () => {
    expect(assess(base)).toEqual({ decision: "READY", signals: [], returnRequired: false, photoMatches: [] });
  });
  it("a missing challenge code means no decision", () => {
    expect(assess({ ...base, codeFound: false }).decision).toBe("NEEDS_NEW_PHOTO");
  });
  it("flags listing and earlier-claim photo matches", () => {
    const a = assess({ ...base, photoMatches: [{ kind: "listing", ref: "TEE/Sky Blue", distance: 3 }, { kind: "earlier_claim", ref: "e1", distance: 6 }] });
    expect(a.signals).toEqual(["PHOTO_MATCHES_LISTING", "PHOTO_MATCHES_EARLIER_CLAIM"]);
  });
  it("flags low confidence, failed vision and a contested delivery date", () => {
    expect(assess({ ...base, visionConfidence: 0.59 }).signals).toEqual(["LOW_VISION_CONFIDENCE"]);
    expect(assess({ ...base, visionConfidence: 0.6 }).signals).toEqual([]);
    expect(assess({ ...base, visionConfidence: null }).signals).toEqual(["VISION_FAILED"]);
    // A failed vision step can't read the code either: a person reviews it rather than the buyer retaking the photo.
    expect(assess({ ...base, codeFound: false, visionConfidence: null })).toMatchObject({ decision: "READY", signals: ["VISION_FAILED"] });
    expect(assess({ ...base, deliveryContested: true }).signals).toEqual(["DELIVERY_DATE_CONTESTED"]);
  });
  it("requires a return only above the policy threshold", () => {
    expect(assess({ ...base, claimValue: "150.00" }).returnRequired).toBe(false);
    expect(assess({ ...base, claimValue: "150.01" }).returnRequired).toBe(true);
  });
});

describe("default policy", () => {
  it("is valid against the schema", () => {
    expect(Policy.parse(DEFAULT_POLICY)).toEqual(DEFAULT_POLICY);
  });
});
