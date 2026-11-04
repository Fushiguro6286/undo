// Claim intake: open a claim (challenge code + upload link), add a photo (normalize, hash, vision, fraud checks),
// the buyer contesting the delivery date, and the merchant reporting tracking + delivery.
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import sharp from "sharp";
import { db } from "../db";
import { claims, evidence, orders, shipments } from "../db/schema";
import { getOrder } from "../intent/orders";
import { merchant } from "../paypal/client";
import { DEFAULT_POLICY } from "../policy/schema";
import { productSvg } from "../store/art";
import { PRODUCTS } from "../store/catalog";
import { codeMatches, newChallengeCode } from "./code";
import { assess, type Assessment } from "./fraud";
import { findMatches, phash, type HashedPhoto } from "./phash";
import { analyzePhoto, type VisionResult } from "./vision";

export class ClaimError extends Error {}

export const CLAIM_TYPES = ["wrong_item", "damaged", "late", "not_as_expected", "changed_mind", "agent_mistake", "other"] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

// shortcut: policy is the built-in default until Day 4 adds compiled, merchant-approved policies.
const activePolicy = async () => DEFAULT_POLICY;

export async function openClaim(paypalOrderId: string, type: ClaimType, description: string) {
  const o = await getOrder(paypalOrderId);
  if (!o.captureId || o.status !== "COMPLETED") throw new ClaimError(`order ${paypalOrderId} is ${o.status}; a claim needs a completed purchase`);
  const [c] = await db()
    .insert(claims)
    .values({ orderId: o.id, type, description: description.slice(0, 2000), challengeCode: newChallengeCode(), status: "AWAITING_PHOTO" })
    .returning();
  return { claimId: c.id, challengeCode: c.challengeCode, uploadUrl: `${process.env.APP_BASE_URL ?? ""}/claims/${c.id}` };
}

let listingHashes: Promise<HashedPhoto[]> | undefined;
/** One listing photo per product and color (size doesn't change the picture), rendered the same way the store shows it. */
const listings = () =>
  (listingHashes ??= Promise.all(
    PRODUCTS.flatMap((p) => p.colors.map(async (color) => ({ kind: "listing" as const, ref: `${p.id}/${color}`, hash: await phash(await sharp(Buffer.from(productSvg(p.type, color))).resize(480).png().toBuffer()) }))),
  ));

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
  if (upload.length > MAX_PHOTO_BYTES) throw new ClaimError("photo is larger than 10 MB");
  let jpeg: Buffer;
  try {
    jpeg = await sharp(upload).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
  } catch {
    throw new ClaimError("that file is not a readable image");
  }
  const hash = await phash(jpeg);
  let vision: VisionResult | null = null;
  try {
    vision = await analyzePhoto(jpeg);
  } catch (e) {
    console.error("[vision]", (e as Error).message); // VISION_FAILED: a person reviews it
  }
  const photoMatches = findMatches(hash, [...(await listings()), ...(await earlierClaimPhotos(claimId, isJudgeSample(order)))]);
  const [ev] = await db().insert(evidence).values({ claimId, photoPath: "", photo: jpeg, phash: hash, visionResult: vision, fraudSignals: { photoMatches } }).returning({ id: evidence.id });
  await db().update(evidence).set({ photoPath: `/api/evidence/${ev.id}/photo` }).where(eq(evidence.id, ev.id));
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
  await db().update(claims).set({ status: a.decision === "NEEDS_NEW_PHOTO" ? "NEEDS_NEW_PHOTO" : "EVIDENCE_READY" }).where(eq(claims.id, claim.id));
}

/** The buyer disputes the merchant-reported delivery date: fraud check 5, so a person decides. */
export async function contestDelivery(claimId: string) {
  const { claim, order } = await loadClaim(claimId);
  await db().update(claims).set({ deliveryContested: true }).where(eq(claims.id, claimId));
  await refreshAssessment({ ...claim, deliveryContested: true }, order);
  return getClaim(claimId);
}

export async function getClaim(claimId: string) {
  const { claim } = await loadClaim(claimId);
  const [order, [shipment], photos] = await Promise.all([
    db().select({ paypalOrderId: orders.paypalOrderId }).from(orders).where(eq(orders.id, claim.orderId)).then(([r]) => getOrder(r.paypalOrderId)),
    db().select().from(shipments).where(eq(shipments.orderId, claim.orderId)),
    db().select({ id: evidence.id, photoPath: evidence.photoPath, phash: evidence.phash, visionResult: evidence.visionResult, fraudSignals: evidence.fraudSignals, createdAt: evidence.createdAt })
      .from(evidence).where(eq(evidence.claimId, claimId)).orderBy(desc(evidence.createdAt)),
  ]);
  return { ...claim, order, shipment: shipment ?? null, evidence: photos, assessment: (photos[0]?.fraudSignals as Assessment | undefined) ?? null };
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
