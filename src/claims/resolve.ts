// Claim resolution: offers after a fault ruling, the buyer's choice, proposals, the merchant's approval queue and
// the refund webhook. Every step re-runs the evaluator and is written to the audit log. Money moves only through
// src/money/router.ts, and only after ALLOW or a person's approval.
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { approvals, claims, evidence, intents, moneyActions, offers, orders, shipments } from "../db/schema";
import type { FaultParty, Reason } from "../fault/engine";
import { fromCents } from "../money/cents";
import { refundCapture } from "../money/router";
import { explainOffers, templateExplanation } from "../offers/explain";
import { ESCALATE_URL, generateOffers, type OfferDraft } from "../offers/generate";
import { merchant } from "../paypal/client";
import { evaluate, type Action, type EvalContext } from "../policy/evaluator";
import { activePolicy } from "../policy/store";
import { ClaimError } from "./claims";
import type { Assessment } from "./fraud";

const DAY = 86_400_000;
const RETURN_ACTIONS: readonly Action[] = ["REFUND_ON_RETURN", "STANDARD_RETURN"];
/** Claim states where nothing more can be chosen or proposed. */
const FINAL = ["REFUND_SENT", "RESOLVED", "DENIED", "ESCALATED"];

async function context(claimId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claimId)) throw new ClaimError(`unknown claim ${claimId}`);
  const [claim] = await db().select().from(claims).where(eq(claims.id, claimId));
  if (!claim) throw new ClaimError(`unknown claim ${claimId}`);
  const [order] = await db().select().from(orders).where(eq(orders.id, claim.orderId));
  const [intent] = await db().select().from(intents).where(eq(intents.id, order.intentId!));
  const [shipment] = await db().select().from(shipments).where(eq(shipments.orderId, order.id));
  const [ev] = await db().select({ a: evidence.fraudSignals }).from(evidence).where(eq(evidence.claimId, claimId)).orderBy(desc(evidence.createdAt)).limit(1);
  // Refunds already made on this capture, by any claim on the order (failed attempts don't count).
  const [{ refunded }] = await db()
    .select({ refunded: sql<string>`coalesce(sum(${moneyActions.amount}), 0)::numeric(12,2)::text` })
    .from(moneyActions).innerJoin(claims, eq(moneyActions.claimId, claims.id))
    .where(and(eq(claims.orderId, order.id), eq(moneyActions.kind, "refund"), ne(moneyActions.status, "FAILED")));
  const policy = await activePolicy();
  const evalContext = (party: FaultParty): EvalContext => ({
    party, policy, mode: intent.mode, currency: order.currency, captureAmount: order.amount!, refunded, ceiling: order.ceiling,
    disputed: false, // shortcut: no dispute check yet; Day 9 adds it (and the TRANSACTION_DISPUTED guard) before every refund
    returnRequired: (ev?.a as Assessment | null)?.returnRequired ?? false,
  });
  return { claim, order, intent, shipment, policy, refunded, evalContext };
}

/** After a fault ruling: replaces any earlier, unchosen offers with fresh rule-made ones and their explanations. */
export async function createOffers(claimId: string) {
  const c = await context(claimId);
  const party = c.claim.faultParty as FaultParty | null;
  const reasons = (c.claim.reasons ?? []) as Reason[];
  const [chosen] = await db().select({ id: offers.id }).from(offers).where(and(eq(offers.claimId, claimId), eq(offers.chosen, true))).limit(1);
  if (chosen) return; // a remedy is already under way; a new photo doesn't reopen it
  await db().delete(approvals).where(eq(approvals.claimId, claimId));
  await db().delete(offers).where(eq(offers.claimId, claimId));
  if (!party) return;

  const now = Date.now();
  const delivered = c.shipment?.deliveredAt?.getTime() ?? null;
  const promised = c.order.promisedBy?.getTime() ?? null;
  const drafts = generateOffers({
    ...c.evalContext(party),
    party,
    reasons,
    daysLate: delivered && promised && delivered > promised ? (delivered - promised) / DAY : null,
    daysSinceDelivery: delivered ? (now - delivered) / DAY : null,
  });
  const explanations = await explainOffers(drafts, party, reasons);
  const rows = await db()
    .insert(offers)
    .values(drafts.map((d, n) => ({ claimId, action: d.action, amount: d.amount, currency: d.currency, ruleIds: d.ruleIds, explanation: { ...explanations[n], label: d.label, verdict: d.verdict } })))
    .returning({ id: offers.id });
  await db().update(claims).set({ status: "OFFERED" }).where(eq(claims.id, claimId));
  await audit(claimId, "OFFERS_CREATED", { policyVersion: c.policy.version, party, offers: drafts.map((d, n) => ({ id: rows[n].id, action: d.action, amount: d.amount, ruleIds: d.ruleIds, verdict: d.verdict, explainedBy: explanations[n].source })) });
}

