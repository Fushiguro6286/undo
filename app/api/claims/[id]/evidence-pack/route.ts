import { handle } from "@/src/http";
import { ClaimError, getClaim } from "@/src/claims/claims";
import { evidencePack } from "@/src/disputes/pack";

export const maxDuration = 60;

// Fallback for merchants without an Undo endpoint: the buyer downloads a cited evidence pack and files it in
// PayPal's Resolution Center themselves (buyers can't open disputes through the API). Template text only: no AI cost.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  try {
    const claim = await getClaim(id);
    if (!claim.faultParty) throw new ClaimError("the claim has no ruling yet");
    const pack = await evidencePack({ claimId: id }, "buyer");
    return new Response(new Uint8Array(pack.pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="undo-evidence-${pack.paypalOrderId}.pdf"` },
    });
  } catch (e) {
    return handle(async () => {
      throw e;
    });
  }
}
