import { handle, requireMerchant } from "@/src/http";
import { consoleData } from "@/src/console/data";
import { pollSoon } from "@/src/disputes/sync";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    requireMerchant(req);
    pollSoon();
    return consoleData();
  });
}
