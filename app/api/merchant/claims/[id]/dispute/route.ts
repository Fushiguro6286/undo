import { handle, requireMerchant } from "@/src/http";
import { ClaimError } from "@/src/claims/claims";
import { advanceDispute, disputeOfClaim } from "@/src/disputes/respond";

export const maxDuration = 60;

// The merchant's tap on a "Respond in PayPal" item: Undo takes the next step PayPal offers on the claim's dispute
// (evidence pack, or accept-claim when the merchant is at fault).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    requireMerchant(req);
    const id = (await ctx.params).id;
    const d = await disputeOfClaim(id);
    if (!d) throw new ClaimError("this claim has no open PayPal dispute");
    return advanceDispute(d.paypalDisputeId, "merchant (console)");
  });
}
