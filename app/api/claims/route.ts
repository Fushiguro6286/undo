import { rateLimit } from "@/src/limits";
import { z } from "zod";
import { handle } from "@/src/http";
import { CLAIM_TYPES, openClaim } from "@/src/claims/claims";

const Input = z.object({ orderId: z.string().min(1).max(40), type: z.enum(CLAIM_TYPES), description: z.string().trim().max(2000).default("") });

export async function POST(req: Request) {
  return handle(async () => {
    await rateLimit(req, "claims", 30);
    const { orderId, type, description } = Input.parse(await req.json());
    return openClaim(orderId, type, description);
  });
}
