// The person's limits (what they allowed the agent to buy), matching against the catalog, and limit checks.
// limitViolations is also the fault engine's step 5 check (agent exceeded limits).
import { z } from "zod";
import { promisedBy, VARIANTS, type Variant } from "../store/catalog";
import { toCents } from "../money/cents";

export const Limits = z.object({
  item: z.string().nullable().describe("product type, one of: tee, hoodie, jacket, shirt, socks, beanie, tote; null if unclear"),
  size: z.string().nullable().describe("S, M or L; null if not stated"),
  color: z.string().nullable().describe("color words as the person said them, lowercase, e.g. 'sky blue'; null if not stated"),
  max_price: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable().describe("maximum total price in USD as a decimal string like '35.00'; null if not stated"),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().describe("latest delivery date as YYYY-MM-DD; null if not stated"),
});
export type Limits = z.infer<typeof Limits>;

export type LimitReason = "LIMIT_ITEM_TYPE" | "LIMIT_SIZE" | "LIMIT_COLOR" | "LIMIT_PRICE" | "LIMIT_DEADLINE";

const words = (s: string) => s.toLowerCase().replace(/gray/g, "grey").split(/\s+/).filter(Boolean);
const isoDay = (d: Date) => d.toISOString().slice(0, 10); // shortcut: dates compared in UTC; fine for a US demo store, revisit for real merchants

/** Every limit the variant breaks. `capturedAt` sets the promised delivery date checked against the deadline. */
export function limitViolations(v: Pick<Variant, "type" | "size" | "color" | "price">, limits: Limits, capturedAt: Date): LimitReason[] {
  const out: LimitReason[] = [];
  if (limits.item && limits.item.toLowerCase() !== v.type) out.push("LIMIT_ITEM_TYPE");
  if (limits.size && limits.size.toUpperCase() !== v.size.toUpperCase()) out.push("LIMIT_SIZE");
  if (limits.color) {
    const have = words(v.color);
    if (!words(limits.color).every((w) => have.includes(w))) out.push("LIMIT_COLOR");
  }
  if (limits.max_price && toCents(v.price) > toCents(limits.max_price)) out.push("LIMIT_PRICE");
  if (limits.deadline && isoDay(promisedBy(capturedAt)) > limits.deadline) out.push("LIMIT_DEADLINE");
  return out;
}

export const matchVariants = (limits: Limits, now = new Date()) => VARIANTS.filter((v) => limitViolations(v, limits, now).length === 0);

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

/** Plain words shown back to the person, e.g. "a sky blue tee, size M, up to $35.00, delivered by Fri, Nov 6". */
export function describeLimits(l: Limits): string {
  const thing = [l.color, l.item ?? "item"].filter(Boolean).join(" ");
  const parts = [`a ${thing}`];
  if (l.size) parts.push(`size ${l.size}`);
  if (l.max_price) parts.push(`up to $${l.max_price}`);
  if (l.deadline) parts.push(`delivered by ${day(l.deadline)}`);
  return parts.join(", ");
}

/** The DELEGATED order description and item name. PayPal truncates after 127 characters. */
export function limitsText(l: Limits): string {
  const thing = [l.color, l.item ?? "item"].filter(Boolean).join(" ");
  const parts = [thing, l.size && `size ${l.size}`, l.deadline && `by ${day(l.deadline)}`].filter(Boolean);
  return `Agent purchase up to $${l.max_price}: ${parts.join(", ")}`.slice(0, 127);
}
