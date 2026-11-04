import { handle, requireMerchant } from "@/src/http";
import { consoleData } from "@/src/console/data";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    requireMerchant(req);
    return consoleData();
  });
}
