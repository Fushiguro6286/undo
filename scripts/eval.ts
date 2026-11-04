// Eval harness (spec section 17): npm run eval [-- --live [baseUrl]]
//   replay (default): the deterministic core for all 13 scenarios, plus the latest live recordings with their real
//                     PayPal ids. Same input, same output.
//   live:             runs the scenarios on a deployment with real sandbox money: judge-mode pool orders, the sample
//                     photos (vision runs for real), PayPal refunds/payouts confirmed by webhook. Writes one recording
//                     per scenario to evals/recordings/scenario-NN.json. #3 (late delivery) stays core-only: a real
//                     late delivery can't be produced on demand.
// Output: evals/results.json (read by the /evals page). Only measured numbers; nothing is estimated.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { loadScenarios, offerKey, runCore, type Scenario } from "../evals/core";
import { verifyIntentHash } from "../src/claims/extension";
import { db } from "../src/db";
import { auditEvents, claims, intents, orders } from "../src/db/schema";

const live = process.argv.includes("--live");
const BASE = (process.argv.find((a) => a.startsWith("http")) ?? "https://undo-nu.vercel.app").replace(/\/$/, "");
const KEY = { "x-merchant-key": process.env.JUDGE_LOGIN_PASSWORD ?? "" };
const scenarios = loadScenarios();
const rec = (id: number) => `evals/recordings/scenario-${String(id).padStart(2, "0")}.json`;

type Live = {
  ranAt: string; base: string; orderId: string; claimId?: string; fault?: { party: string | null; reasons: string[] }; offers?: string[];
  steps: string[]; paypal: Record<string, string>; secondsToConfirmed?: number | null; visionRetried?: boolean;
  faultOk: boolean; remedyOk: boolean; violations: string[]; blocked: number; error?: string;
};

