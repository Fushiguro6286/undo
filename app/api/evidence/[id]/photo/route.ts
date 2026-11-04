import { getEvidencePhoto } from "@/src/claims/claims";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const photo = await getEvidencePhoto((await ctx.params).id);
    return new Response(new Uint8Array(photo), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
