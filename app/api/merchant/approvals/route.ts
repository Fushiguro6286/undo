import { handle, requireMerchant } from "@/src/http";
import { pendingApprovals } from "@/src/claims/resolve";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    requireMerchant(req);
    return pendingApprovals();
  });
}
