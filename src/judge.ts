// Judge mode (spec section 18): the three live one-click scenarios. The server only picks an unused pool order
// and opens the claim; the judge's browser then uploads the sample photo and picks the remedy through the same
// public endpoints a buyer uses, so every rule, check and PayPal call is the real one.
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import { claims, intents, orders } from "./db/schema";
import { ClaimError, openClaim, type ClaimType } from "./claims/claims";
import { fulfillDelegated } from "./intent/orders";
import { hit } from "./limits";

export const JUDGE_SCENARIOS = {
  merchant: { order: "tee", type: "wrong_item", description: "I ordered sky blue and got a navy tee.", photo: "wrong-color.jpg", choose: "PARTIAL_REFUND_KEEP_ITEM" },
  denial: { order: "tee", type: "agent_mistake", description: "My agent bought this without asking me.", photo: "correct-item.jpg", choose: "DENY_WITH_REASON" },
  agent: { order: "delegated", type: "agent_mistake", description: "I said size M and my agent bought L.", photo: "wrong-size.jpg", choose: "AGENT_PLATFORM_PAYOUT" },
} as const satisfies Record<string, { order: "tee" | "delegated"; type: ClaimType; description: string; photo: string; choose: string }>;
export type JudgeScenario = keyof typeof JUDGE_SCENARIOS;

export const judgeMode = () => process.env.JUDGE_MODE === "true";

const TEN_YEARS = 10 * 365 * 86_400;

/** An unused judge-pool order, reserved so two judges clicking at once never get the same one. */
async function reservePoolOrder(kind: "tee" | "delegated") {
  const where = kind === "delegated"
    ? and(eq(orders.status, "AUTHORIZED"), eq(orders.paypalIntent, "AUTHORIZE"))
    : and(eq(orders.status, "COMPLETED"), eq(orders.amount, "29.00"));
  const rows = await db()
    .select({ id: orders.paypalOrderId })
    .from(orders)
    .innerJoin(intents, eq(orders.intentId, intents.id))
    .leftJoin(claims, eq(claims.orderId, orders.id))
    .where(and(where, eq(orders.pool, true), eq(intents.buyerRef, "judge-pool"), isNull(claims.id)))
    .orderBy(desc(orders.createdAt))
    .limit(10);
  for (const r of rows) {
    // The first caller to count this key gets the order; a one-hit counter doubles as an atomic reservation.
    if ((await hit(`pool-reserve:${r.id}`, TEN_YEARS)).count === 1) return r.id;
  }
  throw new ClaimError("the judge order pool is used up for now; the recorded runs on /evals show every scenario");
}

export async function startJudgeRun(name: JudgeScenario) {
  const s = JUDGE_SCENARIOS[name];
  const orderId = await reservePoolOrder(s.order);
  const steps: string[] = [];
  if (s.order === "delegated") {
    // The person approved "sky-blue tee, size M"; the agent picks size L. Captured at its real price inside the ceiling.
    const o = await fulfillDelegated(orderId, "TEE-SKYBLUE-L");
    steps.push(`Agent bought Classic Tee, Sky Blue, L for $${o.amount} inside a ceiling approved for size M (capture ${o.captureId})`);
  } else {
    steps.push(`Picked a paid sandbox order: PayPal order ${orderId}`);
  }
  const claim = await openClaim(orderId, s.type, s.description);
  steps.push(`Claim opened: “${s.description}” · challenge code ${claim.challengeCode}`);
  return { ...claim, orderId, photo: s.photo, choose: s.choose, steps };
}
