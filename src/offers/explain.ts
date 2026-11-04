// Explanation writer (LLM, no tools): one plain-language line per offer for the buyer and for the merchant.
// It sees only rule-made facts, never claim text. Any amount it states must equal the offer's rule amount,
// otherwise it is regenerated, and after 3 tries the fixed template text is used.
import { generateText, Output } from "ai";
import { z } from "zod";
import type { FaultParty, Reason } from "../fault/engine";
import { LLM_TIMEOUT_MS, model } from "../llm/model";
import { toCents } from "../money/cents";
import { STORE_NAME } from "../store/catalog";
import type { OfferDraft } from "./generate";

export type Explanation = { buyer: string; merchant: string; source: "llm" | "template" };

const Explanations = z.object({ explanations: z.array(z.object({ buyer: z.string().max(300), merchant: z.string().max(300) })) });

const MONEY = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)|\b(\d+\.\d{2})\b/g;

/** True when every money amount in the text equals the offer amount (and there is none when the offer has no amount). */
export function amountsMatch(text: string, amount: string | null): boolean {
  const found = [...text.matchAll(MONEY)].map((m) => (m[1] ?? m[2]).replace(/,/g, ""));
  return found.every((f) => amount !== null && toCents(f) === toCents(amount));
}

const WHY: Record<FaultParty, string> = {
  MERCHANT: "the store sent the wrong item or delivered it late",
  CARRIER: "the item was damaged in transit",
  AGENT: "your shopping agent bought something outside the limits you approved",
  BUYER: "the order matches what was approved on PayPal",
  UNCLEAR: "the evidence needs a person to review it",
};

export function templateExplanation(o: OfferDraft, party: FaultParty): Explanation {
  const money = o.amount ? ` ($${o.amount})` : "";
  const wait = o.verdict === "QUEUE" ? " The store approves this before it is paid." : "";
  return {
    buyer: `${o.label}${money}, because ${WHY[party]}.${wait}`,
    merchant: `${o.label}${money}. Fault: ${party.toLowerCase()}; set by your policy (${o.ruleIds.join(", ") || "always offered"}).`,
    source: "template",
  };
}

export async function explainOffers(offers: OfferDraft[], party: FaultParty, reasons: Reason[]): Promise<Explanation[]> {
  if (!offers.length) return [];
  const facts = offers.map((o, n) => `${n + 1}. ${o.action} | ${o.label} | amount: ${o.amount ? `$${o.amount}` : "none"} | ${o.verdict === "QUEUE" ? "needs store approval" : "automatic"}`).join("\n");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { output } = await generateText({
        model: model(),
        output: Output.object({ schema: Explanations }),
        maxOutputTokens: 800,
        timeout: LLM_TIMEOUT_MS,
        system: [
          `You explain claim remedies for the store ${STORE_NAME}. For each numbered offer write one short, calm sentence for the buyer and one for the merchant, in the same order.`,
          "Use only the facts given. Never invent or change an amount: mention an amount only if the offer has one, written exactly as given. No promises beyond the offer.",
        ].join("\n"),
        prompt: `Fault: ${party} (${reasons.map((r) => r.code).join(", ")}).\nOffers:\n${facts}`,
      });
      const ex = Explanations.parse(output).explanations;
      if (ex.length === offers.length && ex.every((e, n) => amountsMatch(e.buyer, offers[n].amount) && amountsMatch(e.merchant, offers[n].amount))) {
        return ex.map((e) => ({ ...e, source: "llm" }));
      }
      console.warn(`[explain] attempt ${attempt + 1}: amounts or count did not match the rules; regenerating`);
    } catch (e) {
      console.error(`[explain] attempt ${attempt + 1}:`, (e as Error).message);
      break; // model error or timeout: don't keep the buyer waiting, use the template
    }
  }
  return offers.map((o) => templateExplanation(o, party));
}
