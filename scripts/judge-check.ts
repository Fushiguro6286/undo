// Day 12 done-when: runs the three /judge one-click scenarios over HTTP exactly as the judge page does
// (reserve a pool order + open the claim, upload the sample photo, pick the remedy), then waits for PayPal to confirm.
// Usage: npx tsx scripts/judge-check.ts https://undo-nu.vercel.app [merchant|denial|agent]
import { readFile } from "node:fs/promises";

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const EXPECT = { merchant: "MERCHANT", denial: "BUYER", agent: "AGENT" } as const;
const DONE = ["RESOLVED", "DENIED", "CLOSED"];

async function call(path: string, init?: RequestInit) {
  const res = await fetch(base + path, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${json.error ?? ""}`);
  return json;
}
const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

let failed = 0;
const only = process.argv[3];
for (const [scenario, party] of Object.entries(EXPECT).filter(([k]) => !only || k === only)) {
  const t0 = Date.now();
  try {
    const j = await post("/api/judge/run", { scenario });
    const form = new FormData();
    form.append("photo", new Blob([await readFile(`public/samples/${j.photo}`)], { type: "image/jpeg" }), j.photo);
    const c = await call(`/api/claims/${j.claimId}/evidence`, { method: "POST", body: form });
    const offer = c.offers.find((o: { action: string }) => o.action === j.choose);
    if (c.faultParty !== party || !offer) throw new Error(`fault ${c.faultParty} (want ${party}); offers ${c.offers.map((o: { action: string }) => o.action).join(",")}`);
    const { result } = await post(`/api/claims/${j.claimId}/choose`, { offer_id: offer.id });
    let status = result.status;
    for (let i = 0; i < 36 && !DONE.includes(status); i++) {
      await new Promise((r) => setTimeout(r, 5000));
      status = (await call(`/api/claims/${j.claimId}`)).status;
    }
    const ids = [result.refund?.refundId && `refund ${result.refund.refundId}`, result.payout?.payoutBatchId && `payout ${result.payout.payoutBatchId}`].filter(Boolean).join(" ");
    const ok = DONE.includes(status);
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"} ${scenario}: order ${j.orderId}, fault ${c.faultParty}, ${j.choose} -> ${status} ${ids} (${Math.round((Date.now() - t0) / 1000)} s)`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${scenario}: ${(e as Error).message}`);
  }
}
console.log(failed ? `${failed} FAILED` : "ALL PASS");
