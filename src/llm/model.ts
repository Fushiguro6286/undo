import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

/** The configured language model (must accept images: the vision step uses it too). */
export function model() {
  const provider = process.env.LLM_PROVIDER || "google";
  // google reads GOOGLE_GENERATIVE_AI_API_KEY; anthropic reads ANTHROPIC_API_KEY
  if (provider === "google") return google(process.env.LLM_MODEL || "gemini-3.5-flash-lite");
  if (provider === "anthropic") return anthropic(process.env.LLM_MODEL || "claude-sonnet-5-5");
  throw new Error(`LLM_PROVIDER "${provider}" is not supported (use google or anthropic)`);
}

/** Untrusted text goes inside delimited fields as data; strip anything that could close the delimiter. */
/** Every LLM call gets this budget; a timeout becomes an error the caller handles (never a hung request). */
export const LLM_TIMEOUT_MS = 30_000;

export const asData = (s: string) => s.replace(/[<>]/g, " ").slice(0, 2000);
