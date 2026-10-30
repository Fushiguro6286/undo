import { anthropic } from "@ai-sdk/anthropic";

/** The configured language model (must accept images: the vision step uses it too). */
export function model() {
  const provider = process.env.LLM_PROVIDER || "anthropic";
  // shortcut: only Anthropic is wired; add another @ai-sdk provider here if LLM_PROVIDER changes
  if (provider !== "anthropic") throw new Error(`LLM_PROVIDER "${provider}" is not supported`);
  return anthropic(process.env.LLM_MODEL || "claude-sonnet-5-5");
}

/** Untrusted text goes inside delimited fields as data; strip anything that could close the delimiter. */
export const asData = (s: string) => s.replace(/[<>]/g, " ").slice(0, 2000);
