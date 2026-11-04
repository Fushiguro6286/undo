import { handle, requireMerchant } from "@/src/http";
import { approvePolicy } from "@/src/policy/store";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireMerchant(req);
    return approvePolicy((await ctx.params).id);
  });
}
