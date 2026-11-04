import { z } from "zod";
import { handle } from "@/src/http";
import { getClaim } from "@/src/claims/claims";
import { chooseOffer } from "@/src/claims/resolve";

const Input = z.object({
  offer_id: z.uuid(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), // if the buyer's agent states an amount, it must equal the offer's
});

/** The buyer or their agent picks one rule-made offer. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = (await ctx.params).id;
    const { offer_id, amount } = Input.parse(await req.json());
    const result = await chooseOffer(id, offer_id, amount);
    return { result, claim: await getClaim(id) };
  });
}
