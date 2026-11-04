// Shows one dispute's reason, stage, status, requested evidence and offered links. Usage: ... dispute-show.ts <id>
import { merchant } from "../../src/paypal/client";
const d = await merchant().request("GET", `/v1/customer/disputes/${process.argv[2]}`);
console.log(JSON.stringify({ reason: d.reason, stage: d.dispute_life_cycle_stage, status: d.status, txn: d.disputed_transactions?.[0]?.seller_transaction_id, seller_due: d.seller_response_due_date, requested: d.evidences?.filter((e: { source?: string }) => e.source === "REQUESTED_FROM_SELLER").map((e: { evidence_type: string }) => e.evidence_type), allowed: d.allowed_response_options, links: d.links?.map((l: { rel: string }) => l.rel) }));
process.exit(0);
