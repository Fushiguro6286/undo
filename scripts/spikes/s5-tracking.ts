// S5: add tracking to an order, then update it. PayPal only allows PATCHing tracker status to CANCELLED,
// so this adds a tracker, patches notify_payer, cancels it, then adds the replacement tracker.
// Usage: npm run spike scripts/spikes/s5-tracking.ts [orderId] [captureId]   (defaults to S2 output)
import { fail, load, merchant, pass, spike } from "./_lib";

await spike("S5", async () => {
  const pp = merchant();
  const src = load("s2");
  const orderId = process.argv[2] ?? src?.orderId;
  const captureId = process.argv[3] ?? src?.captureId;
  if (!orderId || !captureId) throw new Error("run S2 first, or pass <orderId> <captureId>");
  const track = (n: string) =>
    pp.request("POST", `/v2/checkout/orders/${orderId}/track`, {
      body: { capture_id: captureId, tracking_number: n, carrier: "OTHER", carrier_name_other: "Undo Test Carrier", notify_payer: false },
    });
  const n1 = `UNDO${Date.now()}`;
  const o1 = await track(n1);
  const list1 = o1.purchase_units[0].shipping?.trackers ?? [];
  const t1 = list1.find((t: any) => t.id.endsWith(n1)) ?? list1.at(-1);
  if (!t1) throw new Error("track call returned no trackers");
  await pp.request("PATCH", `/v2/checkout/orders/${orderId}/trackers/${t1.id}`, { body: [{ op: "replace", path: "/notify_payer", value: true }] });
  await pp.request("PATCH", `/v2/checkout/orders/${orderId}/trackers/${t1.id}`, { body: [{ op: "replace", path: "/status", value: "CANCELLED" }] });
  const n2 = `UNDO${Date.now()}B`;
  await track(n2);
  const trackers = (await pp.request("GET", `/v2/checkout/orders/${orderId}`)).purchase_units[0].shipping?.trackers ?? [];
  const summary = trackers.map((t: any) => `${t.id}=${t.status}`);
  const cancelled = trackers.find((t: any) => t.id === t1.id)?.status === "CANCELLED";
  const active = trackers.some((t: any) => t.id.endsWith(n2) && t.status === "SHIPPED");
  if (cancelled && active) pass("S5", "tracker added, patched, cancelled and replaced", { orderId, trackers: summary });
  else fail("S5", "tracker states not as expected", { orderId, trackers: summary });
});
