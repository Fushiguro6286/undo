// Day 3 check: each sample photo, through the real pipeline (normalize, hash, vision, fraud checks), on a claim
// against a Sky Blue tee size M pool order. Needs JUDGE_MODE=true (pool orders accept the demo code).
// Usage: npm run spike scripts/check-samples.ts [paypalOrderId]   (default: newest Sky Blue M tee pool order)
import { readFileSync } from "node:fs";
import { and, desc, eq } from "drizzle-orm";
import { addEvidence, openClaim } from "../src/claims/claims";
import type { Assessment } from "../src/claims/fraud";
import type { VisionResult } from "../src/claims/vision";
import { db } from "../src/db";
import { intents, orders } from "../src/db/schema";

type Expect = (v: VisionResult | null, a: Assessment) => string | null; // null = pass, else what was wrong
const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();
const clean: Expect = (v, a) => (a.decision !== "READY" ? "code not found" : a.signals.length ? `signals ${a.signals}` : null);

const CASES: Record<string, Expect> = {
  "correct-item.jpg": (v, a) => clean(v, a) ?? (lc(v?.dominant_color).includes("sky") && lc(v?.size_tag_text) === "m" && !v?.damage_detected ? null : "expected sky blue, tag M, no damage"),
  "wrong-color.jpg": (v, a) => clean(v, a) ?? (lc(v?.dominant_color).includes("navy") ? null : "expected navy"),
  "wrong-size.jpg": (v, a) => clean(v, a) ?? (lc(v?.size_tag_text) === "l" ? null : "expected tag L"),
  "damaged.jpg": (v, a) => clean(v, a) ?? (v?.damage_detected ? null : "expected damage"),
  "no-code.jpg": (_v, a) => (a.decision === "NEEDS_NEW_PHOTO" ? null : "expected NEEDS_NEW_PHOTO"),
  "reused-listing.jpg": (_v, a) => (a.signals.includes("PHOTO_MATCHES_LISTING") ? null : "expected PHOTO_MATCHES_LISTING"),
};

if (process.env.JUDGE_MODE !== "true") throw new Error("set JUDGE_MODE=true");
let orderId = process.argv[2];
if (!orderId) {
  const [o] = await db()
    .select({ id: orders.paypalOrderId }).from(orders).innerJoin(intents, eq(orders.intentId, intents.id))
    .where(and(eq(orders.pool, true), eq(orders.status, "COMPLETED"), eq(orders.amount, "29.00")))
    .orderBy(desc(orders.createdAt)).limit(1);
  if (!o) throw new Error("no pool tee order: run scripts/seed-order-pool.ts first");
  orderId = o.id;
}

let failed = 0;
for (const [file, expect] of Object.entries(CASES)) {
  const t = Date.now();
  const { claimId } = await openClaim(orderId, "wrong_item", "sample check");
  const c = await addEvidence(claimId, readFileSync(`public/samples/${file}`));
  const v = c.evidence[0].visionResult as VisionResult | null;
  const problem = expect(v, c.assessment!);
  if (problem) failed++;
  console.log(`${problem ? "FAIL" : "PASS"} ${file.padEnd(19)} ${Date.now() - t}ms  ${problem ?? ""}`);
  console.log(`     code=${v?.challenge_code_found} color=${v?.dominant_color} tag=${v?.size_tag_text} type=${v?.item_type} damage=${v?.damage_detected} conf=${v?.confidence} | ${c.status} ${c.assessment!.signals.join(",")}`);
}
console.log(failed ? `${failed} FAILED` : "ALL PASS");
process.exit(failed ? 1 : 0);
