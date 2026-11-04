// Escalated claims (spec section 13). Each call runs at most ONE step, and only a step the dispute's own HATEOAS
// links offer, in the sandbox order: require-evidence (sandbox-only) -> provide-evidence with the evidence pack, or
// accept-claim when the merchant is at fault -> adjudicate (sandbox-only). PayPal moves the case in between
// (about 1-3 minutes per transition, spike S8), so callers advance again later.
import { and, eq, like, ne } from "drizzle-orm";
import { audit } from "../audit/log";
import { db } from "../db";
import { approvals, claims, disputes, moneyActions } from "../db/schema";
import { acceptDisputeClaim } from "../money/router";
import { merchant } from "../paypal/client";
import { evidencePack } from "./pack";
import { syncDispute } from "./sync";

export type Step = { step: "REQUIRE_EVIDENCE" | "PROVIDE_EVIDENCE" | "ACCEPT_CLAIM" | "ADJUDICATE" | "WAITING" | "RESOLVED"; disputeId: string; status: string; stage: string | null; links: string[]; detail?: Record<string, unknown> };

const MERCHANT_PAYS = ["MERCHANT", "CARRIER"];

async function show(id: string) {
  const d = await merchant().request("GET", `/v1/customer/disputes/${encodeURIComponent(id)}`);
  const links: string[] = (d.links ?? []).map((l: { href: string }) => l.href.split("/").pop()!).filter((a: string) => a !== id);
  return { d, links };
}

/** The open dispute on a claim, if any. */
export async function disputeOfClaim(claimId: string) {
  const [row] = await db().select().from(disputes).where(and(eq(disputes.claimId, claimId), ne(disputes.status, "RESOLVED"))).limit(1);
  return row ?? null;
}

/**
 * One step on a dispute. `decidedBy` is the person who tapped "answer in PayPal" (accept-claim moves money, so it
 * runs only with a person). Disputes with no Undo claim (e.g. the spike order) can only get PayPal-side evidence.
 */
