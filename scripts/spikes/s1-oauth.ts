// S1: OAuth works for the merchant app and the agent-platform app.
import { agentPlatform, fail, merchant, pass, spike } from "./_lib";

const PAYOUTS = "https://uri.paypal.com/payments/payouts";
const DISPUTES = "https://uri.paypal.com/services/disputes/update-seller";

await spike("S1 merchant", async () => {
  const w = await merchant().whoami();
  pass("S1 merchant", "token obtained", { appId: w.appId, expiresInSec: w.expiresInSec, disputesScope: w.scopes.includes(DISPUTES), scopeCount: w.scopes.length });
  if (!w.scopes.includes(DISPUTES)) fail("S1 merchant", "disputes scope missing: enable Disputes on the merchant REST app");
});
await spike("S1 agent-platform", async () => {
  const w = await agentPlatform().whoami();
  pass("S1 agent-platform", "token obtained", { appId: w.appId, expiresInSec: w.expiresInSec, payoutsScope: w.scopes.includes(PAYOUTS), scopeCount: w.scopes.length });
  if (!w.scopes.includes(PAYOUTS)) fail("S1 agent-platform", "payouts scope missing: enable Payouts on the agent-platform REST app");
});
