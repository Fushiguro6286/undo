import { handle } from "@/src/http";
import { contestDelivery } from "@/src/claims/claims";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => contestDelivery((await ctx.params).id));
}
