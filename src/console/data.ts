// Everything the merchant console shows, in one read: claims with their latest evidence, the approval queue,
// and the audit-chain check. Merchant-only (the route checks the judge login).
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { claims, evidence, intents, orders } from "../db/schema";
import { verifyAudit } from "../audit/log";
import { pendingApprovals } from "../claims/resolve";
import { ISSUE_TEXT } from "../claims/extension";
import type { Assessment } from "../claims/fraud";
import type { VisionResult } from "../claims/vision";
import type { Reason } from "../fault/engine";
import { itemName, variantBySku, type Variant } from "../store/catalog";

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

  const [approvals, audit] = await Promise.all([pendingApprovals(), verifyAudit()]);
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
        signals: ((ev?.fraudSignals as Assessment | null)?.signals ?? []).map((code) => ({ code, text: ISSUE_TEXT[code] ?? code })),
      };
    }),
    approvals: approvals.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
    audit: { ok: audit.ok, count: audit.count, brokenAt: audit.brokenAt, checkedAt: audit.checkedAt },
  };
}

export type ConsoleData = Awaited<ReturnType<typeof consoleData>>;
