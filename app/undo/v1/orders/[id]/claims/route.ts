// Resolution Extension endpoint (merchant side): POST /undo/v1/orders/{paypal_order_id}/claims.
// JSON { type, description } opens a claim and asks for the challenge-code photo.
// multipart { claim_id, photo } adds the photo and returns the fault ruling and rule-made resolution_options.
import { z } from "zod";
import { handle } from "@/src/http";
import { addEvidence, CLAIM_TYPES, ClaimError, getClaim, openClaim } from "@/src/claims/claims";
import { resolutionResponse } from "@/src/claims/extension";
import { rateLimit } from "@/src/limits";

const Open = z.object({ type: z.enum(CLAIM_TYPES), description: z.string().trim().max(2000).default("") });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const paypalOrderId = (await ctx.params).id;
    if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
      await rateLimit(req, "evidence", 40);
      const form = await req.formData();
      const claimId = String(form.get("claim_id") ?? "");
      const photo = form.get("photo");
      if (!(photo instanceof File) || !photo.size) throw new ClaimError("attach a photo in the 'photo' field");
      const claim = await getClaim(claimId);
      if (claim.order.paypalOrderId !== paypalOrderId) throw new ClaimError("that claim belongs to a different order");
      return resolutionResponse(await addEvidence(claimId, Buffer.from(await photo.arrayBuffer())));
    }
    await rateLimit(req, "claims", 30);
    const { type, description } = Open.parse(await req.json());
    const { claimId } = await openClaim(paypalOrderId, type, description);
    return resolutionResponse(await getClaim(claimId));
  });
}
