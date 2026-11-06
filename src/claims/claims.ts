// Claim intake: open a claim (challenge code + upload link), add a photo (normalize, hash, vision, fraud checks),
// the buyer contesting the delivery date, and the merchant reporting tracking + delivery.
import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../db";
import { claims, evidence, intents, orders, shipments, visionCache } from "../db/schema";
import { decideFault, type Item } from "../fault/engine";
import type { Limits } from "../intent/limits";
import { getOrder } from "../intent/orders";
import { merchant } from "../paypal/client";
import { activePolicy } from "../policy/store";
import LISTING_HASHES from "../store/listing-hashes.json";
import { PROMISE_DAYS, variantBySku } from "../store/catalog";
import { codeMatches, newChallengeCode } from "./code";
import { assess, type Assessment } from "./fraud";
import { findMatches, phash, type HashedPhoto } from "./phash";
import { analyzePhoto, type VisionResult } from "./vision";
import { audit } from "../audit/log";
import { createOffers, resolutionOf } from "./resolve";

export class ClaimError extends Error {}

export const CLAIM_TYPES = ["wrong_item", "damaged", "late", "not_as_expected", "changed_mind", "agent_mistake", "other"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** New evidence can change the ruling only until a remedy is chosen. */
const OPEN_STATES = ["AWAITING_PHOTO", "NEEDS_NEW_PHOTO", "DECIDED", "OFFERED"];
const assertOpen = (c: typeof claims.$inferSelect) => {
  if (!OPEN_STATES.includes(c.status)) throw new ClaimError(`this claim is ${c.status}; its evidence can no longer change`);
};

export async function openClaim(paypalOrderId: string, type: ClaimType, description: string) {
  const o = await getOrder(paypalOrderId);
  if (!o.captureId || o.status !== "COMPLETED") throw new ClaimError(`order ${paypalOrderId} is ${o.status}; a claim needs a completed purchase`);
  const [c] = await db()
    .insert(claims)
    .values({ orderId: o.id, type, description: description.slice(0, 2000), challengeCode: newChallengeCode(), status: "AWAITING_PHOTO" })
    .returning();
  await audit(c.id, "CLAIM_OPENED", { paypalOrderId, type, mode: o.intent?.mode ?? null, intentHash: o.intent?.hash ?? null });
  return { claimId: c.id, challengeCode: c.challengeCode, uploadUrl: `${process.env.APP_BASE_URL ?? ""}/claims/${c.id}` };
}

/**
 * One listing photo per product and color (size doesn't change the picture). Hashed ahead of time by
 * scripts/hash-listings.ts, because files in public/ are not readable from serverless functions.
 */
const listings = (): HashedPhoto[] => Object.entries(LISTING_HASHES).map(([ref, hash]) => ({ kind: "listing" as const, ref, hash }));

/**
 * Any earlier photo from another claim. A retake on the same claim is not a reuse. Judge-mode pool claims skip
 * other pool claims, because every judge uploads the same sample photos.
 */
async function earlierClaimPhotos(claimId: string, judgeSample: boolean): Promise<HashedPhoto[]> {
  const rows = await db()
    .select({ id: evidence.id, hash: evidence.phash })
    .from(evidence)
    .innerJoin(claims, eq(evidence.claimId, claims.id))
    .innerJoin(orders, eq(claims.orderId, orders.id))
    .where(and(ne(evidence.claimId, claimId), isNotNull(evidence.phash), judgeSample ? eq(orders.pool, false) : undefined));
  return rows.map((r) => ({ kind: "earlier_claim", ref: r.id, hash: r.hash! }));
}

const isJudgeSample = (order: typeof orders.$inferSelect) => process.env.JUDGE_MODE === "true" && order.pool;

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function loadClaim(claimId: string) {
  if (!isUuid(claimId)) throw new ClaimError(`unknown claim ${claimId}`);
  const [c] = await db().select().from(claims).where(eq(claims.id, claimId));
  if (!c) throw new ClaimError(`unknown claim ${claimId}`);
  const [o] = await db().select().from(orders).where(eq(orders.id, c.orderId));
  return { claim: c, order: o };
}

export async function addEvidence(claimId: string, upload: Buffer) {
  const { claim, order } = await loadClaim(claimId);
  assertOpen(claim);
  if (upload.length > MAX_PHOTO_BYTES) throw new ClaimError("photo is larger than 10 MB");
  let jpeg: Buffer;
  try {
    jpeg = await sharp(upload).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    throw new ClaimError("that file is not a readable image");
  }
  const hash = await phash(jpeg);
  // The exact same photo bytes get the stored findings: no second model call, and the same answer every time.
  const sha256 = createHash("sha256").update(jpeg).digest("hex");
  const [cached] = await db().select().from(visionCache).where(eq(visionCache.sha256, sha256));
  let vision: VisionResult | null = cached ? (cached.result as VisionResult) : null;
  for (let attempt = 1; attempt <= 2 && !vision; attempt++) {
    try {
      vision = await analyzePhoto(jpeg);
      await db().insert(visionCache).values({ sha256, result: vision }).onConflictDoNothing();
    } catch (e) {
      console.error(`[vision] attempt ${attempt}:`, (e as Error).message); // after 2 failures: VISION_FAILED, a person reviews it
    }
  }
  const photoMatches = findMatches(hash, [...listings(),...(await earlierClaimPhotos(claimId, isJudgeSample(order)))]);
  const [ev] = await db().insert(evidence).values({ claimId, photoPath: "", photo: jpeg, phash: hash, visionResult: vision, fraudSignals: { photoMatches } }).returning({ id: evidence.id });
  await db().update(evidence).set({ photoPath: `/api/evidence/${ev.id}/photo` }).where(eq(evidence.id, ev.id));
  await audit(claimId, "EVIDENCE_ADDED", { evidenceId: ev.id, phash: hash, vision, photoMatches });
  await refreshAssessment(claim, order);
  return getClaim(claimId);
}

/** Recomputes the fraud checks from stored facts onto the latest photo, and moves the claim status. */
async function refreshAssessment(claim: typeof claims.$inferSelect, order: typeof orders.$inferSelect) {
  const [ev] = await db().select().from(evidence).where(eq(evidence.claimId, claim.id)).orderBy(desc(evidence.createdAt)).limit(1);
  if (!ev) return;
  const vision = ev.visionResult as VisionResult | null;
  const policy = await activePolicy();
  const a: Assessment = assess({
    codeFound: codeMatches(vision?.challenge_code_found, claim.challengeCode, isJudgeSample(order)),
    photoMatches: (ev.fraudSignals as { photoMatches?: Assessment["photoMatches"] } | null)?.photoMatches ?? [],
    visionConfidence: vision?.confidence ?? null,
    deliveryContested: claim.deliveryContested,
    claimValue: order.amount!,
    requireReturnAbove: policy.requireReturnAbove,
  });
  await db().update(evidence).set({ fraudSignals: a }).where(eq(evidence.id, ev.id));

  const [intent] = await db().select().from(intents).where(eq(intents.id, order.intentId!));
  const [shipment] = await db().select().from(shipments).where(eq(shipments.orderId, order.id));
  const ordered: Item | undefined = intent.mode === "CONFIRMED" ? variantBySku((intent.cart as { sku: string }[])[0].sku) : (order.chosenItem as Item);
  if (!ordered || !order.promisedBy) throw new ClaimError(`order ${order.paypalOrderId} has no recorded item or promised date`);
  const fault = decideFault({
    assessment: a,
    vision,
    mode: intent.mode,
    ordered,
    limits: intent.limits as Limits,
    capturedAt: new Date(order.promisedBy.getTime() - PROMISE_DAYS * 86_400_000).toISOString(), // promised_by = capture + PROMISE_DAYS
    promisedBy: order.promisedBy.toISOString(),
    deliveredAt: shipment?.deliveredAt?.toISOString() ?? null,
  });
  await db()
    .update(claims)
    .set({ status: fault.party ? "DECIDED" : "NEEDS_NEW_PHOTO", faultParty: fault.party, reasons: fault.reasons })
    .where(eq(claims.id, claim.id));
  await audit(claim.id, "FAULT_DECIDED", { party: fault.party, reasons: fault.reasons, signals: a.signals, returnRequired: a.returnRequired, policyVersion: policy.version });
  await createOffers(claim.id);
}

/** The buyer disputes the merchant-reported delivery date: fraud check 5, so a person decides. */
export async function contestDelivery(claimId: string) {
  const { claim, order } = await loadClaim(claimId);
  assertOpen(claim);
  await db().update(claims).set({ deliveryContested: true }).where(eq(claims.id, claimId));
  await refreshAssessment({ ...claim, deliveryContested: true }, order);
  return getClaim(claimId);
}

export async function getClaim(claimId: string) {
  const { claim } = await loadClaim(claimId);
  const [order, [shipment], photos, resolution] = await Promise.all([
    db().select({ paypalOrderId: orders.paypalOrderId }).from(orders).where(eq(orders.id, claim.orderId)).then(([r]) => getOrder(r.paypalOrderId)),
    db().select().from(shipments).where(eq(shipments.orderId, claim.orderId)),
    db().select({ id: evidence.id, photoPath: evidence.photoPath, phash: evidence.phash, visionResult: evidence.visionResult, fraudSignals: evidence.fraudSignals, createdAt: evidence.createdAt })
      .from(evidence).where(eq(evidence.claimId, claimId)).orderBy(desc(evidence.createdAt)),
    resolutionOf(claimId),
  ]);
  return { ...claim, order, shipment: shipment ?? null, evidence: photos, assessment: (photos[0]?.fraudSignals as Assessment | undefined) ?? null, ...resolution };
}

export async function getEvidencePhoto(evidenceId: string) {
  if (!isUuid(evidenceId)) throw new ClaimError(`unknown evidence ${evidenceId}`);
  const [row] = await db().select({ photo: evidence.photo }).from(evidence).where(eq(evidence.id, evidenceId));
  if (!row) throw new ClaimError(`unknown evidence ${evidenceId}`);
  return row.photo;
}

/**
 * Merchant: report shipment and delivery. Adds a tracker through the Orders tracking API once per order
 * (proven in spike S5), and records the merchant-reported delivered_at that the fault engine checks.
 */
export async function recordDelivery(paypalOrderId: string, deliveredAt: Date, trackingNumber?: string) {
  const o = await getOrder(paypalOrderId);
  if (!o.captureId) throw new ClaimError(`order ${paypalOrderId} has no capture to track`);
  const [existing] = await db().select().from(shipments).where(eq(shipments.orderId, o.id));
  const tracking = existing?.trackingNumber ?? trackingNumber ?? `FERN${o.paypalOrderId.slice(-8)}`;
  if (!existing?.trackingNumber) {
    await merchant().request("POST", `/v2/checkout/orders/${paypalOrderId}/track`, {
      requestId: `${paypalOrderId}:track`,
      body: { capture_id: o.captureId, tracking_number: tracking, carrier: "OTHER", carrier_name_other: "Fernleaf Courier", notify_payer: false },
    });
  }
  const row = { orderId: o.id, trackingNumber: tracking, carrier: "Fernleaf Courier", status: "DELIVERED", deliveredAt };
  await db().insert(shipments).values(row).onConflictDoUpdate({ target: shipments.orderId, set: row });
  return { ...row, paypalOrderId };
}
