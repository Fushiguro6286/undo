// Shared helpers for spike scripts. Prints PASS/FAIL and PayPal ids, never tokens or secrets.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { PayPalError, type PayPalClient } from "../../src/paypal/client";

export { merchant, agentPlatform } from "../../src/paypal/client";

const OUT = join(import.meta.dirname, "out");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const usd = (value: string) => ({ currency_code: "USD", value });
export const returnUrls = () => {
  const base = process.env.APP_BASE_URL || "https://example.com";
  return { return_url: `${base}/?spike=approved`, cancel_url: `${base}/?spike=cancelled` };
};

export function pass(spike: string, msg: string, ids: Record<string, unknown> = {}) {
  console.log(`\n${spike} PASS: ${msg}`, Object.keys(ids).length ? ids : "");
}
export function fail(spike: string, msg: string, ids: Record<string, unknown> = {}) {
  console.log(`\n${spike} FAIL: ${msg}`, Object.keys(ids).length ? ids : "");
  process.exitCode = 1;
}

export function save(name: string, data: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
}
export function load<T = any>(name: string): T | undefined {
  try {
    return JSON.parse(readFileSync(join(OUT, `${name}.json`), "utf8"));
  } catch {
    return undefined;
  }
}

/** Runs a spike; any thrown error becomes a FAIL line (PayPalError messages contain no tokens). */
export async function spike(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    fail(name, e instanceof PayPalError ? e.message : (e as Error).message);
  }
}

/** Prints the approval link, then polls until the buyer approves on PayPal (or times out). */
export async function waitForApproval(client: PayPalClient, order: any, minutes = 15) {
  const link = order.links.find((l: any) => l.rel === "payer-action" || l.rel === "approve")?.href;
  console.log(`\nOpen this link, log in as a sandbox BUYER, and approve:\n  ${link}\n(waiting up to ${minutes} min; after approving you may land on an error/example page, that's fine)`);
  const deadline = Date.now() + minutes * 60_000;
  while (Date.now() < deadline) {
    try {
      const o = await client.request("GET", `/v2/checkout/orders/${order.id}`);
      if (o.status === "APPROVED") return o;
      process.stdout.write(".");
    } catch (e) {
      if (e instanceof PayPalError) throw e;
      process.stdout.write("!"); // transient network error: keep polling
    }
    await sleep(5000);
  }
  throw new Error(`order ${order.id} was not approved within ${minutes} min`);
}
