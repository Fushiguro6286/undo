// MCP over streamable HTTP, stateless: a fresh server + transport per request, JSON responses (serverless-friendly).
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer } from "@/src/mcp/server";
import { rateLimit, RateLimitError } from "@/src/limits";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // claim_status / choose_remedy can wait on PayPal and the LLM

async function handle(req: Request) {
  try {
    await rateLimit(req, "mcp", 120);
  } catch (e) {
    if (!(e instanceof RateLimitError)) throw e;
    return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: e.message }, id: null }, { status: 429, headers: { "retry-after": String(Math.ceil(e.retryAfterSec)) } });
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await buildServer().connect(transport);
  return transport.handleRequest(req);
}

// Stateless: there is no server-to-client stream to open, so GET gets 405 (allowed by the MCP spec) instead of an
// SSE stream that hangs until the function times out.
export function GET() {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST, DELETE" } });
}

export { handle as POST, handle as DELETE };