async function setClaim(claimId: string, status: string) {
  await db().update(claims).set({ status }).where(eq(claims.id, claimId));
}

/** Carries out an allowed remedy. Refunds go through the money router; nothing here is reachable by an LLM. */
async function execute(c: Awaited<ReturnType<typeof context>>, offer: typeof offers.$inferSelect, version: number) {
  const claimId = c.claim.id;
  switch (offer.action as Action) {
    case "PARTIAL_REFUND_KEEP_ITEM":
    case "REFUND_ON_RETURN":
    case "STANDARD_RETURN": {
      const r = await refundCapture({ claimId, captureId: c.order.captureId!, amount: offer.amount!, action: offer.action, version });
      await setClaim(claimId, "REFUND_SENT");
      await audit(claimId, "REFUND_SENT", { offerId: offer.id, action: offer.action, amount: r.amount, refundId: r.refundId, paypalStatus: r.status, requestId: r.requestId });
      return { status: "REFUND_SENT", refund: r };
    }
    case "EXCHANGE":
    case "REPLACEMENT": {
      // No money moves: a tracker for the new shipment is added to the PayPal order.
      const trackingNumber = `FERNR${claimId.slice(0, 8).toUpperCase()}`;
      await merchant().request("POST", `/v2/checkout/orders/${c.order.paypalOrderId}/track`, {
        requestId: `${claimId}:${offer.action}:track`,
        body: { capture_id: c.order.captureId, tracking_number: trackingNumber, carrier: "OTHER", carrier_name_other: "Fernleaf Courier", notify_payer: false },
      });
      await setClaim(claimId, "RESOLVED");
      await audit(claimId, "REPLACEMENT_SHIPPING", { offerId: offer.id, action: offer.action, trackingNumber });
      return { status: "RESOLVED", trackingNumber };
    }
    case "DENY_WITH_REASON":
      await setClaim(claimId, "DENIED");
      await audit(claimId, "CLAIM_DENIED", { offerId: offer.id, reasons: c.claim.reasons, escalateUrl: ESCALATE_URL });
      return { status: "DENIED", escalateUrl: ESCALATE_URL };
    case "ESCALATE_TO_PAYPAL":
      await setClaim(claimId, "ESCALATED");
      await audit(claimId, "ESCALATED_TO_PAYPAL", { offerId: offer.id, escalateUrl: ESCALATE_URL });
      return { status: "ESCALATED", escalateUrl: ESCALATE_URL };
    case "AGENT_PLATFORM_PAYOUT":
      throw new ClaimError("agent-platform payouts are not live yet (Day 9); the ruling and the amount owed stand");
    case "HUMAN_REVIEW":
      throw new ClaimError("a review has no remedy of its own: propose a remedy for this claim instead");
  }
}

const NEEDS_PERSON: Record<string, string> = { QUEUE: "QUEUED", HUMAN_REVIEW: "IN_REVIEW", RETURN: "AWAITING_RETURN" };

