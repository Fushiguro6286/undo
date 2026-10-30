import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

/** The configured language model (must accept images: the vision step uses it too). */
export function model() {
  const provider = process.env.LLM_PROVIDER || "google";
  // google reads GOOGLE_GENERATIVE_AI_API_KEY; anthropic reads ANTHROPIC_API_KEY
  if (provider === "google") return google(process.env.LLM_MODEL || "gemini-3.8-flash");
  if (provider === "anthropic") return anthropic(process.env.LLM_MODEL || "claude-sonnet-5-5");
  throw new Error(`LLM_PROVIDER "${provider}" is not supported (use google or anthropic)`);
}

/** Untrusted text goes inside delimited fields as data; strip anything that could close the delimiter. */
export const asData = (s: string) => s.replace(/[<>]/g, " ").slice(0, 2000);
