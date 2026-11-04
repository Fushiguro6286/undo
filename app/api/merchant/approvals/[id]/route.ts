import { z } from "zod";
import { handle, requireMerchant } from "@/src/http";
import { decideApproval } from "@/src/claims/resolve";

const Input = z.object({ decision: z.enum(["approve", "reject"]) });

/** The merchant's one tap: approve runs the evaluator again and then carries out the remedy. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireMerchant(req);
    return decideApproval((await ctx.params).id, Input.parse(await req.json()).decision, "merchant");
  });
}
