import { handle, requireMerchant } from "@/src/http";
import { runTurn, TurnRequest } from "@/src/console/llm-turn";

export const maxDuration = 60;

/** One turn of the console's Studio agent. Merchant-only; the model key never leaves the server. */
export async function POST(req: Request) {
  return handle(async () => {
    requireMerchant(req);
    return runTurn(TurnRequest.parse(await req.json()));
  });
}
