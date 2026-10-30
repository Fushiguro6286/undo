import { z } from "zod";
import { handle } from "@/src/http";
import { Limits } from "@/src/intent/limits";
import { createCheckout } from "@/src/intent/orders";

const Input = z.object({ buyerRef: z.string().min(1).max(100), limits: Limits });

export async function POST(req: Request) {
  return handle(async () => {
    const { buyerRef, limits } = Input.parse(await req.json());
    return createCheckout("DELEGATED", buyerRef, limits, null);
  });
}
