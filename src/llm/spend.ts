// Daily LLM spending cap (spec section 18). Every model call goes through this middleware: it refuses the call once
// today's recorded spend reaches LLM_DAILY_SPEND_CAP_USD, and records each call's tokens afterwards. Callers already
// treat an LLM error as "use the fallback" (template text, a person's review), so a capped day degrades, never breaks.
import type { LanguageModelMiddleware } from "ai";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { llmUsage } from "../db/schema";

export class SpendCapError extends Error {}

/** Charged per call when no token prices are configured: a deliberate budget unit, not a provider's price. */
export const FLAT_CALL_COST_USD = 0.01;

/** Cost of one call from the configured prices (USD per million tokens), or the flat budget unit without them. */
export function callCost(inputTokens: number, outputTokens: number, env: Record<string, string | undefined> = process.env) {
  const pIn = Number(env.LLM_PRICE_INPUT_PER_MTOK);
  const pOut = Number(env.LLM_PRICE_OUTPUT_PER_MTOK);
  if (!env.LLM_PRICE_INPUT_PER_MTOK || !env.LLM_PRICE_OUTPUT_PER_MTOK || !Number.isFinite(pIn) || !Number.isFinite(pOut)) return FLAT_CALL_COST_USD;
  return (inputTokens * pIn + outputTokens * pOut) / 1e6;
}

const today = () => new Date().toISOString().slice(0, 10);
const cap = () => Number(process.env.LLM_DAILY_SPEND_CAP_USD || 5);

export async function spentToday() {
  const [row] = await db().select().from(llmUsage).where(eq(llmUsage.day, today()));
  return { day: today(), cap: cap(), calls: row?.calls ?? 0, costUsd: Number(row?.costUsd ?? 0) };
}

export async function recordUsage(inputTokens: number, outputTokens: number) {
  const cost = callCost(inputTokens, outputTokens).toFixed(6);
  await db().insert(llmUsage).values({ day: today(), calls: 1, inputTokens, outputTokens, costUsd: cost }).onConflictDoUpdate({
    target: llmUsage.day,
    set: {
      calls: sql`${llmUsage.calls} + 1`,
      inputTokens: sql`${llmUsage.inputTokens} + ${inputTokens}`,
      outputTokens: sql`${llmUsage.outputTokens} + ${outputTokens}`,
      costUsd: sql`${llmUsage.costUsd} + ${cost}`,
    },
  });
}

export const spendCap: LanguageModelMiddleware = {
  specificationVersion: "v4",
  wrapGenerate: async ({ doGenerate }) => {
    const s = await spentToday();
    if (s.cap > 0 && s.costUsd >= s.cap) throw new SpendCapError(`daily LLM spending cap reached ($${s.cap})`);
    const result = await doGenerate();
    // Bookkeeping must never fail the call that already succeeded.
    await recordUsage(result.usage.inputTokens.total ?? 0, result.usage.outputTokens.total ?? 0).catch((e) => console.error("[llm] usage not recorded:", (e as Error).message));
    return result;
  },
  // shortcut: streaming calls are not capped; Undo makes none today. Add a wrapStream check if one is added.
};
