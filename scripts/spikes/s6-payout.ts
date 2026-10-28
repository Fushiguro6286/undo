// S6: payout from the agent-platform app to a sandbox buyer email; a reused sender_batch_id must be rejected.
// Usage: npm run spike scripts/spikes/s6-payout.ts [buyerEmail]   (default SPIKE_BUYER_EMAIL)
import { agentPlatform, fail, pass, save, sleep, spike } from "./_lib";

await spike("S6", async () => {
  const pp = agentPlatform();
  const email = process.argv[2] ?? process.env.SPIKE_BUYER_EMAIL;
  if (!email) throw new Error("set SPIKE_BUYER_EMAIL in .env or pass a sandbox buyer email");
  const senderBatchId = `spike-s6-${Date.now()}`;
  const body = {
    sender_batch_header: { sender_batch_id: senderBatchId, email_subject: "Undo: compensation from your agent platform", recipient_type: "EMAIL" },
    items: [{ recipient_type: "EMAIL", amount: { value: "2.00", currency: "USD" }, receiver: email, note: "Undo spike S6", sender_item_id: `${senderBatchId}-1` }],
  };
  const created = await pp.request("POST", "/v1/payments/payouts", { body });
  const batchId = created.batch_header.payout_batch_id;
  let status = created.batch_header.batch_status;
  for (let i = 0; i < 24 && ["PENDING", "PROCESSING"].includes(status); i++) {
    await sleep(5000);
    status = (await pp.request("GET", `/v1/payments/payouts/${batchId}`)).batch_header.batch_status;
  }
  let duplicate = "accepted (BAD)";
  try {
    await pp.request("POST", "/v1/payments/payouts", { body });
  } catch (e) {
    duplicate = `rejected: ${(e as Error).message}`;
  }
  save("s6", { batchId, senderBatchId });
  const ids = { payoutBatchId: batchId, batchStatus: status, duplicateSenderBatchId: duplicate };
  if (status === "SUCCESS" && duplicate.startsWith("rejected")) pass("S6", "payout succeeded; duplicate batch id rejected", ids);
  else fail("S6", "payout not SUCCESS or duplicate accepted", ids);
});
