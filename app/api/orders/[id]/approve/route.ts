import { handle } from "@/src/http";
import { completeApproval } from "@/src/intent/orders";

// Called after the buyer approves on PayPal: captures CONFIRMED orders, authorizes DELEGATED ones.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => completeApproval((await ctx.params).id));
}
