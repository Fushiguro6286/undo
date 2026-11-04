// Day 12 smoke check: rate-limit counter and the LLM spend cap on a real call. Usage: npm run spike scripts/spikes/day12-check.ts
import { generateText } from "ai";
import { hit } from "../../src/limits";
import { model } from "../../src/llm/model";
import { spentToday } from "../../src/llm/spend";

const key = `day12-check:${Date.now()}`;
const counts = [await hit(key, 60), await hit(key, 60), await hit(key, 60)].map((r) => r.count);
console.log(counts.join(",") === "1,2,3" ? "PASS rate-limit counter 1,2,3" : `FAIL rate-limit counter ${counts}`);
const before = await spentToday();
const { text } = await generateText({ model: model(), prompt: "Reply with the single word OK.", abortSignal: AbortSignal.timeout(30_000) });
const after = await spentToday();
console.log(
  after.calls === before.calls + 1
    ? `PASS spend recorded (calls ${before.calls} -> ${after.calls}, $${after.costUsd.toFixed(4)} of $${after.cap}); model said ${JSON.stringify(text.trim())}`
    : `FAIL spend not recorded (${before.calls} -> ${after.calls})`,
);
process.exit(0);
