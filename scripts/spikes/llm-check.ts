// LLM smoke check: limit extraction against the configured provider/model. Usage: npm run spike scripts/spikes/llm-check.ts
import { extractLimits } from "../../src/intent/extract";
const t = Date.now();
extractLimits("sky-blue tee, size M, under $35, by Friday", new Date("2026-11-04T00:00:00Z"))
  .then((l) => console.log("PASS", `${Date.now() - t} ms`, process.env.LLM_MODEL, JSON.stringify(l)))
  .catch((e) => console.log("FAIL", `${Date.now() - t} ms`, e.message));
