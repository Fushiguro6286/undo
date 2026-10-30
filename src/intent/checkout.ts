// Orders v2 request bodies for the two consent modes (CLAUDE.md section 7). Pure: no network.
import { itemName, STORE_NAME, variantBySku } from "../store/catalog";
import { fromCents, toCents } from "../money/cents";
import { limitsText, type Limits } from "./limits";
import type { CartLine } from "./record";

const usd = (value: string) => ({ currency_code: "USD", value });
const brand = `${STORE_NAME} (Undo demo)`;

/** CONFIRMED: the person approves this exact cart on PayPal; intent CAPTURE. */
export function confirmedOrderBody(hash: string, cart: CartLine[]) {
  if (!cart.length) throw new Error("cart is empty");
  const items = cart.map(({ sku, qty }) => {
    const v = variantBySku(sku);
    if (!v) throw new Error(`unknown sku ${sku}`);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new Error(`invalid quantity for ${sku}`);
    return { name: itemName(v), sku, quantity: String(qty), unit_amount: usd(v.price), category: "PHYSICAL_GOODS" as const };
  });
  const total = fromCents(items.reduce((sum, i) => sum + toCents(i.unit_amount.value) * Number(i.quantity), 0));
  return {
    intent: "CAPTURE" as const,
    purchase_units: [{ custom_id: hash, description: `${STORE_NAME} order`, amount: { ...usd(total), breakdown: { item_total: usd(total) } }, items }],
    payment_source: { paypal: { experience_context: { brand_name: brand, user_action: "PAY_NOW" } } },
  };
}

/** DELEGATED: the person approves a ceiling and limits; the agent picks later; intent AUTHORIZE. */
export function delegatedOrderBody(hash: string, limits: Limits) {
  if (!limits.max_price) throw new Error("a DELEGATED purchase needs a maximum price");
  const text = limitsText(limits);
  return {
    intent: "AUTHORIZE" as const,
    purchase_units: [
      {
        custom_id: hash,
        description: text,
        amount: { ...usd(limits.max_price), breakdown: { item_total: usd(limits.max_price) } },
        items: [{ name: text, sku: "AGENT-CEILING", quantity: "1", unit_amount: usd(limits.max_price), category: "PHYSICAL_GOODS" as const }],
      },
    ],
    payment_source: { paypal: { experience_context: { brand_name: brand, user_action: "CONTINUE" } } },
  };
}
