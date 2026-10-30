import { z } from "zod";
import { handle } from "@/src/http";
import { fulfillDelegated } from "@/src/intent/orders";

const Input = z.object({ sku: z.string().max(60).optional() });

// The agent picks an item (or names one) and the merchant captures its actual price, never above the ceiling.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { sku } = Input.parse(await req.json().catch(() => ({})));
    return fulfillDelegated((await ctx.params).id, sku);
  });
}
