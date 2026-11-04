import { z } from "zod";
import { handle, requireMerchant } from "@/src/http";
import { approveEdited, decideApproval } from "@/src/claims/resolve";

// `amount` (approve only) is the merchant's edit: a new proposal that the evaluator checks before it is paid.
const Input = z.object({ decision: z.enum(["approve", "reject"]), amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional() });

/** The merchant's one tap: approve runs the evaluator again and then carries out the remedy. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireMerchant(req);
    const id = (await ctx.params).id;
    const { decision, amount } = Input.parse(await req.json());
    return decision === "approve" && amount !== undefined ? approveEdited(id, amount, "merchant") : decideApproval(id, decision, "merchant");
  });
}
