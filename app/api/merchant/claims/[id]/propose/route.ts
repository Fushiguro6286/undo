import { z } from "zod";
import { handle, requireMerchant } from "@/src/http";
import { proposeRemedy } from "@/src/claims/resolve";
import { ACTIONS } from "@/src/policy/evaluator";

const Input = z.object({
  action: z.enum(ACTIONS),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable(),
  asParty: z.enum(["MERCHANT", "CARRIER", "AGENT", "BUYER"]).optional(),
  via: z.enum(["merchant", "studio_agent"]).default("merchant"), // the console's Studio agent drafts through this route too
});

/** A drafted remedy: blocked with reasons, or queued for a person's approval. Never moves money by itself. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireMerchant(req);
    const { via, ...p } = Input.parse(await req.json());
    return proposeRemedy((await ctx.params).id, p, via === "studio_agent" ? "studio_agent" : "system");
  });
}
