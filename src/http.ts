// Route helper: known errors become clean JSON responses; nothing secret is ever echoed.
import { timingSafeEqual } from "node:crypto";
import { ZodError } from "zod";
import { PayPalError } from "./paypal/client";
import { CheckoutError } from "./intent/orders";
import { ClaimError } from "./claims/claims";
import { PolicyError } from "./policy/store";
import { RateLimitError } from "./limits";

class AuthError extends Error {}

/**
 * Merchant-only routes need the judge password in `x-merchant-key` (the /merchant console login sends it).
 * Without a password configured they are open in development only.
 */
export function requireMerchant(req: Request) {
  const want = process.env.JUDGE_LOGIN_PASSWORD;
  if (!want) {
    if (process.env.NODE_ENV === "production") throw new AuthError("merchant login is not configured");
    return;
  }
  const got = Buffer.from(req.headers.get("x-merchant-key") ?? "");
  if (got.length !== Buffer.byteLength(want) || !timingSafeEqual(got, Buffer.from(want))) throw new AuthError("merchant login required");
}

export async function handle(fn: () => Promise<unknown>) {
  try {
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: "invalid input", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
    if (e instanceof CheckoutError || e instanceof ClaimError || e instanceof PolicyError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof AuthError) return Response.json({ error: e.message }, { status: 401 });
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429, headers: { "retry-after": String(Math.ceil(e.retryAfterSec)) } });
    if (e instanceof PayPalError) return Response.json({ error: e.message, paypal: { status: e.status, code: e.code, issues: e.issues } }, { status: 502 });
    console.error("[api]", (e as Error).message);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
