import { handle } from "@/src/http";
import { getClaim } from "@/src/claims/claims";
import { pollSoon } from "@/src/disputes/sync";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  pollSoon();
  return handle(async () => getClaim((await ctx.params).id));
}
