// Everything the merchant console shows, in one read: claims with their latest evidence, the approval queue,
// and the audit-chain check. Merchant-only (the route checks the judge login).
import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { auditEvents, claims, evidence, intents, orders } from "../db/schema";
import { verifyAudit } from "../audit/log";
import { pendingApprovals } from "../claims/resolve";
import { ISSUE_TEXT } from "../claims/extension";
import type { Assessment } from "../claims/fraud";
import type { VisionResult } from "../claims/vision";
import type { Reason } from "../fault/engine";
import { itemName, variantBySku, type Variant } from "../store/catalog";

type P = Record<string, any>;
const usd = (v: unknown) => (v ? ` $${v}` : "");
const act = (a: unknown) => String(a ?? "").toLowerCase().replaceAll("_", " ");
const codes = (r: unknown) => ((r as (string | { code: string })[] | undefined) ?? []).map((x) => (typeof x === "string" ? x : x.code)).join(", ");
const who = (p: P) => (p.proposedBy === "studio_agent" ? "Studio agent" : "Merchant");

/** One line per audit event, in words a merchant reads. The raw payload stays on the server. */
const STEP: Record<string, (p: P) => string> = {
  CLAIM_OPENED: (p) => `Claim opened: ${act(p.type)} (${p.mode ?? "?"} order)`,
  EVIDENCE_ADDED: (p) => `Photo checked: code ${p.vision?.challenge_code_found ?? "not found"}, ${p.vision?.dominant_color ?? "?"} ${p.vision?.item_type ?? ""}`.trim(),
  FAULT_DECIDED: (p) => `Fault: ${p.party ?? "no decision"}${codes(p.reasons) ? ` (${codes(p.reasons)})` : ""}`,
  OFFERS_CREATED: (p) => `${p.offers?.length ?? 0} remedies made by policy v${p.policyVersion}`,
  OFFER_CHOSEN: (p) => `Buyer chose ${act(p.action)}${usd(p.amount)}`,
  CHOICE_REJECTED: (p) => `Buyer's request rejected: ${act(p.reason)}`,
  CHOICE_BLOCKED: (p) => `Buyer's choice blocked: ${codes(p.reasons)}`,
  APPROVAL_REQUESTED: (p) => `Sent to the approval queue${usd(p.amount)}`,
  PROPOSAL_BLOCKED: (p) => `${who(p)} draft ${act(p.action)}${usd(p.amount)} blocked by policy: ${codes(p.reasons)}`,
  PROPOSAL_QUEUED: (p) => (p.rulesAmountAfterBlockedDraft ? `Queued at the policy amount instead${usd(p.amount)}` : `${who(p)} proposal queued: ${act(p.action)}${usd(p.amount)}`),
  APPROVAL_APPROVED: (p) => `Approved by ${p.decidedBy}: ${act(p.action)}${usd(p.amount)}`,
  APPROVAL_REJECTED: (p) => `Rejected by ${p.decidedBy}: ${act(p.action)}${usd(p.amount)}`,
  APPROVAL_BLOCKED: (p) => `Approval blocked by policy: ${codes(p.reasons)}`,
  REFUND_SENT: (p) => `Refund${usd(p.amount)} sent to PayPal (${p.refundId})`,
  REFUND_CONFIRMED: (p) => `PayPal confirmed the refund (webhook, ${p.secondsFromClaim}s after the claim)`,
  REPLACEMENT_SHIPPING: (p) => `Replacement shipping (tracking ${p.trackingNumber})`,
  CLAIM_DENIED: () => "Claim denied; Escalate to PayPal offered",
  ESCALATED_TO_PAYPAL: () => "Buyer escalated to PayPal",
};

export async function consoleData() {
  const rows = await db()
    .select({ claim: claims, order: orders, intent: intents })
    .from(claims).innerJoin(orders, eq(claims.orderId, orders.id)).leftJoin(intents, eq(orders.intentId, intents.id))
    .orderBy(desc(claims.createdAt)).limit(200);
  const ids = rows.map((r) => r.claim.id);
  const photos = ids.length
    ? await db().select({ id: evidence.id, claimId: evidence.claimId, photoPath: evidence.photoPath, visionResult: evidence.visionResult, fraudSignals: evidence.fraudSignals })
        .from(evidence).where(inArray(evidence.claimId, ids)).orderBy(desc(evidence.createdAt))
    : [];
  const latest = new Map<string, (typeof photos)[number]>();
  for (const p of photos) if (!latest.has(p.claimId)) latest.set(p.claimId, p);

  const [approvals, audit, events] = await Promise.all([
    pendingApprovals(),
    verifyAudit(),
    ids.length ? db().select().from(auditEvents).where(inArray(auditEvents.claimId, ids)).orderBy(asc(auditEvents.seq)) : [],
  ]);
  const timeline = new Map<string, { seq: number; event: string; at: string; text: string }[]>();
  for (const e of events) {
    const list = timeline.get(e.claimId!) ?? [];
    list.push({ seq: e.seq, event: e.event, at: e.createdAt.toISOString(), text: STEP[e.event]?.(e.payload as P) ?? act(e.event) });
    timeline.set(e.claimId!, list);
  }
  return {
    claims: rows.map(({ claim, order, intent }) => {
      const item = (order.chosenItem as Variant | null) ?? variantBySku((intent?.cart as { sku: string }[] | null)?.[0]?.sku ?? "") ?? null;
      const ev = latest.get(claim.id);
      const reasons = ((claim.reasons as Reason[] | null) ?? []).map((r) => ({ ...r, text: ISSUE_TEXT[r.code] ?? r.code }));
      return {
        id: claim.id,
        createdAt: claim.createdAt.toISOString(),
        type: claim.type,
        status: claim.status,
        faultParty: claim.faultParty,
        description: claim.description,
        mode: intent?.mode ?? null,
        paypalOrderId: order.paypalOrderId,
        amount: order.amount,
        currency: order.currency,
        item: item && { name: itemName(item), type: item.type, color: item.color, size: item.size },
        reasons,
        photoPath: ev?.photoPath ?? null,
        vision: (ev?.visionResult as VisionResult | null) ?? null,
        timeline: timeline.get(claim.id) ?? [],
        signals: ((ev?.fraudSignals as Assessment | null)?.signals ?? []).map((code) => ({ code, text: ISSUE_TEXT[code] ?? code })),
      };
    }),
    approvals: approvals.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    audit: { ok: audit.ok, count: audit.count, brokenAt: audit.brokenAt, checkedAt: audit.checkedAt },
  };
}

export type ConsoleData = Awaited<ReturnType<typeof consoleData>>;
