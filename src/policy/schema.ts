// The merchant's return policy as data (CLAUDE.md section 10). Money limits are USD amounts; percentages are 0-100.
import { z } from "zod";

const pct = z.number().min(0).max(100);
const usd = z.number().min(0);

export const Policy = z.object({
  version: z.number().int().positive(),
  currency: z.literal("USD"),
  returnWindowDays: z.number().int().min(0),
  autoApproveLimit: usd.describe("refunds above this amount go to the approval queue"),
  keepItemMaxPct: pct.describe("ceiling for keep-the-item refunds"),
  requireReturnAbove: usd.describe("claims on orders above this amount need the item returned"),
  merchantFault: z.object({ keepItemPct: pct, allowExchange: z.boolean(), allowRefundOnReturn: z.boolean() }),
  lateDelivery: z.object({ graceDays: z.number().int().min(0), partialRefundPct: pct }),
  carrierDamage: z.object({ offerReplacement: z.boolean(), offerRefundOnReturn: z.boolean() }),
  buyerRemorse: z.object({ allowed: z.boolean(), restockingFeePct: pct }),
  agentFault: z.object({ compensation: z.object({ type: z.enum(["fixed", "pct"]), value: z.number().min(0) }) }),
});
export type Policy = z.infer<typeof Policy>;

/**
 * Demo store default until the merchant approves a compiled policy (Day 4).
 * Tuned to the demo: a $29 tee keep-it refund ($8.70) auto-approves; the $120 jacket's $36 refund queues
 * (above $25) and still allows keeping the item (below the $150 return threshold).
 */
export const DEFAULT_POLICY: Policy = {
  version: 1,
  currency: "USD",
  returnWindowDays: 30,
  autoApproveLimit: 25,
  keepItemMaxPct: 50,
  requireReturnAbove: 150,
  merchantFault: { keepItemPct: 30, allowExchange: true, allowRefundOnReturn: true },
  lateDelivery: { graceDays: 0, partialRefundPct: 20 },
  carrierDamage: { offerReplacement: true, offerRefundOnReturn: true },
  buyerRemorse: { allowed: true, restockingFeePct: 10 },
  agentFault: { compensation: { type: "pct", value: 100 } },
};
