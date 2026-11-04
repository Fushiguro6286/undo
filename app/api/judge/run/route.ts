import { z } from "zod";
import { handle } from "@/src/http";
import { ClaimError } from "@/src/claims/claims";
import { JUDGE_SCENARIOS, judgeMode, startJudgeRun, type JudgeScenario } from "@/src/judge";
import { rateLimit } from "@/src/limits";

const Input = z.object({ scenario: z.enum(Object.keys(JUDGE_SCENARIOS) as [JudgeScenario, ...JudgeScenario[]]) });

/** Judge mode only: reserve a pool order and open the claim for one of the three live scenarios. */
export async function POST(req: Request) {
  return handle(async () => {
    if (!judgeMode()) throw new ClaimError("judge mode is off");
    const { scenario } = Input.parse(await req.json());
    await rateLimit(req, "judge-run", 6);
    return startJudgeRun(scenario);
  });
}
