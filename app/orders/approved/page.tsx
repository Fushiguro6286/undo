// PayPal sends the buyer here after they approve an order created from an agent's approval link (?token=ORDER_ID).
import { Stamp } from "../../Stamp";
import { completeApproval, fulfillDelegated, getOrder } from "@/src/intent/orders";
import { itemName, variantBySku } from "@/src/store/catalog";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approved · Undo" };

async function settle(token: string) {
  let o = await completeApproval(token); // captures CONFIRMED, authorizes DELEGATED; a reload never does it twice
  if (o.status === "AUTHORIZED" && o.agentPickSku) o = await fulfillDelegated(token, o.agentPickSku);
  return getOrder(o.paypalOrderId);
}

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  let order: Awaited<ReturnType<typeof settle>> | undefined;
  let error: string | undefined;
  try {
    if (!/^[A-Z0-9]{10,30}$/.test(token)) throw new Error("This link is missing its PayPal order.");
    order = await settle(token);
  } catch (e) {
    error = (e as Error).message;
  }
  const chosen = order?.chosenItem as { sku: string; limit_violations: string[] } | null | undefined;
  const pick = chosen ? variantBySku(chosen.sku) : undefined;
  return (
    <main className="page">
      <header className="hero">
        <p className="eyebrow">Fernleaf Goods · PayPal approval</p>
        <h1>{error ? "Something went wrong" : "Approved on PayPal"}</h1>
      </header>
      {order && <Stamp text={order.status === "AUTHORIZED" ? "Limit approved" : "Approved"} sub="on PayPal, by the buyer" tone="ok" />}
      <section className="card stack">
        {error && <p className="error" role="alert">{error}</p>}
        {order && (
          <div className="receipt-wrap"><dl className="facts receipt">
            <dt>PayPal order</dt><dd><code>{order.paypalOrderId}</code></dd>
            <dt>Mode</dt><dd>{order.intent?.mode === "DELEGATED" ? "Your agent buys inside the limits you approved" : "You approved this exact cart"}</dd>
            <dt>Status</dt><dd>{order.status === "COMPLETED" ? `Paid $${order.amount}` : order.status === "AUTHORIZED" ? `Up to $${order.ceiling} reserved; your agent has not picked yet` : order.status}</dd>
            {pick && <><dt>Agent bought</dt><dd>{itemName(pick)} · ${pick.price}{chosen?.limit_violations.length ? <span className="warn"> · outside your limits</span> : " · inside your limits"}</dd></>}
            <dt>Intent hash</dt><dd><span className="hash">{order.intent?.hash}</span></dd>
          </dl></div>
        )}
        <p className="muted">You can close this tab and go back to your agent.</p>
      </section>
    </main>
  );
}
