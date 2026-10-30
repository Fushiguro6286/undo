"use client";
import Script from "next/script";
import { useState } from "react";
import { PayPalButton } from "./PayPalButton";
import { productSvgDataUri } from "@/src/store/art";
import { itemName, type Product, type Variant } from "@/src/store/catalog";
import type { Limits } from "@/src/intent/limits";

type Extracted = { limits: Limits; description: string; matches: Variant[] };
type Mode = "CONFIRMED" | "DELEGATED";
type Order = {
  paypalOrderId: string; paypalIntent: string; status: string; amount: string | null; ceiling: string | null; captureId: string | null;
  authorizationId: string | null; promisedBy: string | null; chosenItem: (Variant & { limit_violations: string[] }) | null; intent: { hash: string; mode: Mode } | null;
};

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

function buyerRef() {
  try {
    let ref = localStorage.getItem("undo_buyer_ref");
    if (!ref) localStorage.setItem("undo_buyer_ref", (ref = `buyer-${crypto.randomUUID()}`));
    return ref;
  } catch {
    return `buyer-${crypto.randomUUID()}`;
  }
}

export function BuyerPage({ products, variants }: { products: Product[]; variants: Variant[] }) {
  const [sdkReady, setSdkReady] = useState(false);
  const [request, setRequest] = useState("A sky-blue tee, size M, under $35, by Friday");
  const [busy, setBusy] = useState(false);
  const [extracted, setExtracted] = useState<Extracted>();
  const [sku, setSku] = useState<string>();
  const [mode, setMode] = useState<Mode>("CONFIRMED");
  const [order, setOrder] = useState<Order>();
  const [agentSku, setAgentSku] = useState("");
  const [error, setError] = useState<string>();

  async function ask() {
    setBusy(true); setError(undefined); setOrder(undefined); setExtracted(undefined);
    try {
      const r = await api<Extracted>("/api/intent/extract", { request });
      setExtracted(r);
      setSku(r.matches[0]?.sku);
      setMode(r.matches.length ? "CONFIRMED" : "DELEGATED");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const createOrder = () =>
    mode === "CONFIRMED"
      ? api<{ orderId: string }>("/api/checkout/confirmed", { buyerRef: buyerRef(), limits: extracted!.limits, cart: [{ sku, qty: 1 }] })
      : api<{ orderId: string }>("/api/checkout/delegated", { buyerRef: buyerRef(), limits: extracted!.limits });

  async function approved(orderId: string) {
    setError(undefined);
    try {
      setOrder(await api<Order>(`/api/orders/${orderId}/approve`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function agentBuys() {
    setBusy(true); setError(undefined);
    try {
      setOrder(await api<Order>(`/api/delegated/${order!.paypalOrderId}/fulfill`, agentSku ? { sku: agentSku } : {}));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const canDelegate = !!extracted?.limits.max_price;
  const canConfirm = !!extracted?.matches.length;

  return (
    <main className="page">
      <Script src="https://www.sandbox.paypal.com/web-sdk/v6/core" onLoad={() => setSdkReady(true)} onReady={() => window.paypal && setSdkReady(true)} />
      <header className="hero">
        <p className="eyebrow">Fernleaf Goods · PayPal sandbox demo</p>
        <h1>Let your agent shop. Stay in charge.</h1>
        <p className="muted">Tell your agent what to buy. You approve on PayPal: either the exact cart, or a spending limit the agent must stay inside.</p>
      </header>

      <section className="card">
        <label htmlFor="req"><strong>What should your agent buy?</strong></label>
        <div className="row">
          <input id="req" value={request} onChange={(e) => setRequest(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !busy && ask()} maxLength={500} />
          <button onClick={ask} disabled={busy || request.trim().length < 3}>{busy && !extracted ? "Reading…" : "Ask agent"}</button>
        </div>

        {extracted && (
          <div className="stack">
            <p>Your agent understood: <strong>{extracted.description}</strong>.</p>
            {canConfirm ? (
              <div className="choices" role="radiogroup" aria-label="Matching items">
                {extracted.matches.map((v) => (
                  <label key={v.sku} className={`choice ${sku === v.sku ? "on" : ""}`}>
                    <input type="radio" name="sku" checked={sku === v.sku} onChange={() => setSku(v.sku)} />
                    <img src={productSvgDataUri(v.type, v.color)} alt="" width={56} height={56} />
                    <span>{itemName(v)}<br /><span className="muted">${v.price}</span></span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted">No item in the store matches all of these limits right now.</p>
            )}

            <div className="modes" role="radiogroup" aria-label="How do you approve?">
              <label className={`mode ${mode === "CONFIRMED" ? "on" : ""} ${canConfirm ? "" : "off"}`}>
                <input type="radio" name="mode" disabled={!canConfirm} checked={mode === "CONFIRMED"} onChange={() => setMode("CONFIRMED")} />
                <span><strong>Approve this exact cart</strong><br /><span className="muted">You see the item, size and color on PayPal and pay now.</span></span>
              </label>
              <label className={`mode ${mode === "DELEGATED" ? "on" : ""} ${canDelegate ? "" : "off"}`}>
                <input type="radio" name="mode" disabled={!canDelegate} checked={mode === "DELEGATED"} onChange={() => setMode("DELEGATED")} />
                <span><strong>Let my agent choose{canDelegate ? `, up to $${extracted.limits.max_price}` : ""}</strong><br /><span className="muted">{canDelegate ? "You approve the limit on PayPal; the agent picks later and pays only the actual price." : "Needs a maximum price in your request."}</span></span>
              </label>
            </div>

            {!order && (canConfirm || canDelegate) && (mode === "CONFIRMED" ? canConfirm : canDelegate) && (
              <PayPalButton key={`${mode}-${sku}`} sdkReady={sdkReady} createOrder={createOrder} onApprove={approved} onError={setError} label="Pay with PayPal" />
            )}
          </div>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </section>

      {order && (
        <section className="card stack">
          <h2>{order.status === "AUTHORIZED" ? `Approved: your agent may spend up to $${order.ceiling}` : order.status === "COMPLETED" ? "Paid" : order.status}</h2>
          <dl className="facts">
            <dt>Consent</dt><dd>{order.intent?.mode === "DELEGATED" ? "Spending limit approved on PayPal (DELEGATED)" : "Exact cart approved on PayPal (CONFIRMED)"}</dd>
            <dt>PayPal order</dt><dd><code>{order.paypalOrderId}</code></dd>
            {order.captureId && (<><dt>Capture</dt><dd><code>{order.captureId}</code> · ${order.amount}</dd></>)}
            {order.chosenItem && (<><dt>Agent bought</dt><dd>{itemName(order.chosenItem)} · ${order.chosenItem.price}{order.chosenItem.limit_violations.length ? <span className="warn"> · outside your limits ({order.chosenItem.limit_violations.join(", ")})</span> : " · inside your limits"}</dd></>)}
            {order.promisedBy && (<><dt>Promised by</dt><dd>{new Date(order.promisedBy).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</dd></>)}
            <dt>Intent hash</dt><dd><code className="hash">{order.intent?.hash}</code><br /><span className="muted">Stored in the PayPal order&apos;s custom_id, which can&apos;t change after payment.</span></dd>
          </dl>
          {order.status === "AUTHORIZED" && (
            <div className="row">
              <select value={agentSku} onChange={(e) => setAgentSku(e.target.value)} aria-label="Item the agent picks">
                <option value="">Agent picks the best match</option>
                {variants.map((v) => <option key={v.sku} value={v.sku}>Demo: agent picks {itemName(v)} (${v.price})</option>)}
              </select>
              <button onClick={agentBuys} disabled={busy}>{busy ? "Buying…" : "Agent: buy now"}</button>
            </div>
          )}
        </section>
      )}

      <section>
        <h2>The store</h2>
        <div className="grid">
          {products.map((p) => (
            <article key={p.id} className="product">
              <img src={productSvgDataUri(p.type, p.colors[0])} alt={`${p.name} in ${p.colors[0]}`} width={160} height={160} />
              <h3>{p.name}</h3>
              <p className="muted">${p.price} · {p.colors.join(", ")}</p>
              <p className="muted">{p.sizes.join(" / ")}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
