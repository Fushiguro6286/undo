// Undo's MCP server for the buyer's agent (CLAUDE.md section 14). Five tools; none can record consent or move money:
// consent happens only on PayPal's approval page, and remedies come only from rule-made offers.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { eq } from "drizzle-orm";
import { z, ZodError } from "zod";
import { CLAIM_TYPES, ClaimError, getClaim, openClaim } from "../claims/claims";
import { resolutionResponse } from "../claims/extension";
import { chooseOffer } from "../claims/resolve";
import { db } from "../db";
import { orders } from "../db/schema";
import { extractLimits } from "../intent/extract";
import { describeLimits, Limits, matchVariants } from "../intent/limits";
import { CheckoutError, createCheckout } from "../intent/orders";
import { toCents } from "../money/cents";
import { itemName, variantBySku } from "../store/catalog";

const INSTRUCTIONS = `Undo is the claims desk for Fernleaf Goods (a fictional demo store on the PayPal sandbox).
Flow: propose_purchase -> get_approval_link (the person approves on PayPal; you cannot approve for them) -> after delivery,
if something is wrong, open_claim -> the person uploads a photo with the challenge code at the upload link -> claim_status
-> choose_remedy with one of the claim's resolution_options. You can never invent a remedy or an amount.`;

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

/** Known errors go back to the agent as tool errors; anything else stays generic (nothing secret is echoed). */
async function run(fn: () => Promise<unknown>) {
  try {
    return text(await fn());
  } catch (e) {
    const known = e instanceof ClaimError || e instanceof CheckoutError || e instanceof ZodError;
    if (!known) console.error("[mcp]", (e as Error).message);
    return { isError: true, content: [{ type: "text" as const, text: known ? (e as Error).message : "Undo could not complete that request; try again." }] };
  }
}

const base = () => process.env.APP_BASE_URL ?? "http://localhost:3000";
const Cart = z.array(z.object({ sku: z.string().max(60), qty: z.number().int().min(1).max(10) })).min(1).max(10);

export function buildServer() {
  const server = new McpServer({ name: "undo", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "propose_purchase",
    {
      title: "Propose a purchase",
      description: "Turns the person's request (e.g. 'sky-blue tee, size M, under $35, by Friday') into purchase limits and lists the store items that fit them.",
      inputSchema: { request: z.string().min(3).max(500).describe("the person's request, in their words") },
      annotations: { readOnlyHint: true },
    },
    ({ request }) =>
      run(async () => {
        const limits = await extractLimits(request);
        const matches = matchVariants(limits).slice(0, 10).map((v) => ({ sku: v.sku, name: itemName(v), price: v.price }));
        return {
          limits,
          summary: describeLimits(limits),
          matches,
          next: "Call get_approval_link: CONFIRMED with a cart the person agreed to, or DELEGATED with these limits (max_price is the ceiling) and optionally agent_pick_sku.",
        };
      }),
  );

  server.registerTool(
    "get_approval_link",
    {
      title: "Get PayPal approval link",
      description:
        "Creates the PayPal order and returns PayPal's approval URL for the person to open. Consent happens only there. CONFIRMED: the person approves this exact cart. DELEGATED: the person approves a spending ceiling and limits; your agent_pick_sku is bought at its actual price right after they approve.",
      inputSchema: {
        mode: z.enum(["CONFIRMED", "DELEGATED"]),
        limits: Limits.describe("the limits returned by propose_purchase"),
        cart: Cart.optional().describe("CONFIRMED only: items and quantities"),
        agent_pick_sku: z.string().max(60).optional().describe("DELEGATED only: the item the agent will buy inside the ceiling"),
        buyer_ref: z.string().max(100).optional().describe("an opaque reference for the person, never an email"),
      },
    },
    ({ mode, limits, cart, agent_pick_sku, buyer_ref }) =>
      run(async () => {
        if (mode === "CONFIRMED" && !cart) throw new CheckoutError("a CONFIRMED purchase needs a cart");
        let pick;
        if (mode === "DELEGATED") {
          if (!limits.max_price) throw new CheckoutError("a DELEGATED purchase needs limits.max_price (the ceiling)");
          pick = agent_pick_sku ? variantBySku(agent_pick_sku) : undefined;
          if (agent_pick_sku && !pick) throw new CheckoutError(`unknown sku ${agent_pick_sku}`);
          if (pick && toCents(pick.price) > toCents(limits.max_price)) throw new CheckoutError(`${pick.sku} costs $${pick.price}, above the $${limits.max_price} ceiling`);
        }
        const links = { returnUrl: `${base()}/orders/approved`, cancelUrl: `${base()}/orders/cancelled` };
        const r = await createCheckout(mode, buyer_ref ?? "mcp-agent", limits, mode === "CONFIRMED" ? cart! : null, undefined, links);
        if (pick) await db().update(orders).set({ agentPickSku: pick.sku }).where(eq(orders.paypalOrderId, r.orderId));
        return {
          order_id: r.orderId,
          approval_url: r.approveUrl,
          intent_hash: r.hash,
          mode,
          note: "Ask the person to open approval_url and approve on PayPal. Nothing is bought until they do. The intent hash is stored in the PayPal order's custom_id.",
        };
      }),
  );

  server.registerTool(
    "open_claim",
    {
      title: "Open a claim",
      description: "Opens a claim on a completed order. Returns a one-time challenge code and an upload link: the person photographs the item with the code visible and uploads it there.",
      inputSchema: {
        order_id: z.string().min(1).max(40).describe("the PayPal order id"),
        type: z.enum(CLAIM_TYPES),
        description: z.string().max(2000).default("").describe("what went wrong, in the person's words"),
      },
    },
    ({ order_id, type, description }) =>
      run(async () => {
        const c = await openClaim(order_id, type, description);
        return { claim_id: c.claimId, challenge_code: c.challengeCode, upload_url: c.uploadUrl, next: "Ask the person to open upload_url and upload the photo, then call claim_status." };
      }),
  );

  server.registerTool(
    "claim_status",
    {
      title: "Claim status",
      description: "The claim's state, the fault ruling with reasons, and the resolution_options the store's rules allow (each with an option_id).",
      inputSchema: { claim_id: z.string().max(40) },
      annotations: { readOnlyHint: true },
    },
    ({ claim_id }) => run(async () => resolutionResponse(await getClaim(claim_id))),
  );

  server.registerTool(
    "choose_remedy",
    {
      title: "Choose a remedy",
      description: "Picks one of the claim's rule-made resolution_options by option_id. Invented options or amounts are rejected. Money moves only if the store's policy allows it automatically; otherwise the store approves first.",
      inputSchema: {
        claim_id: z.string().max(40),
        option_id: z.string().max(40).describe("an option_id from claim_status"),
        amount: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().describe("optional; if given it must equal the option's amount"),
      },
    },
    ({ claim_id, option_id, amount }) =>
      run(async () => {
        const result = await chooseOffer(claim_id, option_id, amount);
        return { result, claim: await resolutionResponse(await getClaim(claim_id)) };
      }),
  );

  return server;
}
