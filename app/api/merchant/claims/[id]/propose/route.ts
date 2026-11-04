import { z } from "zod";
import { handle, requireMerchant } from "@/src/http";
import { proposeRemedy } from "@/src/claims/resolve";
import { ACTIONS } from "@/src/policy/evaluator";

const Input = z.object({
  action: z.enum(ACTIONS),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable(),
  asParty: z.enum(["MERCHANT", "CARRIER", "AGENT", "BUYER"]).optional(),
});

/** A drafted remedy: blocked with reasons, or queued for a person's approval. Never moves money by itself. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireMerchant(req);
    return proposeRemedy((await ctx.params).id, Input.parse(await req.json()), "system");
  });
}