/** The buyer (or their agent) picks one rule-made offer. An amount that was never offered is rejected. */
export async function chooseOffer(claimId: string, offerId: string, requestedAmount?: string) {
  const c = await context(claimId);
  const [offer] = await db().select().from(offers).where(and(eq(offers.id, offerId), eq(offers.claimId, claimId)));
  if (!offer) throw new ClaimError("that offer does not belong to this claim");
  if (requestedAmount !== undefined && (offer.amount === null || fromCents(Math.round(Number(requestedAmount) * 100)) !== offer.amount)) {
    await audit(claimId, "CHOICE_REJECTED", { offerId, requestedAmount, offeredAmount: offer.amount, reason: "AMOUNT_NOT_OFFERED" });
    throw new ClaimError(`amount ${requestedAmount} was never offered; choose an offer as it stands`);
  }
  const verdict = evaluate({ action: offer.action as Action, amount: offer.amount, currency: offer.currency }, c.evalContext(c.claim.faultParty as FaultParty));
  if (verdict.verdict === "BLOCK") {
    await audit(claimId, "CHOICE_BLOCKED", { offerId, action: offer.action, amount: offer.amount, reasons: verdict.reasons });
    throw new ClaimError(`blocked by the store's policy: ${verdict.reasons.join(", ")}`);
  }
  // Only one choice per claim, even if two requests race.
  const [won] = await db().update(claims).set({ status: "CHOSEN" }).where(and(eq(claims.id, claimId), eq(claims.status, "OFFERED"))).returning({ id: claims.id });
  if (!won) throw new ClaimError(`this claim is ${c.claim.status}; a remedy can be chosen only once`);
  await db().update(offers).set({ chosen: true }).where(eq(offers.id, offerId));
  await audit(claimId, "OFFER_CHOSEN", { offerId, action: offer.action, amount: offer.amount, verdict: verdict.verdict });

  const waitFor = offer.action === "HUMAN_REVIEW" ? "HUMAN_REVIEW" : RETURN_ACTIONS.includes(offer.action as Action) ? "RETURN" : verdict.verdict === "QUEUE" ? "QUEUE" : null;
  if (waitFor) {
    const [a] = await db().insert(approvals).values({ claimId, offerId, proposedBy: "system", status: "PENDING" }).returning({ id: approvals.id });
    await setClaim(claimId, NEEDS_PERSON[waitFor]);
    await audit(claimId, "APPROVAL_REQUESTED", { approvalId: a.id, offerId, action: offer.action, amount: offer.amount, why: waitFor });
    return { status: NEEDS_PERSON[waitFor], approvalId: a.id };
  }
  return execute(c, offer, 1);
}

/**
 * A remedy drafted by the merchant or the Studio agent. It never moves money itself: BLOCK is rejected with
 * reasons, anything else waits in the approval queue for a person's tap. On an UNCLEAR claim the reviewer
 * states which party is at fault, and the evaluator applies that party's rules.
 */
export async function proposeRemedy(claimId: string, p: { action: Action; amount: string | null; asParty?: FaultParty }, proposedBy: "system" | "studio_agent") {
  const c = await context(claimId);
  if (FINAL.includes(c.claim.status)) throw new ClaimError(`this claim is already ${c.claim.status}`);
  if (p.asParty && c.claim.faultParty !== "UNCLEAR") throw new ClaimError("the fault party can only be set by a reviewer on an UNCLEAR claim");
  const party = (p.asParty ?? c.claim.faultParty) as FaultParty;
  if (!party) throw new ClaimError("this claim has no fault ruling yet");
  const amount = p.amount === null ? null : fromCents(Math.round(Number(p.amount) * 100));
  const verdict = evaluate({ action: p.action, amount, currency: c.order.currency }, c.evalContext(party));
  if (verdict.verdict === "BLOCK") {
    await audit(claimId, "PROPOSAL_BLOCKED", { proposedBy, action: p.action, amount, party, reasons: verdict.reasons });
    return { verdict: "BLOCK" as const, reasons: verdict.reasons };
  }
  const draft: OfferDraft = { action: p.action, amount, currency: c.order.currency, ruleIds: [`proposed_by:${proposedBy}`], label: "Proposed remedy", verdict: verdict.verdict };
  const [offer] = await db().insert(offers).values({ claimId, action: p.action, amount, currency: draft.currency, ruleIds: draft.ruleIds, explanation: { ...templateExplanation(draft, party), label: draft.label, verdict: draft.verdict, party } }).returning({ id: offers.id });
  const [a] = await db().insert(approvals).values({ claimId, offerId: offer.id, proposedBy, status: "PENDING" }).returning({ id: approvals.id });
  await audit(claimId, "PROPOSAL_QUEUED", { proposedBy, approvalId: a.id, offerId: offer.id, action: p.action, amount, party, verdict: verdict.verdict });
  return { verdict: verdict.verdict, reasons: verdict.reasons, approvalId: a.id };
}

