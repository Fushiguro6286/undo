import { rateLimit } from "@/src/limits";
import { z } from "zod";
import { handle } from "@/src/http";
import { extractLimits } from "@/src/intent/extract";
import { deadlineNote, describeLimits, matchVariants } from "@/src/intent/limits";

const Input = z.object({ request: z.string().trim().min(3).max(500) });

export async function POST(req: Request) {
  return handle(async () => {
    await rateLimit(req, "intent", 30);
    const { request } = Input.parse(await req.json());
    const limits = await extractLimits(request);
    return { limits, description: describeLimits(limits), matches: matchVariants(limits), note: deadlineNote(limits) };
  });
}
