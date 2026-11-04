// MCP over streamable HTTP, stateless: a fresh server + transport per request, JSON responses (serverless-friendly).
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildServer } from "@/src/mcp/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // claim_status / choose_remedy can wait on PayPal and the LLM

async function handle(req: Request) {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await buildServer().connect(transport);
  return transport.handleRequest(req);
}

export { handle as GET, handle as POST, handle as DELETE };
