"use client";
import Script from "next/script";
import { useState } from "react";
import { PayPalButton } from "./PayPalButton";
import { Stamp } from "./Stamp";
import { COLOR_HEX, productSvgDataUri } from "@/src/store/art";
import { itemName, type Product, type Variant } from "@/src/store/catalog";
import type { Limits } from "@/src/intent/limits";

type Extracted = { limits: Limits; description: string; matches: Variant[]; note?: string | null };
type Mode = "CONFIRMED" | "DELEGATED";

const FILTERS = [["all", "All objects"], ["tops", "Tops"], ["outerwear", "Outerwear"], ["accessories", "Accessories"]] as const;
type Filter = (typeof FILTERS)[number][0];
const CATEGORY: Record<string, Filter> = { tee: "tops", shirt: "tops", hoodie: "outerwear", jacket: "outerwear", socks: "accessories", beanie: "accessories", tote: "accessories" };
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
  const [request, setRequest] = useState("A sky-blue tee, size M, under $35, within a week");
  const [busy, setBusy] = useState(false);
  const [extracted, setExtracted] = useState<Extracted>();
  const [sku, setSku] = useState<string>();
  const [mode, setMode] = useState<Mode>("CONFIRMED");
  const [order, setOrder] = useState<Order>();
  const [agentSku, setAgentSku] = useState("");
  const [claimType, setClaimType] = useState("wrong_item");
  const [claimText, setClaimText] = useState("");
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Filter>("all");

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

  async function openClaim() {
    setBusy(true); setError(undefined);
    try {
      const c = await api<{ claimId: string }>("/api/claims", { orderId: order!.paypalOrderId, type: claimType, description: claimText });
      window.location.href = `/claims/${c.claimId}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  const canDelegate = !!extracted?.limits.max_price;
  const canConfirm = !!extracted?.matches.length;

  const status = busy && !extracted ? "Reading your request…" : !extracted ? "Ready" : extracted.matches.length ? `${extracted.matches.length} matching item${extracted.matches.length > 1 ? "s" : ""}` : "No exact match";
  const shown = products.filter((p) => filter === "all" || CATEGORY[p.type] === filter);
  const l = extracted?.limits;

  return (
    <main className="shop">
      <Script src="https://www.sandbox.paypal.com/web-sdk/v6/core" onLoad={() => setSdkReady(true)} onReady={() => window.paypal && setSdkReady(true)} />

      <header className="shop-hero">
        <p className="eyebrow">Fernleaf Goods · a fictional store, settled by Undo</p>
        <h1>The Autumn <em>Essentials</em></h1>
        <p className="muted">Let your agent shop here. You approve on PayPal, either the exact cart or a spending limit, and if something arrives wrong, Undo rules who&apos;s at fault.</p>
        <div className="filters" role="group" aria-label="Filter the catalog">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </header>

      <aside className="undo-panel" aria-label="Undo: buy with your agent">
        <div className="tagrow"><span className="tag">Undo</span><code>FAULT_ENGINE · DETERMINISTIC</code></div>
        <h2 className="panel-title">Agents are buying from your store.</h2>
        <p className="panel-lede">When one goes wrong, who&apos;s at fault? Undo compares what was approved, what PayPal says was bought, and what arrived.</p>

        {/* What Undo compares when something goes wrong: an illustration, not live data. */}
        <figure className="dossier" aria-label="Example: the intent record, the PayPal order and the delivered item are compared, and the merchant is found at fault">
          <div className="record" style={{ "--tilt": "-4deg", "--d": ".05s" } as React.CSSProperties}>
            <small>01 · Intent</small><b>Sky-blue tee, M</b><span>up to $35</span><span>hash 9f2c…e71a</span>
          </div>
          <div className="record" style={{ "--tilt": "1.5deg", "--d": ".18s" } as React.CSSProperties}>
            <small>02 · PayPal</small><b>Classic Tee, Sky Blue, M</b><span>custom_id 9f2c…e71a</span>
          </div>
          <div className="record" style={{ "--tilt": "4deg", "--d": ".31s" } as React.CSSProperties}>
            <small>03 · Arrival</small><b>Navy tee, tag M</b><span>code UNDO-7F3A</span>
          </div>
          <Stamp party="MERCHANT" delay={1.1} />
        </figure>

        <div>
          <label className="panel-label" htmlFor="req">Natural language request</label>
          <div className="request">
            <textarea id="req" value={request} onChange={(e) => setRequest(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!busy && request.trim().length >= 3) ask(); } }} maxLength={500} rows={3} />
            <div className="request-foot">
              <code aria-live="polite">{status}</code>
              <button onClick={ask} disabled={busy || request.trim().length < 3}>{busy && !extracted ? "Reading…" : "Ask agent"}</button>
            </div>
          </div>
        </div>

        {extracted && l && (
          <>
            <p className="divider">What your agent understood</p>
            <dl className="limits" aria-label={extracted.description}>
              <dt>Item</dt><dd>{[l.color, l.item].filter(Boolean).join(" ") || "Any"}</dd>
              {l.size && (<><dt>Size</dt><dd>{l.size}</dd></>)}
              {l.max_price && (<><dt>Ceiling</dt><dd>${l.max_price}</dd></>)}
              {l.deadline && (<><dt>Deadline</dt><dd>{new Date(`${l.deadline}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}</dd></>)}
            </dl>

            {canConfirm ? (
              <div className="choices" role="radiogroup" aria-label="Matching items">
                {extracted.matches.map((v) => (
                  <label key={v.sku} className={`choice ${sku === v.sku ? "on" : ""}`}>
                    <input type="radio" name="sku" checked={sku === v.sku} onChange={() => setSku(v.sku)} />
                    <img src={productSvgDataUri(v.type, v.color)} alt="" width={48} height={48} />
                    <span>{itemName(v)}<br /><span className="muted mono">${v.price}</span></span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted small">{extracted.note ?? "No item in the store matches all of these limits right now."}</p>
            )}

            <div className="modes" role="radiogroup" aria-label="How do you approve?">
              <label className={`mode ${mode === "CONFIRMED" ? "on" : ""} ${canConfirm ? "" : "off"}`}>
                <input type="radio" name="mode" disabled={!canConfirm} checked={mode === "CONFIRMED"} onChange={() => setMode("CONFIRMED")} />
                <span><strong>Approve this exact cart</strong><br /><span className="muted">You see the item, size and color on PayPal and pay now.</span></span>
                <span className="badge badge-ok">Confirmed</span>
              </label>
              <label className={`mode delegated ${mode === "DELEGATED" ? "on" : ""} ${canDelegate ? "" : "off"}`}>
                <input type="radio" name="mode" disabled={!canDelegate} checked={mode === "DELEGATED"} onChange={() => setMode("DELEGATED")} />
                <span><strong>Let my agent choose{canDelegate ? `, up to $${l.max_price}` : ""}</strong><br /><span className="muted">{canDelegate ? "You approve the limit on PayPal; the agent picks later. If it breaks your rules, the agent is at fault." : "Needs a maximum price in your request."}</span></span>
                <span className="badge badge-verdict">Delegated</span>
              </label>
            </div>

            {!order && (mode === "CONFIRMED" ? canConfirm : canDelegate) && (
              <>
                <PayPalButton key={`${mode}-${sku}`} sdkReady={sdkReady} createOrder={createOrder} onApprove={approved} onError={setError} label="Pay with PayPal" />
                <p className="sandbox-note">PayPal sandbox · no real money moves</p>
              </>
            )}
          </>
        )}
        {error && <p className="error" role="alert">{error}</p>}

        {order && (
          <section className="order-result" aria-live="polite">
            <h3>{order.status === "AUTHORIZED" ? `Approved: your agent may spend up to $${order.ceiling}` : order.status === "COMPLETED" ? "Paid" : order.status}</h3>
            <div className="receipt-wrap"><dl className="facts receipt">
              <dt>Consent</dt><dd>{order.intent?.mode === "DELEGATED" ? "Spending limit approved on PayPal (DELEGATED)" : "Exact cart approved on PayPal (CONFIRMED)"}</dd>
              <dt>PayPal order</dt><dd><code>{order.paypalOrderId}</code></dd>
              {order.captureId && (<><dt>Capture</dt><dd><code>{order.captureId}</code> · ${order.amount}</dd></>)}
              {order.chosenItem && (<><dt>Agent bought</dt><dd>{itemName(order.chosenItem)} · ${order.chosenItem.price}{order.chosenItem.limit_violations.length ? <span className="warn"> · outside your limits ({order.chosenItem.limit_violations.join(", ")})</span> : " · inside your limits"}</dd></>)}
              {order.promisedBy && (<><dt>Promised by</dt><dd>{new Date(order.promisedBy).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</dd></>)}
              <dt>Intent hash</dt><dd><code className="hash">{order.intent?.hash}</code><br /><span className="muted">Stored in the PayPal order&apos;s custom_id, which can&apos;t change after payment.</span></dd>
            </dl></div>
            {order.status === "AUTHORIZED" && (
              <div className="row">
                <select value={agentSku} onChange={(e) => setAgentSku(e.target.value)} aria-label="Item the agent picks">
                  <option value="">Agent picks the best match</option>
                  {variants.map((v) => <option key={v.sku} value={v.sku}>Demo: agent picks {itemName(v)} (${v.price})</option>)}
                </select>
                <button onClick={agentBuys} disabled={busy}>{busy ? "Buying…" : "Agent: buy now"}</button>
              </div>
            )}
            {order.status === "COMPLETED" && (
              <details>
                <summary>Something wrong with this order?</summary>
                <div className="stack">
                  <select value={claimType} onChange={(e) => setClaimType(e.target.value)} aria-label="What went wrong">
                    <option value="wrong_item">Wrong item, color or size</option>
                    <option value="damaged">Arrived damaged</option>
                    <option value="late">Arrived late</option>
                    <option value="agent_mistake">My agent bought the wrong thing</option>
                    <option value="changed_mind">I changed my mind</option>
                    <option value="other">Something else</option>
                  </select>
                  <textarea value={claimText} onChange={(e) => setClaimText(e.target.value)} maxLength={2000} rows={3} placeholder="What happened? (optional)" aria-label="What happened" />
                  <div><button onClick={openClaim} disabled={busy}>{busy ? "Opening…" : "Open a claim"}</button></div>
                </div>
              </details>
            )}
          </section>
        )}

        <ol className="panel-steps" aria-label="How Undo settles a claim" style={{ listStyle: "none", margin: 0, paddingLeft: 0 }}>
          <li><b>01</b><strong>Intent record</strong><span>You approve on PayPal; what you approved is hashed into the order.</span></li>
          <li><b>02</b><strong>Photo evidence</strong><span>Something arrives wrong: a photo with a one-time code. AI reads it, never decides.</span></li>
          <li><b>03</b><strong>Fault verdict</strong><span>Rules name who&apos;s at fault, the store&apos;s policy makes the offers, PayPal pays.</span></li>
        </ol>
      </aside>

      <section className="shop-catalog" aria-label="Catalog">
        <div className="products">
          {shown.map((p) => (
            <article key={p.id} className="product">
              <div className="product-art"><img src={productSvgDataUri(p.type, p.colors[0])} alt={`${p.name} in ${p.colors[0]}`} width={480} height={440} /></div>
              <div className="product-meta"><h3>{p.name}</h3><span className="product-price">${p.price}</span></div>
              <p className="product-sub">
                <span className="swatches" aria-hidden="true">{p.colors.map((c) => <i key={c} style={{ background: COLOR_HEX[c] ?? "#999" }} />)}</span>
                {p.colors.join(" · ")} / {p.sizes.length > 1 ? p.sizes.join(" ") : p.sizes[0]}
              </p>
            </article>
          ))}
        </div>

        <aside className="agent-era">
          <span className="agent-era-mark" aria-hidden="true">RULED</span>
          <h2>Three rulings. Real sandbox money.</h2>
          <p>Every live scenario runs the real flow on a paid PayPal sandbox order: the vision model reads the photo, the fault engine decides, the store&apos;s rules make the offers, and PayPal moves the money.</p>
          <div className="row">
            <a className="button-link primary" href="/judge">Try the live scenarios →</a>
            <a className="button-link" href="/evals">See the measured results</a>
          </div>
        </aside>
      </section>
    </main>
  );
}