/** A person's tap in the approval queue. Approve re-runs the evaluator, then carries out the remedy. */
export async function decideApproval(approvalId: string, decision: "approve" | "reject", decidedBy: string) {
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) throw new ClaimError(`unknown approval ${approvalId}`);
  const [a] = await db().select().from(approvals).where(eq(approvals.id, approvalId));
  if (!a || a.status !== "PENDING") throw new ClaimError(`approval ${approvalId} is ${a?.status ?? "unknown"}`);
  const [offer] = await db().select().from(offers).where(eq(offers.id, a.offerId!));
  const c = await context(a.claimId);
  const party = ((offer.explanation as { party?: FaultParty } | null)?.party ?? c.claim.faultParty) as FaultParty;
  const done = (status: string) => db().update(approvals).set({ status, decidedBy, decidedAt: new Date() }).where(and(eq(approvals.id, approvalId), eq(approvals.status, "PENDING"))).returning({ id: approvals.id });

  if (decision === "reject") {
    if (!(await done("REJECTED")).length) throw new ClaimError("this approval was already decided");
    if (offer.chosen) {
      // The buyer's queued choice was refused: the offers open again (escalating to PayPal is always one of them).
      await db().update(offers).set({ chosen: false }).where(eq(offers.id, offer.id));
      await setClaim(c.claim.id, "OFFERED");
    }
    await audit(c.claim.id, "APPROVAL_REJECTED", { approvalId, offerId: offer.id, action: offer.action, amount: offer.amount, decidedBy });
    return { status: "REJECTED" };
  }
  if (FINAL.includes(c.claim.status)) throw new ClaimError(`this claim is already ${c.claim.status}`);
  if (offer.action === "HUMAN_REVIEW") throw new ClaimError("a review has no remedy of its own: propose a remedy for this claim, then approve that");
  const verdict = evaluate({ action: offer.action as Action, amount: offer.amount, currency: offer.currency }, c.evalContext(party));
  if (verdict.verdict === "BLOCK") {
    await audit(c.claim.id, "APPROVAL_BLOCKED", { approvalId, reasons: verdict.reasons });
    throw new ClaimError(`blocked by the store's policy: ${verdict.reasons.join(", ")}`);
  }
  if (!(await done("APPROVED")).length) throw new ClaimError("this approval was already decided");
  // Other open items for this claim are settled by this decision.
  await db().update(approvals).set({ status: "SUPERSEDED", decidedBy, decidedAt: new Date() }).where(and(eq(approvals.claimId, c.claim.id), eq(approvals.status, "PENDING")));
  await db().update(offers).set({ chosen: true }).where(eq(offers.id, offer.id));
  await audit(c.claim.id, "APPROVAL_APPROVED", { approvalId, offerId: offer.id, action: offer.action, amount: offer.amount, decidedBy, verdict: verdict.verdict });
  return execute(c, offer, 1);
}

/** PAYMENT.CAPTURE.REFUNDED (verified webhook): confirms the refund and resolves the claim. Idempotent. */
export async function confirmRefund(refundId: string) {
  const [m] = await db().update(moneyActions).set({ status: "CONFIRMED" }).where(and(eq(moneyActions.paypalRef, refundId), ne(moneyActions.status, "CONFIRMED"))).returning();
  if (!m?.claimId) return null; // unknown refund or already confirmed
  const [c] = await db().update(claims).set({ status: "RESOLVED" }).where(eq(claims.id, m.claimId)).returning();
  const secondsFromClaim = Math.round((Date.now() - c.createdAt.getTime()) / 1000);
  await audit(m.claimId, "REFUND_CONFIRMED", { refundId, amount: m.amount, requestId: m.requestId, secondsFromClaim });
  return { claimId: m.claimId, secondsFromClaim };
}

/** Pending items for the merchant's approval queue, newest first. */
export async function pendingApprovals() {
  return db()
    .select({ id: approvals.id, claimId: approvals.claimId, proposedBy: approvals.proposedBy, createdAt: approvals.createdAt, action: offers.action, amount: offers.amount, explanation: offers.explanation, claimStatus: claims.status, faultParty: claims.faultParty, paypalOrderId: orders.paypalOrderId, orderAmount: orders.amount })
    .from(approvals)
    .innerJoin(offers, eq(approvals.offerId, offers.id))
    .innerJoin(claims, eq(approvals.claimId, claims.id))
    .innerJoin(orders, eq(claims.orderId, orders.id))
    .where(eq(approvals.status, "PENDING"))
    .orderBy(desc(approvals.createdAt));
}

/** Offers, approvals and money actions for the claim page. */
export async function resolutionOf(claimId: string) {
  const [o, a, m] = await Promise.all([
    db().select().from(offers).where(eq(offers.claimId, claimId)),
    db().select().from(approvals).where(eq(approvals.claimId, claimId)).orderBy(desc(approvals.createdAt)),
    db().select().from(moneyActions).where(eq(moneyActions.claimId, claimId)),
  ]);
  const proposals = new Set(a.filter((x) => x.proposedBy !== "system").map((x) => x.offerId));
  return { offers: o.filter((x) => !proposals.has(x.id)), approvals: a, moneyActions: m, escalateUrl: ESCALATE_URL };
}

