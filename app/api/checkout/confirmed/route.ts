import { z } from "zod";
import { handle } from "@/src/http";
import { Limits } from "@/src/intent/limits";
import { createCheckout } from "@/src/intent/orders";

const Input = z.object({
  buyerRef: z.string().min(1).max(100),
  limits: Limits,
  cart: z.array(z.object({ sku: z.string().max(60), qty: z.number().int().min(1).max(10) })).min(1).max(10),
});

export async function POST(req: Request) {
  return handle(async () => {
    const { buyerRef, limits, cart } = Input.parse(await req.json());
    return createCheckout("CONFIRMED", buyerRef, limits, cart);
  });
}
