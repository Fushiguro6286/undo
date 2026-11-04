// Judge-mode pool orders: real sandbox orders paid with PayPal's published sandbox test card
// (developer.paypal.com/api/rest/sandbox/card-testing/; proven by spike S7), so no hand approvals are needed.
import { createCheckout } from "../src/intent/orders";
import { variantBySku } from "../src/store/catalog";

const card = { name: "Undo Pool", number: "4012000033330026", expiry: "2030-12", security_code: "123" };

/** CONFIRMED: the card pays for the sku. DELEGATED: the card authorizes a ceiling of the sku's price, with the sku as the limits. */
export async function createPoolOrder(sku: string, delegated = false) {
  const v = variantBySku(sku);
  if (!v) throw new Error(`unknown sku ${sku}`);
  const limits = { item: v.type, size: v.size === "One Size" ? null : v.size, color: v.color.toLowerCase(), max_price: v.price, deadline: null };
  const { orderId } = delegated
    ? await createCheckout("DELEGATED", "judge-pool", limits, null, { card })
    : await createCheckout("CONFIRMED", "judge-pool", limits, [{ sku, qty: 1 }], { card });
  return { orderId, price: v.price };
}
