import { rateLimit } from "@/src/limits";
import { handle } from "@/src/http";
import { addEvidence, ClaimError } from "@/src/claims/claims";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await rateLimit(req, "evidence", 40);
    const photo = (await req.formData()).get("photo");
    if (!(photo instanceof File) || !photo.size) throw new ClaimError("attach a photo in the 'photo' field");
    return addEvidence((await ctx.params).id, Buffer.from(await photo.arrayBuffer()));
  });
}
