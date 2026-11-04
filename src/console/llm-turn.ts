// Server half of the AG Studio LLM adapter: one turn of Studio's agent loop through the AI SDK and the
// configured model. Tools are declared without `execute`, so the model only *names* a tool call; Studio runs
// the tool in the browser (through the merchant API and its evaluator) and sends the result in the next turn.
import { generateText, jsonSchema, Output, tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import { LLM_TIMEOUT_MS, model } from "../llm/model";

const Item = z.object({
  kind: z.string().optional(),
  type: z.string(),
  role: z.string().optional(),
  content: z.array(z.any()).optional(),
  callId: z.string().optional(),
  name: z.string().optional(),
  arguments: z.string().optional(),
  output: z.string().optional(),
});
export const TurnRequest = z.object({
  input: z.array(Item).max(300),
  instructions: z.string().max(60_000).optional(),
  tools: z.array(z.object({ name: z.string(), description: z.string(), parameters: z.record(z.string(), z.any()), kind: z.string().optional() })).max(60).optional(),
  toolChoice: z.union([z.enum(["auto", "none", "required"]), z.object({ name: z.string() })]).optional(),
  responseFormat: z.union([z.object({ type: z.literal("text") }), z.object({ type: z.literal("json"), name: z.string(), description: z.string().optional(), schema: z.record(z.string(), z.any()) })]),
});
type TurnRequest = z.infer<typeof TurnRequest>;

const textOf = (content: unknown[] = []) => content.map((c) => (c as { text?: string; refusal?: string }).text ?? (c as { refusal?: string }).refusal ?? "").join("");
const parse = (s = "") => { try { return JSON.parse(s || "{}"); } catch { return {}; } };

/** Studio's shapes mark optional values with a `{ not: {} }` branch; providers want plain JSON Schema. */
function clean(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(clean);
  if (!schema || typeof schema !== "object") return schema;
  const { $schema: _, ...rest } = schema as Record<string, unknown>;
  if (Array.isArray(rest.anyOf)) {
    const kept = rest.anyOf.filter((b) => !(b && typeof b === "object" && "not" in b && Object.keys(b).length === 1));
    if (kept.length === 1) {
      const { anyOf: __, ...others } = rest;
      return clean({ ...(kept[0] as object), ...others });
    }
    rest.anyOf = kept;
  }
  return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, clean(v)]));
}

export async function runTurn(r: TurnRequest) {
  const names = new Map<string, string>();
  const messages: ModelMessage[] = [];
  for (const it of r.input) {
    if (it.type === "message" && it.kind === "input") messages.push({ role: it.role === "system" ? "system" : "user", content: textOf(it.content) });
    else if (it.type === "message") messages.push({ role: "assistant", content: textOf(it.content) });
    else if (it.type === "function_call" && it.callId && it.name) {
      names.set(it.callId, it.name);
      messages.push({ role: "assistant", content: [{ type: "tool-call", toolCallId: it.callId, toolName: it.name, input: parse(it.arguments) }] });
    } else if (it.type === "function_call_output" && it.callId) {
      messages.push({ role: "tool", content: [{ type: "tool-result", toolCallId: it.callId, toolName: names.get(it.callId) ?? "tool", output: { type: "text", value: it.output ?? "" } }] });
    }
  }
  const tools: ToolSet = Object.fromEntries(
    (r.tools ?? []).filter((t) => t.kind !== "provided").map((t) => [t.name, tool({ description: t.description, inputSchema: jsonSchema(clean(t.parameters) as never) })]),
  );
  const choice = r.toolChoice;
  const res = await generateText({
    model: model(),
    system: r.instructions,
    messages,
    tools: Object.keys(tools).length ? tools : undefined,
    toolChoice: !choice || typeof choice === "string" ? choice : { type: "tool", toolName: choice.name },
    ...(r.responseFormat.type === "json" && { output: Output.object({ schema: jsonSchema(clean(r.responseFormat.schema) as never) }) }),
    maxOutputTokens: 2000,
    timeout: LLM_TIMEOUT_MS,
  });
  return {
    text: r.responseFormat.type === "json" && res.output !== undefined ? JSON.stringify(res.output) : res.text,
    toolCalls: res.toolCalls.map((c) => ({ callId: c.toolCallId, name: c.toolName, arguments: JSON.stringify(c.input ?? {}) })),
    usage: { inputTokens: res.usage.inputTokens ?? 0, outputTokens: res.usage.outputTokens ?? 0 },
  };
}
