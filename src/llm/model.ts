import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { wrapLanguageModel } from "ai";
import { spendCap } from "./spend";

/** The configured language model (must accept images: the vision step uses it too), behind the daily spending cap. */
export function model() {
  const provider = process.env.LLM_PROVIDER || "google";
  // google reads GOOGLE_GENERATIVE_AI_API_KEY; anthropic reads ANTHROPIC_API_KEY
  const base =
    provider === "google" ? google(process.env.LLM_MODEL || "gemini-3.5-flash-lite")
    : provider === "anthropic" ? anthropic(process.env.LLM_MODEL || "claude-opus-5-5")
    : null;
  if (!base) throw new Error(`LLM_PROVIDER "${provider}" is not supported (use google or anthropic)`);
  return wrapLanguageModel({ model: base, middleware: spendCap });
}

/** Every LLM call gets this budget; a timeout becomes an error the caller handles (never a hung request). */
export const LLM_TIMEOUT_MS = 30_000;

/** Untrusted text goes inside delimited fields as data; strip anything that could close the delimiter. */
export const asData = (s: string) => s.replace(/[<>]/g, " ").slice(0, 2000);
