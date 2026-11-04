// Checkout orchestration: Intent Record -> PayPal order -> buyer approves on PayPal -> capture / authorize -> fulfill.
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { intents, orders } from "../db/schema";
import { merchant } from "../paypal/client";
import { authorizeOrder, captureAuthorization, captureOrder } from "../money/router";
import { promisedBy, variantBySku } from "../store/catalog";
import { confirmedOrderBody, delegatedOrderBody } from "./checkout";
import { intentHash, type CartLine, type IntentRecord } from "./record";
import { limitViolations, matchVariants, type Limits } from "./limits";
import { toCents } from "../money/cents";

export class CheckoutError extends Error {}

/**
 * `pool`: judge-mode order pool only (scripts/seed-order-pool.ts). Pays with PayPal's published sandbox test card
 * instead of a buyer approval (spike S7), so a CONFIRMED order comes back already captured.
 */
type PoolCard = { name: string; number: string; expiry: string; security_code: string };

export async function createCheckout(mode: IntentRecord["mode"], buyerRef: string, limits: Limits, cart: CartLine[] | null, pool?: { card: PoolCard }) {
  const record: IntentRecord = { id: randomUUID(), buyer_ref: buyerRef, mode, limits, cart: mode === "CONFIRMED" ? cart : null, created_at: new Date().toISOString() };
  const hash = intentHash(record);
  let body;
  try {
    body = mode === "CONFIRMED" ? confirmedOrderBody(hash, record.cart ?? []) : delegatedOrderBody(hash, limits);
  } catch (e) {
    throw new CheckoutError((e as Error).message);
  }
  if (pool) body = { ...body, payment_source: { card: pool.card } } as unknown as typeof body;
  const order = await merchant().request("POST", "/v2/checkout/orders", { requestId: `${record.id}:create`, body });
  const amount = body.purchase_units[0].amount.value;
  const cap = order.status === "COMPLETED" ? order.purchase_units?.[0]?.payments?.captures?.[0] : undefined;
  await db().transaction(async (tx) => {
    await tx.insert(intents).values({ id: record.id, buyerRef, limits, cart: record.cart, mode, hash, createdAt: new Date(record.created_at) });
    await tx.insert(orders).values({
      paypalOrderId: order.id,
      intentId: record.id,
      paypalIntent: body.intent,
      ceiling: mode === "DELEGATED" ? amount : null,
      amount: cap?.amount.value ?? (mode === "CONFIRMED" ? amount : null),
      status: cap?.status === "COMPLETED" ? "COMPLETED" : "CREATED",
      captureId: cap?.id ?? null,
      promisedBy: cap ? promisedBy(new Date()) : null,
      pool: !!pool,
    });
  });
  return { orderId: order.id as string, hash };
}

export async function getOrder(paypalOrderId: string) {
  const [row] = await db().select().from(orders).leftJoin(intents, eq(orders.intentId, intents.id)).where(eq(orders.paypalOrderId, paypalOrderId));
  if (!row) throw new CheckoutError(`unknown order ${paypalOrderId}`);
  return { ...row.orders, intent: row.intents };
}

/** After the buyer approves on PayPal: CONFIRMED orders are captured, DELEGATED orders are authorized. */
export async function completeApproval(paypalOrderId: string) {
  const o = await getOrder(paypalOrderId);
  if (o.status !== "CREATED") return o; // already done (retry or webhook got there first)
  if (o.paypalIntent === "CAPTURE") {
    const cap = await captureOrder(paypalOrderId);
    const now = new Date();
    await db().update(orders).set({ captureId: cap.captureId, amount: cap.amount, status: cap.status === "COMPLETED" ? "COMPLETED" : `CAPTURE_${cap.status}`, promisedBy: promisedBy(now) }).where(eq(orders.id, o.id));
  } else {
    const auth = await authorizeOrder(paypalOrderId);
    await db().update(orders).set({ authorizationId: auth.authorizationId, status: "AUTHORIZED" }).where(eq(orders.id, o.id));
  }
  return getOrder(paypalOrderId);
}

/**
 * DELEGATED: the agent picks an item and the merchant captures its actual price (never above the ceiling).
 * Without a sku the agent takes the cheapest item inside the limits. A sku outside the limits is still bought:
 * the person approved the ceiling, not the item, so that mistake is the agent's (fault engine step 5).
 */
export async function fulfillDelegated(paypalOrderId: string, sku?: string) {
  const o = await getOrder(paypalOrderId);
  if (o.paypalIntent !== "AUTHORIZE" || !o.intent) throw new CheckoutError("not a DELEGATED order");
  if (o.status !== "AUTHORIZED" || !o.authorizationId || !o.ceiling) throw new CheckoutError(`order is ${o.status}, expected AUTHORIZED`);
  const limits = o.intent.limits as Limits;
  const now = new Date();
  const pick = sku ? variantBySku(sku) : matchVariants(limits, now).sort((a, b) => toCents(a.price) - toCents(b.price))[0];
  if (!pick) throw new CheckoutError(sku ? `unknown sku ${sku}` : "no item in the store matches these limits");
  if (toCents(pick.price) > toCents(o.ceiling)) throw new CheckoutError(`${pick.sku} costs $${pick.price}, above the $${o.ceiling} ceiling`);
  const cap = await captureAuthorization(o.authorizationId, pick.price, o.ceiling);
  const chosenItem = { ...pick, limit_violations: limitViolations(pick, limits, now) };
  await db().update(orders).set({ chosenItem, captureId: cap.captureId, amount: cap.amount, status: cap.status === "COMPLETED" ? "COMPLETED" : `CAPTURE_${cap.status}`, promisedBy: promisedBy(now) }).where(eq(orders.id, o.id));
  return getOrder(paypalOrderId);
}
