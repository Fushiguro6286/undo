import { handle } from "@/src/http";
import { getClaim } from "@/src/claims/claims";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => getClaim((await ctx.params).id));
}
