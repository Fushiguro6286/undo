// S8: disputes on a sandbox dispute opened by a buyer: list, show, read HATEOAS links, then run the next
// available sandbox step: require-evidence -> provide-evidence (multipart) -> adjudicate. Each step runs only
// when the dispute's own links offer it. Re-run to continue if PayPal hasn't moved the case yet.
// Usage: npm run spike scripts/spikes/s8-disputes.ts [disputeId] [--list]
// The `input` multipart part name is NOT in PayPal's published schema; this spike verifies it against sandbox.
import { fail, merchant, pass, sleep, spike } from "./_lib";

// Smallest valid one-page PDF (PayPal accepts PDF/JPG/PNG/GIF evidence).
const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF`;

await spike("S8", async () => {
  const pp = merchant();
  const list = await pp.request("GET", "/v1/customer/disputes?page_size=10");
  const items = list.items ?? [];
  console.log(`disputes visible to the merchant: ${items.length}`);
  for (const d of items) console.log(`  ${d.dispute_id} ${d.status} ${d.dispute_life_cycle_stage ?? ""} ${d.reason} created ${d.create_time}`);
  if (process.argv.includes("--list")) return;
  const id = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? items[0]?.dispute_id;
  if (!id) return fail("S8", "no disputes found: open one from a sandbox buyer account first (it can take a few minutes to appear)");

  const show = async () => {
    const d = await pp.request("GET", `/v1/customer/disputes/${id}`);
    const actions = (d.links ?? []).map((l: any) => l.href.split("/").pop()).filter((a: string) => a !== id);
    console.log(`\n${id}: status=${d.status} stage=${d.dispute_life_cycle_stage} state=${d.dispute_state ?? "-"} actions=[${actions.join(", ")}]`);
    return { d, can: (a: string) => actions.includes(a) };
  };
  const steps: string[] = [];
  let { d, can } = await show();

  if (can("require-evidence")) {
    await pp.request("POST", `/v1/customer/disputes/${id}/require-evidence`, { body: { action: "SELLER_EVIDENCE" } });
    steps.push("require-evidence");
    await sleep(3000);
    ({ d, can } = await show());
  }
  if (can("provide-evidence")) {
    const form = new FormData();
    // Send the type PayPal requested from the seller (e.g. PROOF_OF_FULFILLMENT for "not received"); OTHER is rejected there.
    const type = d.evidences?.find((e: any) => e.source === "REQUESTED_FROM_SELLER")?.evidence_type ?? "OTHER";
    const evidence: any = { evidence_type: type, notes: "Undo spike S8: evidence pack (order, PayPal approval, intent hash, photo result, tracking).", documents: [{ name: "undo-evidence.pdf" }] };
    if (type === "PROOF_OF_FULFILLMENT") evidence.evidence_info = { tracking_info: [{ carrier_name: "OTHER", carrier_name_other: "Undo Test Carrier", tracking_number: `UNDO${Date.now()}` }] };
    const input = { evidences: [evidence] };
    console.log(`providing evidence type ${type}`);
    form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
    form.append("evidence-file", new Blob([PDF], { type: "application/pdf" }), "undo-evidence.pdf");
    await pp.request("POST", `/v1/customer/disputes/${id}/provide-evidence`, { form });
    steps.push("provide-evidence (multipart: input + evidence-file)");
    await sleep(3000);
    ({ d, can } = await show());
  }
  if (can("adjudicate")) {
    await pp.request("POST", `/v1/customer/disputes/${id}/adjudicate`, { body: { adjudication_outcome: "SELLER_FAVOR" } });
    steps.push("adjudicate SELLER_FAVOR");
    await sleep(3000);
    ({ d } = await show());
  }
  const ids = { disputeId: id, transactionId: d.disputed_transactions?.[0]?.seller_transaction_id, status: d.status, outcome: d.dispute_outcome?.outcome_code, stepsRun: steps };
  if (steps.length) pass("S8", `ran ${steps.length} step(s); re-run to continue if more links appear later`, ids);
  else fail("S8", "no sandbox step link offered yet (case may still be an inquiry: escalate it to a claim as the buyer, or wait and re-run)", ids);
});
