import { rateLimit } from "@/src/limits";
import { z } from "zod";
import { handle, requireMerchant } from "@/src/http";
import { compileDraft, policyOverview } from "@/src/policy/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    requireMerchant(req);
    return policyOverview();
  });
}

const Input = z.object({ text: z.string().min(1).max(4000) });

/** Compile plain-English policy text into a new unapproved version. */
export async function POST(req: Request) {
  return handle(async () => {
    requireMerchant(req);
    await rateLimit(req, "policy-compile", 20);
    return compileDraft(Input.parse(await req.json()).text);
  });
}