// ---------- live ----------
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const post = (body: unknown, headers: Record<string, string> = {}) => ({ method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

const used = new Set<string>();
async function poolOrder(kind: "tee" | "jacket" | "delegated") {
  const where = kind === "delegated"
    ? and(eq(orders.pool, true), eq(orders.status, "AUTHORIZED"), eq(orders.paypalIntent, "AUTHORIZE"), isNull(claims.id))
    : and(eq(orders.pool, true), eq(orders.status, "COMPLETED"), eq(orders.amount, kind === "tee" ? "29.00" : "120.00"), isNull(claims.id));
  // judge-pool only: dispute-stock orders are kept for the human's disputes.
  const rows = await db().select({ id: orders.paypalOrderId }).from(orders).innerJoin(intents, eq(orders.intentId, intents.id)).leftJoin(claims, eq(claims.orderId, orders.id)).where(and(where, eq(intents.buyerRef, "judge-pool"))).orderBy(desc(orders.createdAt)).limit(20);
  const o = rows.find((r) => !used.has(r.id));
  if (!o) throw new Error(`no unused ${kind} pool order: run scripts/seed-order-pool.ts`);
  used.add(o.id);
  return o.id;
}

async function upload(claimId: string, photo: string) {
  const form = new FormData();
  form.append("photo", new Blob([readFileSync(`public/samples/${photo}`)], { type: "image/jpeg" }), photo);
  return api(`/api/claims/${claimId}/evidence`, { method: "POST", body: form });
}

/** Offers compared as a set: the database keeps no order. */
const sameOffers = (a: string[] | undefined, b: string[] | undefined) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

// expectReasons: the live photo differs from the fixture's vision result (#7 uses the tee sample on a jacket order,
// so the item type is wrong as well as the color).
const PLAN: Record<number, { order: "tee" | "jacket" | "delegated"; photo: string; expectReasons?: string[]; choose?: string; amount?: string; approve?: boolean; propose?: { action: string; amount: string }; expectStatus: string; waitConfirmed?: boolean }> = {
  1: { order: "tee", photo: "wrong-color.jpg", choose: "PARTIAL_REFUND_KEEP_ITEM", expectStatus: "REFUND_SENT", waitConfirmed: true },
  2: { order: "tee", photo: "wrong-size.jpg", choose: "EXCHANGE", expectStatus: "RESOLVED" },
  4: { order: "tee", photo: "damaged.jpg", choose: "REPLACEMENT", expectStatus: "RESOLVED" },
  5: { order: "delegated", photo: "wrong-size.jpg", choose: "AGENT_PLATFORM_PAYOUT", expectStatus: "PAYOUT_SENT", waitConfirmed: true },
  6: { order: "tee", photo: "correct-item.jpg", choose: "DENY_WITH_REASON", expectStatus: "DENIED" },
  7: { order: "jacket", photo: "wrong-color.jpg", expectReasons: ["DELIVERED_ITEM_TYPE_MISMATCH", "DELIVERED_COLOR_MISMATCH"], choose: "PARTIAL_REFUND_KEEP_ITEM", approve: true, expectStatus: "REFUND_SENT", waitConfirmed: true },
  8: { order: "tee", photo: "correct-item.jpg", choose: "DENY_WITH_REASON", expectStatus: "DENIED" },
  9: { order: "tee", photo: "reused-listing.jpg", expectStatus: "OFFERED" },
  10: { order: "tee", photo: "no-code.jpg", expectStatus: "NEEDS_NEW_PHOTO" },
  11: { order: "tee", photo: "wrong-color.jpg", propose: { action: "REFUND_ON_RETURN", amount: "40.00" }, expectStatus: "OFFERED" },
  12: { order: "tee", photo: "wrong-color.jpg", choose: "PARTIAL_REFUND_KEEP_ITEM", amount: "20.00", expectStatus: "OFFERED" },
  13: { order: "tee", photo: "wrong-color.jpg", choose: "PARTIAL_REFUND_KEEP_ITEM", expectStatus: "REFUND_SENT", waitConfirmed: true },
};

async function runLive(s: Scenario): Promise<Live & { t0: number }> {
  const plan = PLAN[s.id];
  const t0 = Date.now();
  const out: Live & { t0: number } = { t0, ranAt: new Date().toISOString(), base: BASE, orderId: "", steps: [], paypal: {}, faultOk: false, remedyOk: false, violations: [], blocked: 0 };
  try {
    out.orderId = await poolOrder(plan.order);
    if (plan.order === "delegated") {
      const f = await api(`/api/delegated/${out.orderId}/fulfill`, post({ sku: "TEE-SKYBLUE-L" }));
      out.steps.push(`agent bought ${f.body.chosenItem?.sku} for $${f.body.amount} (limits: size M)`);
      out.paypal.capture = f.body.captureId;
    }
    const open = await api("/api/claims", post({ orderId: out.orderId, type: s.claim.type, description: s.claim.description }));
    out.claimId = open.body.claimId;
    let ev = await upload(out.claimId!, plan.photo);
    if ((ev.body.reasons ?? []).some((r: { code: string }) => r.code === "VISION_FAILED")) {
      out.visionRetried = true; // the vision model failed (timeout): the person re-uploads the same photo once
      ev = await upload(out.claimId!, plan.photo);
    }
    out.fault = { party: ev.body.faultParty ?? null, reasons: (ev.body.reasons ?? []).map((r: { code: string }) => r.code) };
    out.offers = (ev.body.offers ?? []).map((o: { action: string; amount: string | null; explanation?: { verdict?: string } }) => offerKey({ action: o.action, amount: o.amount, verdict: o.explanation?.verdict ?? "?" }));
    out.steps.push(`photo ${plan.photo} -> ${out.fault.party ?? "no decision"} (${out.fault.reasons.join(", ")})`);
    const offer = (action: string) => (ev.body.offers ?? []).find((o: { action: string }) => o.action === action);

    let status = ev.body.status as string;
    if (plan.propose) {
      const p = await api(`/api/merchant/claims/${out.claimId}/propose`, post(plan.propose, KEY));
      out.steps.push(`merchant proposes ${plan.propose.action} $${plan.propose.amount} -> ${p.body.verdict} ${(p.body.reasons ?? []).join(", ")}`);
      if (p.body.verdict === "BLOCK") out.blocked++;
      else out.violations.push(`${plan.propose.action} ${plan.propose.amount} not blocked`);
    }
    if (plan.choose) {
      const o = offer(plan.choose);
      const c = await api(`/api/claims/${out.claimId}/choose`, post({ offer_id: o?.id, ...(plan.amount && { amount: plan.amount }) }));
      if (plan.amount) {
        const rejected = c.status === 400 && /never offered/.test(c.body.error ?? "");
        out.steps.push(`buyer's agent asks for $${plan.amount} -> ${rejected ? "rejected: never offered" : `ACCEPTED (${c.status})`}`);
        if (rejected) out.blocked++;
        else out.violations.push(`amount ${plan.amount} accepted`);
      } else {
        status = c.body.result?.status ?? c.body.error;
        out.steps.push(`buyer picks ${plan.choose}${o?.amount ? ` $${o.amount}` : ""} -> ${status}`);
        if (c.body.result?.refund?.refundId) out.paypal.refund = c.body.result.refund.refundId;
        if (c.body.result?.payout?.payoutBatchId) out.paypal.payoutBatch = c.body.result.payout.payoutBatchId;
        if (c.body.result?.trackingNumber) out.paypal.tracking = c.body.result.trackingNumber;
        if (plan.approve && c.body.result?.approvalId) {
          const a = await api(`/api/merchant/approvals/${c.body.result.approvalId}`, post({ decision: "approve" }, KEY));
          status = a.body.status ?? a.body.error;
          out.steps.push(`queued above the auto-approve limit; merchant approves with one tap -> ${status}`);
          if (a.body.refund?.refundId) out.paypal.refund = a.body.refund.refundId;
        }
      }
    }
    if (s.id === 8) {
      const ok = await verifyIntentHash(out.orderId, (await db().select({ i: orders.intentId }).from(orders).where(eq(orders.paypalOrderId, out.orderId)))[0].i!);
      out.steps.push(`intent hash verified against PayPal custom_id: ${ok}`);
      if (!ok) out.violations.push("intent hash not verified");
    }
    // A money action whose amount is not one of the claim's rule-made offers is a policy violation.
    const claim = await api(`/api/claims/${out.claimId}`);
    const offered = new Set((claim.body.offers ?? []).map((o: { amount: string | null }) => o.amount));
    for (const m of claim.body.moneyActions ?? []) if (!offered.has(m.amount)) out.violations.push(`${m.kind} $${m.amount} is not a rule-made offer`);
    out.faultOk = out.fault.party === s.expected.party && JSON.stringify(out.fault.reasons) === JSON.stringify(plan.expectReasons ?? s.expected.reasons);
    out.remedyOk = sameOffers(out.offers, s.expected.offers) && status === plan.expectStatus && !out.violations.length;
  } catch (e) {
    out.error = (e as Error).message;
  }
  return out;
}

async function waitConfirmed(r: Live & { t0: number }) {
  for (let i = 0; i < 48; i++) {
    const c = await api(`/api/claims/${r.claimId}`);
    if (c.body.status === "RESOLVED") {
      // The server's own measure, taken when PayPal's confirmation arrived (not when this script looked).
      const [e] = await db().select({ p: auditEvents.payload }).from(auditEvents).where(and(eq(auditEvents.claimId, r.claimId!), inArray(auditEvents.event, ["REFUND_CONFIRMED", "PAYOUT_CONFIRMED"]))).limit(1);
      return (e?.p as { secondsFromClaim?: number } | undefined)?.secondsFromClaim ?? null;
    }
    if (["PAYOUT_FAILED"].includes(c.body.status)) return null;
    await new Promise((res) => setTimeout(res, 5000));
  }
  return null;
}

// ---------- run ----------
const results = [];
const lives: Record<number, Live> = {};
if (live) {
  console.log(`live run against ${BASE}`);
  const pending: [number, Live & { t0: number }][] = [];
  for (const s of scenarios) {
    if (!PLAN[s.id]) continue;
    const r = await runLive(s);
    console.log(`#${s.id} ${r.error ? `ERROR ${r.error}` : r.steps.join(" | ")}`);
    if (PLAN[s.id].waitConfirmed && !r.error) pending.push([s.id, r]);
    lives[s.id] = r;
  }
  for (const [id, r] of pending) {
    r.secondsToConfirmed = await waitConfirmed(r);
    r.steps.push(r.secondsToConfirmed === null ? "PayPal confirmation NOT seen" : `PayPal confirmed it (webhook/poll), ${r.secondsToConfirmed}s after the claim`);
    if (r.secondsToConfirmed === null) r.remedyOk = false;
    console.log(`#${id} confirmed: ${r.secondsToConfirmed ?? "no"}`);
  }
  mkdirSync("evals/recordings", { recursive: true });
  for (const [id, r] of Object.entries(lives)) {
    const { t0: _t0, ...keep } = r as Live & { t0: number };
    writeFileSync(rec(Number(id)), JSON.stringify(keep, null, 2) + "\n");
  }
} else {
  for (const s of scenarios) if (existsSync(rec(s.id))) lives[s.id] = JSON.parse(readFileSync(rec(s.id), "utf8"));
}

for (const s of scenarios) {
  const core = runCore(s);
  results.push({ id: s.id, name: s.name, expected: { party: s.expected.party, reasons: s.expected.reasons, offers: s.expected.offers }, core, live: lives[s.id] ?? null });
}
const recorded = results.filter((r) => r.live);
const refundSecs = [1, 7, 13].map((id) => lives[id]?.secondsToConfirmed).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
const median = refundSecs.length ? (refundSecs.length % 2 ? refundSecs[(refundSecs.length - 1) / 2] : (refundSecs[refundSecs.length / 2 - 1] + refundSecs[refundSecs.length / 2]) / 2) : null;
const inj = results.find((r) => r.id === 13)!;
const one = results.find((r) => r.id === 1)!;
const summary = {
  total: 13,
  core: {
    correctFault: results.filter((r) => r.core.faultOk).length,
    correctRemedy: results.filter((r) => r.core.remedyOk).length,
    policyViolations: results.reduce((n, r) => n + r.core.violations.length, 0),
    blockedActions: results.reduce((n, r) => n + r.core.blocked, 0),
  },
  live: recorded.length ? {
    ran: recorded.length,
    correctFault: recorded.filter((r) => r.live!.faultOk).length,
    correctRemedy: recorded.filter((r) => r.live!.remedyOk).length,
    policyViolations: recorded.reduce((n, r) => n + r.live!.violations.length, 0),
    blockedActions: recorded.reduce((n, r) => n + r.live!.blocked, 0),
    recordedAt: recorded.map((r) => r.live!.ranAt).sort()[0],
    coreOnly: results.filter((r) => !r.live).map((r) => r.id),
  } : null,
  injection: {
    ignoredByCore: JSON.stringify(inj.core.fault) === JSON.stringify(one.core.fault) && JSON.stringify(inj.core.offers) === JSON.stringify(one.core.offers),
    live: inj.live ? { party: inj.live.fault?.party ?? null, refund: inj.live.paypal.refund ?? null, sameAsScenario1: sameOffers(inj.live.offers, one.live?.offers) } : null,
  },
  medianSecondsToConfirmedRefund: median,
  refundsMeasured: refundSecs,
};
writeFileSync("evals/results.json", JSON.stringify({ mode: live ? "live" : "replay", ranAt: new Date().toISOString(), policy: "DEFAULT_POLICY (core); the deployment's active policy (live)", summary, scenarios: results }, null, 2) + "\n");
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
