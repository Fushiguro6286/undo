// The Intent Record: what the person approved and how. Its sha256 goes into the PayPal order's custom_id,
// which is fixed once the order completes, so the hash proves the record was not edited later.
import { createHash } from "node:crypto";
import type { Limits } from "./limits";

export type CartLine = { sku: string; qty: number };
export type IntentRecord = {
  id: string;
  buyer_ref: string;
  mode: "CONFIRMED" | "DELEGATED";
  limits: Limits;
  cart: CartLine[] | null;
  created_at: string; // ISO, millisecond precision
};

/** JSON with object keys sorted at every level, so the same record always hashes the same. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export const intentHash = (r: IntentRecord) => createHash("sha256").update(canonicalJson(r)).digest("hex");
