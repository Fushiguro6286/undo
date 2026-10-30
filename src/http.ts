// Route helper: known errors become clean JSON responses; nothing secret is ever echoed.
import { ZodError } from "zod";
import { PayPalError } from "./paypal/client";
import { CheckoutError } from "./intent/orders";

export async function handle(fn: () => Promise<unknown>) {
  try {
    return Response.json(await fn());
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: "invalid input", issues: e.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
    if (e instanceof CheckoutError) return Response.json({ error: e.message }, { status: 400 });
    if (e instanceof PayPalError) return Response.json({ error: e.message, paypal: { status: e.status, code: e.code, issues: e.issues } }, { status: 502 });
    console.error("[api]", (e as Error).message);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
