import { handle } from "@/src/http";
import { getOrder } from "@/src/intent/orders";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => getOrder((await ctx.params).id));
}