export async function advanceDispute(disputeId: string, decidedBy: string, opts: { allowAccept?: boolean } = {}): Promise<Step> {
  const synced = await syncDispute(disputeId);
  const [row] = await db().select().from(disputes).where(eq(disputes.paypalDisputeId, disputeId));
  const [claim] = row?.claimId ? await db().select().from(claims).where(eq(claims.id, row.claimId)) : [];
  const { d, links } = await show(disputeId);
  const base = { disputeId, status: d.status as string, stage: (d.dispute_life_cycle_stage ?? null) as string | null, links };
  const can = (a: string) => links.includes(a);
  const log = (event: string, payload: Record<string, unknown>) => (claim ? audit(claim.id, event, { disputeId, ...payload }) : Promise.resolve());
  const used = () => db().update(disputes).set({ used: true }).where(eq(disputes.paypalDisputeId, disputeId));
  if (synced.status === "RESOLVED") return { step: "RESOLVED", ...base, detail: { outcome: d.dispute_outcome?.outcome_code ?? null } };

  if (can("require-evidence")) {
    await merchant().request("POST", `/v1/customer/disputes/${disputeId}/require-evidence`, { body: { action: "SELLER_EVIDENCE" } });
    await used();
    await log("DISPUTE_EVIDENCE_REQUIRED", { sandboxOnly: true });
    return { step: "REQUIRE_EVIDENCE", ...base };
  }

  const merchantPays = claim && MERCHANT_PAYS.includes(claim.faultParty ?? "");
  if (merchantPays && can("accept-claim")) {
    if (opts.allowAccept === false) return { step: "WAITING", ...base, detail: { needs: "a person's approval to accept the claim (PayPal refunds the buyer)" } };
    const types: string[] = d.allowed_response_options?.accept_claim?.accept_claim_types ?? [];
    const acceptType = types.includes("REFUND") ? "REFUND" : types[0] ?? "REFUND";
    // A refused attempt never moved money; the next one gets a new request id so PayPal can't replay the refusal.
    const failed = await db().select({ id: moneyActions.id }).from(moneyActions).where(and(eq(moneyActions.claimId, claim.id), like(moneyActions.requestId, `%:ACCEPT_DISPUTE_CLAIM:%`), eq(moneyActions.status, "FAILED")));
    const note = `The store accepts this claim. Undo's ruling on claim ${claim.id}: ${claim.faultParty} at fault (${((claim.reasons ?? []) as { code: string }[]).map((x) => x.code).join(", ")}).`;
    const r = await acceptDisputeClaim({ claimId: claim.id, disputeId, amount: d.dispute_amount?.value ?? "0.00", version: failed.length + 1, acceptType, note });
    await used();
    await settleClaim(claim.id, "ESCALATED", decidedBy);
    await log("DISPUTE_CLAIM_ACCEPTED", { amount: r.amount, requestId: r.requestId, decidedBy, faultParty: claim.faultParty });
    return { step: "ACCEPT_CLAIM", ...base, detail: { amount: r.amount } };
  }

  if (!merchantPays && can("provide-evidence")) {
    const pack = await evidencePack({ claimId: claim?.id ?? null, captureId: d.disputed_transactions?.[0]?.seller_transaction_id }, "merchant");
    const refundIds = claim ? (await db().select({ ref: moneyActions.paypalRef }).from(moneyActions).where(and(eq(moneyActions.claimId, claim.id), eq(moneyActions.kind, "refund"), eq(moneyActions.status, "CONFIRMED")))).flatMap((r) => (r.ref ? [r.ref] : [])) : [];
    const pick = pickEvidence(requestedTypes(d), { tracking: !!pack.tracking, refunds: refundIds.length > 0 });
    if (!pick) {
      // Undo holds no record of the kind PayPal asks for: it sends nothing and leaves the case to a person.
      await log("DISPUTE_NEEDS_PERSON", { requested: requestedTypes(d) });
      return { step: "WAITING", ...base, detail: { needs: `a person: PayPal asks for ${requestedTypes(d).join(", ")}, and Undo holds no such record` } };
    }
    const type = pick;
    const ev: Record<string, unknown> = { evidence_type: type, notes: pack.statements.map((s, i) => `${i + 1}. ${s.text}`).join(" ").slice(0, 2000), documents: [{ name: "undo-evidence-pack.pdf" }] };
    if (type === "PROOF_OF_FULFILLMENT" && pack.tracking) ev.evidence_info = { tracking_info: [{ carrier_name: "OTHER", carrier_name_other: pack.tracking.carrier, tracking_number: pack.tracking.number }] };
    if (type === "PROOF_OF_REFUND") ev.evidence_info = { refund_ids: refundIds.map((refund_id) => ({ refund_id })) };
    const form = new FormData();
    form.append("input", new Blob([JSON.stringify({ evidences: [ev] })], { type: "application/json" }));
    form.append("evidence-file", new Blob([new Uint8Array(pack.pdf)], { type: "application/pdf" }), "undo-evidence-pack.pdf");
    await merchant().request("POST", `/v1/customer/disputes/${disputeId}/provide-evidence`, { form });
    await used();
    if (claim) await settleClaim(claim.id, "ANSWERED_IN_PAYPAL", decidedBy);
    await log("DISPUTE_EVIDENCE_SENT", { evidenceType: type, statements: pack.statements.length, writtenBy: pack.source, cites: [...new Set(pack.statements.flatMap((s) => s.cites))], pdfBytes: pack.pdf.length, decidedBy });
    return { step: "PROVIDE_EVIDENCE", ...base, detail: { evidenceType: type, writtenBy: pack.source, statements: pack.statements, pdfBytes: pack.pdf.length } };
  }

  if (can("adjudicate")) {
    // Sandbox-only stand-in for PayPal's decision: the outcome the stored evidence supports.
    const outcome = merchantPays ? "BUYER_FAVOR" : "SELLER_FAVOR";
    await merchant().request("POST", `/v1/customer/disputes/${disputeId}/adjudicate`, { body: { adjudication_outcome: outcome } });
    await used();
    await log("DISPUTE_ADJUDICATED", { outcome, sandboxOnly: true });
    return { step: "ADJUDICATE", ...base, detail: { outcome } };
  }
  return { step: "WAITING", ...base };
}

/** The evidence types PayPal requests from the seller at the dispute's current stage. */
export function requestedTypes(d: { dispute_life_cycle_stage?: string; evidences?: { source?: string; evidence_type?: string; dispute_life_cycle_stage?: string }[] }) {
  const req = (d.evidences ?? []).filter((e) => e.source === "REQUESTED_FROM_SELLER" && (!e.dispute_life_cycle_stage || e.dispute_life_cycle_stage === d.dispute_life_cycle_stage));
  return [...new Set(req.map((e) => e.evidence_type!).filter(Boolean))];
}

/** Types the evidence pack itself answers: what was ordered, approved and received. */
const PACK_TYPES = ["OTHER", "ITEM_DESCRIPTION", "ITEM_DETAILS", "ORDER_DETAILS", "DETAILS_OF_PURCHASE", "ADDITIONAL_INFORMATION_OF_ITEM", "MERCHANT_RESPONSE"];

/**
 * The first requested type Undo holds a real record for (spike S8: OTHER is refused where a type is requested,
 * and proof of fulfillment needs tracking). Nothing requested -> OTHER. Nothing satisfiable -> null.
 */
export function pickEvidence(requested: string[], has: { tracking: boolean; refunds: boolean }): string | null {
  if (!requested.length) return "OTHER";
  return requested.find((t) => (t === "PROOF_OF_FULFILLMENT" && has.tracking) || (t === "PROOF_OF_REFUND" && has.refunds) || PACK_TYPES.includes(t)) ?? null;
}

/** The claim leaves the "respond in PayPal" queue once Undo has answered. */
async function settleClaim(claimId: string, status: string, decidedBy: string) {
  await db().update(claims).set({ status }).where(eq(claims.id, claimId));
  await db().update(approvals).set({ status: "APPROVED", decidedBy, decidedAt: new Date() }).where(and(eq(approvals.claimId, claimId), eq(approvals.status, "PENDING")));
}
